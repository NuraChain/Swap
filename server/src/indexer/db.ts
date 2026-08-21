// The indexer's storage. node:sqlite (no native build step), one file per chain.
// All uint112/uint256 values are TEXT - SQLite integers are i64 and reserves are not.
// Every event insert is idempotent via the (block_number, log_index) primary key:
// node --watch restarts replay the tail and must not double-count.

import { DatabaseSync } from 'node:sqlite';

export type Address = `0x${ string }`;

export type EventKind = 'swap' | 'mint' | 'burn';

// Which AMM the event came out of. The two protocols share ONE events table
// because the portfolio reads them as one feed ordered by time - a union over
// two tables would have to re-sort itself on every query to answer that.
export type Protocol = 'v2' | 'v3';

export interface TokenRow
{
    address: Address;
    symbol: string;
    name: string;
    decimals: number;
}

export interface PairRow
{
    address: Address;
    token0: Address;
    token1: Address;
    createdBlock: number;
    reserve0: bigint;
    reserve1: bigint;
}

// A V3 pool. There are no reserves to hold - a concentrated pool's depth lives
// in its ticks - so this is identity only: the two tokens and the fee tier,
// which is what a transaction row needs in order to name what was traded.
export interface V3PoolRow
{
    address: Address;
    token0: Address;
    token1: Address;
    fee: number;
    createdBlock: number;
    // What the pool CONTRACT holds, refreshed by the indexer. A concentrated
    // pool has no reserves to derive a TVL from, so its balances are the only
    // honest answer - and reading them on a timer keeps the API handlers
    // synchronous, which is the whole shape of this server.
    balance0: bigint;
    balance1: bigint;
    // The pool's OWN price, out of slot0. NOT derivable from the balances: a
    // concentrated pool's holdings depend on where its liquidity sits relative
    // to the price, so the ratio of what it holds says nothing about the rate.
    sqrtPriceX96: bigint;
}

export interface EventRow
{
    blockNumber: number;
    logIndex: number;
    txHash: string;
    timestamp: number;
    pair: Address;
    protocol: Protocol;
    kind: EventKind;
    account: Address;
    amount0In: bigint;
    amount1In: bigint;
    amount0Out: bigint;
    amount1Out: bigint;
}

