// The indexer's storage. node:sqlite (no native build step), one file per chain.
// All uint112/uint256 values are TEXT - SQLite integers are i64 and reserves are not.
// Every event insert is idempotent via the (block_number, log_index) primary key:
// node --watch restarts replay the tail and must not double-count.

import { DatabaseSync } from 'node:sqlite';

export type Address = `0x${ string }`;

export type EventKind = 'swap' | 'mint' | 'burn';

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

export interface EventRow
{
    blockNumber: number;
    logIndex: number;
    txHash: string;
    timestamp: number;
    pair: Address;
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
CREATE TABLE IF NOT EXISTS events (
    block_number INTEGER NOT NULL,
    log_index INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    ts INTEGER NOT NULL,
    pair TEXT NOT NULL,
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

export class IndexerDb
{
    #db: DatabaseSync;

    constructor(path: string)
    {
        this.#db = new DatabaseSync(path);
        this.#db.exec('PRAGMA journal_mode = WAL;');
        this.#db.exec(SCHEMA);
    }

    public close(): void
    {
        this.#db.close();
    }

    // Chain identity mismatch (fresh hardhat node, different deployment) makes every
    // stored row a lie about an address space that no longer exists.
    public wipe(): void
    {
        this.#db.exec('DELETE FROM meta; DELETE FROM tokens; DELETE FROM pairs; DELETE FROM events; DELETE FROM candles;');
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
                + '(block_number, log_index, tx_hash, ts, pair, kind, account, amount0_in, amount1_in, amount0_out, amount1_out) '
                + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(
                event.blockNumber,
                event.logIndex,
                event.txHash,
                event.timestamp,
                event.pair.toLowerCase(),
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
