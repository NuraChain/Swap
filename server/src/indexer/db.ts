// The indexer's storage, on PostgreSQL. All uint256 values are NUMERIC(78,0) -
// exact for every 256-bit integer - and cross the wire as strings, read back
// into bigints. Every event insert is idempotent via the (block_number,
// log_index) primary key: node --watch restarts replay the tail and must not
// double-count.

export type Address = `0x${ string }`;

export type EventKind = 'swap' | 'mint' | 'burn';

/**
 * The one method this module needs from a client. `pg`'s Pool satisfies it in
 * production; the tests hand in an in-process PGlite, which answers the same
 * shape. Drivers disagree on int8 (pg: string, PGlite: number), so every row
 * mapper below coerces explicitly instead of trusting a cast.
 */
export interface SqlClient
{
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export interface TokenRow
{
    address: Address;
    symbol: string;
    name: string;
    decimals: number;
}

export interface V3PoolRow
{
    address: Address;
    token0: Address;
    token1: Address;
    fee: number;
    createdBlock: number;
    // What the pool CONTRACT holds, refreshed by the indexer. A concentrated
    // pool has no reserves to derive a TVL from, so its balances are the only
    // honest answer.
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

// One statement per entry: a multi-statement string only runs over the simple
// query protocol, which not every client speaks.
const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tokens (
        address TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        decimals INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS v3_pools (
        address TEXT PRIMARY KEY,
        token0 TEXT NOT NULL,
        token1 TEXT NOT NULL,
        fee INTEGER NOT NULL,
        created_block BIGINT NOT NULL,
        balance0 NUMERIC(78, 0) NOT NULL DEFAULT 0,
        balance1 NUMERIC(78, 0) NOT NULL DEFAULT 0,
        sqrt_price_x96 NUMERIC(78, 0) NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS events (
        block_number BIGINT NOT NULL,
        log_index INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        ts BIGINT NOT NULL,
        pair TEXT NOT NULL,
        kind TEXT NOT NULL,
        account TEXT NOT NULL,
        amount0_in NUMERIC(78, 0) NOT NULL DEFAULT 0,
        amount1_in NUMERIC(78, 0) NOT NULL DEFAULT 0,
        amount0_out NUMERIC(78, 0) NOT NULL DEFAULT 0,
        amount1_out NUMERIC(78, 0) NOT NULL DEFAULT 0,
        PRIMARY KEY (block_number, log_index)
    )`,
    'CREATE INDEX IF NOT EXISTS events_by_time ON events (ts DESC)',
    'CREATE INDEX IF NOT EXISTS events_by_pair ON events (pair, ts DESC)',
    'CREATE INDEX IF NOT EXISTS events_by_account ON events (account, ts DESC)',
    `CREATE TABLE IF NOT EXISTS candles (
        pair TEXT NOT NULL,
        hour_start BIGINT NOT NULL,
        open NUMERIC(78, 0) NOT NULL,
        high NUMERIC(78, 0) NOT NULL,
        low NUMERIC(78, 0) NOT NULL,
        close NUMERIC(78, 0) NOT NULL,
        volume0 NUMERIC(78, 0) NOT NULL DEFAULT 0,
        volume1 NUMERIC(78, 0) NOT NULL DEFAULT 0,
        PRIMARY KEY (pair, hour_start)
    )`
];

type Wire = Record<string, unknown>;

function big(value: unknown): bigint
{
    return BigInt(String(value));
}

function tokenOf(row: Wire): TokenRow
{
    return {
        address: row.address as Address,
        symbol: row.symbol as string,
        name: row.name as string,
        decimals: Number(row.decimals)
    };
}

function v3PoolOf(row: Wire): V3PoolRow
{
    return {
        address: row.address as Address,
        token0: row.token0 as Address,
        token1: row.token1 as Address,
        fee: Number(row.fee),
        createdBlock: Number(row.created_block),
        balance0: big(row.balance0),
        balance1: big(row.balance1),
        sqrtPriceX96: big(row.sqrt_price_x96)
    };
}

function eventOf(row: Wire): EventRow
{
    return {
        blockNumber: Number(row.block_number),
        logIndex: Number(row.log_index),
        txHash: row.tx_hash as string,
        timestamp: Number(row.ts),
        pair: row.pair as Address,
        kind: row.kind as EventKind,
        account: row.account as Address,
        amount0In: big(row.amount0_in),
        amount1In: big(row.amount1_in),
        amount0Out: big(row.amount0_out),
        amount1Out: big(row.amount1_out)
    };
}

function candleOf(row: Wire): CandleRow
{
    return {
        pair: row.pair as Address,
        hourStart: Number(row.hour_start),
        open: big(row.open),
        high: big(row.high),
        low: big(row.low),
        close: big(row.close),
        volume0: big(row.volume0),
        volume1: big(row.volume1)
    };
}

export class IndexerDb
{
    #sql: SqlClient;

    // Use IndexerDb.open(): it creates the schema this constructor assumes.
    constructor(sql: SqlClient)
    {
        this.#sql = sql;
    }

    /** Creates the schema if it is missing. The caller owns the client and ends it. */
    public static async open(sql: SqlClient): Promise<IndexerDb>
    {
        for (const statement of SCHEMA)
        {
            await sql.query(statement);
        }
        return new IndexerDb(sql);
    }

    async #rows(text: string, params: unknown[] = []): Promise<Wire[]>
    {
        // PostgreSQL refuses a NUL byte in a text parameter outright, and every
        // read here is keyed by request input (`?account=%00`). No stored value
        // can contain one, so such a key matches nothing - an empty answer, not
        // a 500.
        if (params.some((param) => typeof param === 'string' && param.includes('\0')))
        {
            return [];
        }
        return (await this.#sql.query(text, params)).rows as Wire[];
    }

    // Chain identity mismatch (re-genesised chain, different deployment) makes every
    // stored row a lie about an address space that no longer exists.
    public async wipe(): Promise<void>
    {
        await this.#sql.query('TRUNCATE meta, tokens, v3_pools, events, candles');
    }

    public async getMeta(key: string): Promise<string | null>
    {
        const [row] = await this.#rows('SELECT value FROM meta WHERE key = $1', [key]);
        return row === undefined ? null : row.value as string;
    }

    public async setMeta(key: string, value: string): Promise<void>
    {
        await this.#sql.query(
            'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
            [key, value]
        );
    }

    public async upsertToken(token: TokenRow): Promise<void>
    {
        await this.#sql.query(
            'INSERT INTO tokens (address, symbol, name, decimals) VALUES ($1, $2, $3, $4) '
                + 'ON CONFLICT (address) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, decimals = excluded.decimals',
            [token.address.toLowerCase(), token.symbol, token.name, token.decimals]
        );
    }

    public async getToken(address: string): Promise<TokenRow | null>
    {
        const [row] = await this.#rows('SELECT * FROM tokens WHERE address = $1', [address.toLowerCase()]);
        return row === undefined ? null : tokenOf(row);
    }

    public async listTokens(): Promise<TokenRow[]>
    {
        return (await this.#rows('SELECT * FROM tokens ORDER BY symbol')).map(tokenOf);
    }

    public async upsertV3Pool(pool: { address: Address; token0: Address; token1: Address; fee: number; createdBlock: number }): Promise<void>
    {
        await this.#sql.query(
            'INSERT INTO v3_pools (address, token0, token1, fee, created_block) VALUES ($1, $2, $3, $4, $5) '
                + 'ON CONFLICT (address) DO NOTHING',
            [pool.address.toLowerCase(), pool.token0.toLowerCase(), pool.token1.toLowerCase(), pool.fee, pool.createdBlock]
        );
    }

    public async updateV3Balances(pool: string, balance0: bigint, balance1: bigint): Promise<void>
    {
        await this.#sql.query(
            'UPDATE v3_pools SET balance0 = $1, balance1 = $2 WHERE address = $3',
            [balance0.toString(), balance1.toString(), pool.toLowerCase()]
        );
    }

    public async updateV3Price(pool: string, sqrtPriceX96: bigint): Promise<void>
    {
        await this.#sql.query(
            'UPDATE v3_pools SET sqrt_price_x96 = $1 WHERE address = $2',
            [sqrtPriceX96.toString(), pool.toLowerCase()]
        );
    }

    public async getV3Pool(address: string): Promise<V3PoolRow | null>
    {
        const [row] = await this.#rows('SELECT * FROM v3_pools WHERE address = $1', [address.toLowerCase()]);
        return row === undefined ? null : v3PoolOf(row);
    }

    public async listV3Pools(): Promise<V3PoolRow[]>
    {
        return (await this.#rows('SELECT * FROM v3_pools ORDER BY created_block')).map(v3PoolOf);
    }

    /** @returns false when the event was already stored (idempotent replay). */
    public async insertEvent(event: EventRow): Promise<boolean>
    {
        const result = await this.#sql.query(
            'INSERT INTO events '
                + '(block_number, log_index, tx_hash, ts, pair, kind, account, '
                + 'amount0_in, amount1_in, amount0_out, amount1_out) '
                + 'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) '
                + 'ON CONFLICT (block_number, log_index) DO NOTHING',
            [
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
            ]
        );
        return result.rowCount === 1;
    }

    public async recentEvents(limit: number, filter?: { pair?: string; account?: string }): Promise<EventRow[]>
    {
        const clauses: string[] = [];
        const args: Array<string | number> = [];
        if (filter?.pair !== undefined)
        {
            args.push(filter.pair.toLowerCase());
            clauses.push(`pair = $${ args.length }`);
        }
        if (filter?.account !== undefined)
        {
            args.push(filter.account.toLowerCase());
            clauses.push(`account = $${ args.length }`);
        }
        const where = clauses.length === 0 ? '' : ` WHERE ${ clauses.join(' AND ') }`;
        args.push(limit);
        const rows = await this.#rows(`SELECT * FROM events${ where } ORDER BY ts DESC, log_index DESC LIMIT $${ args.length }`, args);
        return rows.map(eventOf);
    }

    // Applies one swap to its hourly candle. `price` is token1-per-token0, decimals
    // adjusted, 1e18 fixed point. One upsert: NUMERIC holds every uint256, so the
    // high/low/volume merge runs in the database without a read first.
    public async recordCandlePoint(pair: string, hourStart: number, price: bigint, volume0: bigint, volume1: bigint): Promise<void>
    {
        await this.#sql.query(
            'INSERT INTO candles (pair, hour_start, open, high, low, close, volume0, volume1) '
                + 'VALUES ($1, $2, $3, $3, $3, $3, $4, $5) '
                + 'ON CONFLICT (pair, hour_start) DO UPDATE SET '
                + 'high = GREATEST(candles.high, excluded.high), '
                + 'low = LEAST(candles.low, excluded.low), '
                + 'close = excluded.close, '
                + 'volume0 = candles.volume0 + excluded.volume0, '
                + 'volume1 = candles.volume1 + excluded.volume1',
            [pair.toLowerCase(), hourStart, price.toString(), volume0.toString(), volume1.toString()]
        );
    }

    public async candles(pair: string, fromHour: number): Promise<CandleRow[]>
    {
        const rows = await this.#rows(
            'SELECT * FROM candles WHERE pair = $1 AND hour_start >= $2 ORDER BY hour_start',
            [pair.toLowerCase(), fromHour]
        );
        return rows.map(candleOf);
    }

    // A pool's live price lives at the END of its candle series - the pools
    // table's sqrt_price_x96 is refreshed on its own 15s beat, while every swap
    // lands here immediately. The (pair, hour_start) primary key answers for
    // exactly one row.
    public async latestClose(pool: string): Promise<bigint | null>
    {
        const [row] = await this.#rows(
            'SELECT close FROM candles WHERE pair = $1 ORDER BY hour_start DESC LIMIT 1',
            [pool.toLowerCase()]
        );
        return row === undefined ? null : big(row.close);
    }

    public async volumeSince(pool: string, sinceHour: number): Promise<{ volume0: bigint; volume1: bigint }>
    {
        const [row] = await this.#rows(
            'SELECT COALESCE(SUM(volume0), 0) AS volume0, COALESCE(SUM(volume1), 0) AS volume1 '
                + 'FROM candles WHERE pair = $1 AND hour_start >= $2',
            [pool.toLowerCase(), sinceHour]
        );
        return { volume0: big(row.volume0), volume1: big(row.volume1) };
    }
}