export interface CandleRow
{
    pair: Address;
    hourStart: number;
    open: bigint;
    high: bigint;
    low: bigint;
    close: bigint;
    volume0: bigint;
    volume1: bigint;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pairs (
    address TEXT PRIMARY KEY,
    token0 TEXT NOT NULL,
    token1 TEXT NOT NULL,
    created_block INTEGER NOT NULL,
    reserve0 TEXT NOT NULL DEFAULT '0',
    reserve1 TEXT NOT NULL DEFAULT '0'
);
CREATE TABLE IF NOT EXISTS v3_pools (
    address TEXT PRIMARY KEY,
    token0 TEXT NOT NULL,
    token1 TEXT NOT NULL,
    fee INTEGER NOT NULL,
    created_block INTEGER NOT NULL,
    balance0 TEXT NOT NULL DEFAULT '0',
    balance1 TEXT NOT NULL DEFAULT '0',
    sqrt_price_x96 TEXT NOT NULL DEFAULT '0'
);
CREATE TABLE IF NOT EXISTS events (
    block_number INTEGER NOT NULL,
    log_index INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    ts INTEGER NOT NULL,
    pair TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'v2',
    kind TEXT NOT NULL,
    account TEXT NOT NULL,
    amount0_in TEXT NOT NULL DEFAULT '0',
    amount1_in TEXT NOT NULL DEFAULT '0',
    amount0_out TEXT NOT NULL DEFAULT '0',
    amount1_out TEXT NOT NULL DEFAULT '0',
    PRIMARY KEY (block_number, log_index)
);
CREATE INDEX IF NOT EXISTS events_by_time ON events (ts DESC);
CREATE INDEX IF NOT EXISTS events_by_pair ON events (pair, ts DESC);
CREATE TABLE IF NOT EXISTS candles (
    pair TEXT NOT NULL,
    hour_start INTEGER NOT NULL,
    open TEXT NOT NULL,
    high TEXT NOT NULL,
    low TEXT NOT NULL,
    close TEXT NOT NULL,
    volume0 TEXT NOT NULL DEFAULT '0',
    volume1 TEXT NOT NULL DEFAULT '0',
    PRIMARY KEY (pair, hour_start)
);
`;

interface V3PoolWire
{
    address: Address;
    token0: Address;
    token1: Address;
    fee: number;
    created_block: number;
    balance0: string;
    balance1: string;
    sqrt_price_x96: string;
}

function v3PoolOf(row: V3PoolWire): V3PoolRow
{
    return {
        address: row.address,
        token0: row.token0,
        token1: row.token1,
        fee: row.fee,
        createdBlock: row.created_block,
        balance0: BigInt(row.balance0),
        balance1: BigInt(row.balance1),
        sqrtPriceX96: BigInt(row.sqrt_price_x96)
    };
}

export class IndexerDb
{
    #db: DatabaseSync;

    constructor(path: string)
    {
        this.#db = new DatabaseSync(path);
        this.#db.exec('PRAGMA journal_mode = WAL;');
        this.#db.exec(SCHEMA);
        this.#migrate();
    }

    // CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
    // a column added after the fact is added in place. Wiping and reindexing
    // instead would be a self-inflicted outage on every schema change. The
    // DEFAULT is what makes it safe: every row written before this column
    // existed was, by definition, a V2 row.
    #migrate(): void
    {
        // Table names here are literals in this file, never input.
        const columns: Array<[string, string, string]> = [
            ['events', 'protocol', "ALTER TABLE events ADD COLUMN protocol TEXT NOT NULL DEFAULT 'v2'"],
            ['v3_pools', 'balance0', "ALTER TABLE v3_pools ADD COLUMN balance0 TEXT NOT NULL DEFAULT '0'"],
            ['v3_pools', 'balance1', "ALTER TABLE v3_pools ADD COLUMN balance1 TEXT NOT NULL DEFAULT '0'"],
            ['v3_pools', 'sqrt_price_x96', "ALTER TABLE v3_pools ADD COLUMN sqrt_price_x96 TEXT NOT NULL DEFAULT '0'"]
        ];
        for (const [table, column, ddl] of columns)
        {
            const present = this.#db.prepare(`PRAGMA table_info(${ table })`).all() as unknown as Array<{ name: string }>;
            if (!present.some((entry) => entry.name === column))
            {
                this.#db.exec(ddl);
            }
        }
    }

    public close(): void
    {
        this.#db.close();
    }

    // Chain identity mismatch (re-genesised chain, different deployment) makes every
    // stored row a lie about an address space that no longer exists.
    public wipe(): void
    {
        this.#db.exec('DELETE FROM meta; DELETE FROM tokens; DELETE FROM pairs; DELETE FROM v3_pools; '
            + 'DELETE FROM events; DELETE FROM candles;');
    }

    public getMeta(key: string): string | null
    {
        const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value ?? null;
    }

    public setMeta(key: string, value: string): void
    {
        this.#db
            .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(key, value);
    }

    public upsertToken(token: TokenRow): void
    {
        this.#db
            .prepare('INSERT INTO tokens (address, symbol, name, decimals) VALUES (?, ?, ?, ?) '
                + 'ON CONFLICT(address) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, decimals = excluded.decimals')
            .run(token.address.toLowerCase(), token.symbol, token.name, token.decimals);
    }

    public getToken(address: string): TokenRow | null
    {
        const row = this.#db.prepare('SELECT * FROM tokens WHERE address = ?').get(address.toLowerCase()) as
            | { address: Address; symbol: string; name: string; decimals: number }
            | undefined;
        return row ?? null;
    }

    public listTokens(): TokenRow[]
    {
        return this.#db.prepare('SELECT * FROM tokens ORDER BY symbol').all() as unknown as TokenRow[];
    }

    public upsertPair(pair: { address: Address; token0: Address; token1: Address; createdBlock: number }): void
    {
        this.#db
            .prepare('INSERT INTO pairs (address, token0, token1, created_block) VALUES (?, ?, ?, ?) '
                + 'ON CONFLICT(address) DO NOTHING')
            .run(pair.address.toLowerCase(), pair.token0.toLowerCase(), pair.token1.toLowerCase(), pair.createdBlock);
    }

    public updateReserves(pair: string, reserve0: bigint, reserve1: bigint): void
    {
        this.#db
            .prepare('UPDATE pairs SET reserve0 = ?, reserve1 = ? WHERE address = ?')
            .run(reserve0.toString(), reserve1.toString(), pair.toLowerCase());
    }

    public upsertV3Pool(pool: { address: Address; token0: Address; token1: Address; fee: number; createdBlock: number }): void
    {
        this.#db
            .prepare('INSERT INTO v3_pools (address, token0, token1, fee, created_block) VALUES (?, ?, ?, ?, ?) '
                + 'ON CONFLICT(address) DO NOTHING')
            .run(
                pool.address.toLowerCase(),
                pool.token0.toLowerCase(),
                pool.token1.toLowerCase(),
                pool.fee,
                pool.createdBlock
            );
    }

    public updateV3Balances(pool: string, balance0: bigint, balance1: bigint): void
    {
        this.#db
            .prepare('UPDATE v3_pools SET balance0 = ?, balance1 = ? WHERE address = ?')
            .run(balance0.toString(), balance1.toString(), pool.toLowerCase());
    }

    public updateV3Price(pool: string, sqrtPriceX96: bigint): void
    {
        this.#db
            .prepare('UPDATE v3_pools SET sqrt_price_x96 = ? WHERE address = ?')
            .run(sqrtPriceX96.toString(), pool.toLowerCase());
    }

    public getV3Pool(address: string): V3PoolRow | null
    {
        const row = this.#db.prepare('SELECT * FROM v3_pools WHERE address = ?').get(address.toLowerCase()) as
            | V3PoolWire
            | undefined;
        return row === undefined ? null : v3PoolOf(row);
    }

    public listV3Pools(): V3PoolRow[]
    {
        const rows = this.#db.prepare('SELECT * FROM v3_pools ORDER BY created_block')
            .all() as unknown as V3PoolWire[];
        return rows.map(v3PoolOf);
    }

    // A concentrated pool has no candle to read a figure out of - the hourly
    // series is priced from a pair's reserves - so its 24h volume is summed
    // straight off the events it emitted, the same both-sides sum the candle
    // accumulates for V2.
    public v3VolumeSince(pool: string, sinceTs: number): { volume0: bigint; volume1: bigint }
    {
        const rows = this.#db
            .prepare('SELECT amount0_in, amount1_in, amount0_out, amount1_out FROM events '
                + "WHERE pair = ? AND protocol = 'v3' AND kind = 'swap' AND ts >= ?")
            .all(pool.toLowerCase(), sinceTs) as unknown as Array<Record<string, string>>;
        let volume0 = 0n;
        let volume1 = 0n;
        for (const row of rows)
        {
            volume0 += BigInt(row.amount0_in) + BigInt(row.amount0_out);
            volume1 += BigInt(row.amount1_in) + BigInt(row.amount1_out);
        }
        return { volume0, volume1 };
    }

    public getPair(address: string): PairRow | null
    {
        const row = this.#db.prepare('SELECT * FROM pairs WHERE address = ?').get(address.toLowerCase()) as
            | { address: Address; token0: Address; token1: Address; created_block: number; reserve0: string; reserve1: string }
            | undefined;
        if (row === undefined)
        {
            return null;
        }
        return {
            address: row.address,
            token0: row.token0,
            token1: row.token1,
            createdBlock: row.created_block,
            reserve0: BigInt(row.reserve0),
            reserve1: BigInt(row.reserve1)
        };
    }

    public listPairs(): PairRow[]
    {
        const rows = this.#db.prepare('SELECT * FROM pairs ORDER BY created_block').all() as unknown as Array<
            { address: Address; token0: Address; token1: Address; created_block: number; reserve0: string; reserve1: string }
        >;
        return rows.map((row) => ({
            address: row.address,
            token0: row.token0,
            token1: row.token1,
            createdBlock: row.created_block,
            reserve0: BigInt(row.reserve0),
            reserve1: BigInt(row.reserve1)
        }));
    }

    /** @returns false when the event was already stored (idempotent replay). */
    public insertEvent(event: EventRow): boolean
    {
        const result = this.#db
            .prepare('INSERT OR IGNORE INTO events '
                + '(block_number, log_index, tx_hash, ts, pair, protocol, kind, account, '
                + 'amount0_in, amount1_in, amount0_out, amount1_out) '
                + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(
                event.blockNumber,
                event.logIndex,
                event.txHash,
                event.timestamp,
                event.pair.toLowerCase(),
                event.protocol,
                event.kind,
                event.account.toLowerCase(),
                event.amount0In.toString(),
                event.amount1In.toString(),
                event.amount0Out.toString(),
                event.amount1Out.toString()
            );
        return result.changes === 1;
    }

    public recentEvents(limit: number, filter?: { pair?: string; account?: string }): EventRow[]
    {
        const clauses: string[] = [];
        const args: Array<string | number> = [];
        if (filter?.pair !== undefined)
        {
            clauses.push('pair = ?');
            args.push(filter.pair.toLowerCase());
        }
        if (filter?.account !== undefined)
        {
            clauses.push('account = ?');
            args.push(filter.account.toLowerCase());
        }
        const where = clauses.length === 0 ? '' : ` WHERE ${ clauses.join(' AND ') }`;
        const rows = this.#db
            .prepare(`SELECT * FROM events${ where } ORDER BY ts DESC, log_index DESC LIMIT ?`)
            .all(...args, limit) as unknown as Array<Record<string, string | number>>;
        return rows.map((row) => ({
            blockNumber: row.block_number as number,
            logIndex: row.log_index as number,
            txHash: row.tx_hash as string,
            timestamp: row.ts as number,
            pair: row.pair as Address,
            protocol: row.protocol as Protocol,
            kind: row.kind as EventKind,
            account: row.account as Address,
            amount0In: BigInt(row.amount0_in as string),
            amount1In: BigInt(row.amount1_in as string),
            amount0Out: BigInt(row.amount0_out as string),
            amount1Out: BigInt(row.amount1_out as string)
        }));
    }

    // Applies one swap to its hourly candle. `price` is token1-per-token0, decimals
    // adjusted, 1e18 fixed point. The merge runs in JS: candle values are bigints
    // stored as TEXT, and SQLite arithmetic (i64/REAL) cannot hold them.
    public recordCandlePoint(pair: string, hourStart: number, price: bigint, volume0: bigint, volume1: bigint): void
    {
        const key = pair.toLowerCase();
        const existing = this.#db
            .prepare('SELECT high, low, volume0, volume1 FROM candles WHERE pair = ? AND hour_start = ?')
            .get(key, hourStart) as { high: string; low: string; volume0: string; volume1: string } | undefined;
        if (existing === undefined)
        {
            this.#db
                .prepare('INSERT INTO candles (pair, hour_start, open, high, low, close, volume0, volume1) '
                    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run(
                    key,
                    hourStart,
                    price.toString(),
                    price.toString(),
                    price.toString(),
                    price.toString(),
                    volume0.toString(),
                    volume1.toString()
                );
            return;
        }
        const high = price > BigInt(existing.high) ? price : BigInt(existing.high);
        const low = price < BigInt(existing.low) ? price : BigInt(existing.low);
        this.#db
            .prepare('UPDATE candles SET high = ?, low = ?, close = ?, volume0 = ?, volume1 = ? '
                + 'WHERE pair = ? AND hour_start = ?')
            .run(
                high.toString(),
                low.toString(),
                price.toString(),
                (BigInt(existing.volume0) + volume0).toString(),
                (BigInt(existing.volume1) + volume1).toString(),
                key,
                hourStart
            );
    }

    public candles(pair: string, fromHour: number): CandleRow[]
    {
        const rows = this.#db
            .prepare('SELECT * FROM candles WHERE pair = ? AND hour_start >= ? ORDER BY hour_start')
            .all(pair.toLowerCase(), fromHour) as unknown as Array<Record<string, string | number>>;
        return rows.map((row) => ({
            pair: row.pair as Address,
            hourStart: row.hour_start as number,
            open: BigInt(row.open as string),
            high: BigInt(row.high as string),
            low: BigInt(row.low as string),
            close: BigInt(row.close as string),
            volume0: BigInt(row.volume0 as string),
            volume1: BigInt(row.volume1 as string)
        }));
    }

    public volumeSince(pair: string, sinceHour: number): { volume0: bigint; volume1: bigint }
    {
        const rows = this.#db
            .prepare('SELECT volume0, volume1 FROM candles WHERE pair = ? AND hour_start >= ?')
            .all(pair.toLowerCase(), sinceHour) as unknown as Array<{ volume0: string; volume1: string }>;
        let volume0 = 0n;
        let volume1 = 0n;
        for (const row of rows)
        {
            volume0 += BigInt(row.volume0);
            volume1 += BigInt(row.volume1);
        }
        return { volume0, volume1 };
    }
}
