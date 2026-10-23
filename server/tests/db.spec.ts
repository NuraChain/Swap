// The indexer's storage layer, exercised against a real PostgreSQL - PGlite, the
// engine compiled to WASM and running in this process, so the SQL under test is
// the SQL production sends. Each test starts from an empty database (see
// ./pg.ts). What is being defended here is mostly one property: this database
// holds MONEY numbers, every uint256 lands in a NUMERIC(78,0) column and crosses
// the wire as a string, and every read has to bring the exact bigint back. A
// silently truncated amount is a wrong price on every screen that reads it.

import { describe, expect, it } from 'vitest';

import type { Address, EventRow } from '../src/indexer/db.ts';
import { freshDb } from './pg.ts';

const POOL = '0x00000000000000000000000000000000000000aa' as Address;
const OTHER_POOL = '0x00000000000000000000000000000000000000bb' as Address;
const NURA = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const ALICE = '0x00000000000000000000000000000000000000c1' as Address;
const BOB = '0x00000000000000000000000000000000000000c2' as Address;

/** uint256 max - the largest amount an event can carry. */
const MAX_UINT256 = (1n << 256n) - 1n;

function event(overrides: Partial<EventRow> = {}): EventRow
{
    return {
        blockNumber: 100,
        logIndex: 0,
        txHash: '0xaaa',
        timestamp: 1_700_000_000,
        pair: POOL,
        kind: 'swap',
        account: ALICE,
        amount0In: 1n,
        amount1In: 0n,
        amount0Out: 0n,
        amount1Out: 2n,
        ...overrides
    };
}

describe('meta', () =>
{
    it('answers null for a key never written', async () =>
    {
        const db = await freshDb();
        expect(await db.getMeta('cursor')).toBeNull();
    });

    it('round-trips and then overwrites in place', async () =>
    {
        const db = await freshDb();
        await db.setMeta('cursor', '10');
        expect(await db.getMeta('cursor')).toBe('10');
        await db.setMeta('cursor', '20');
        expect(await db.getMeta('cursor')).toBe('20');
    });

    it('keeps keys independent', async () =>
    {
        const db = await freshDb();
        await db.setMeta('cursor', '10');
        await db.setMeta('identity', 'chain:factory');
        expect(await db.getMeta('cursor')).toBe('10');
        expect(await db.getMeta('identity')).toBe('chain:factory');
    });

    it('stores an empty value rather than treating it as absent', async () =>
    {
        // The live indexer writes '' for a block with no hash; that has to read
        // back as a written value, not as "never indexed".
        const db = await freshDb();
        await db.setMeta('cursorHash', '');
        expect(await db.getMeta('cursorHash')).toBe('');
        expect(await db.getMeta('cursorHash')).not.toBeNull();
    });
});

describe('tokens', () =>
{
    it('inserts and reads back a token', async () =>
    {
        const db = await freshDb();
        await db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        expect(await db.getToken(USDT)).toEqual({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
    });

    // Addresses arrive checksummed from viem and lowercased from the artifact.
    // Two spellings of one token would be two rows, and the price map keys on the
    // address - a token priced under one spelling reads as unpriced under the other.
    it('normalizes address case on write and on read', async () =>
    {
        const db = await freshDb();
        await db.upsertToken({ address: USDT.toUpperCase() as Address, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        expect((await db.getToken(USDT))?.symbol).toBe('mUSDT');
        expect((await db.getToken(USDT.toUpperCase()))?.symbol).toBe('mUSDT');
        expect(await db.listTokens()).toHaveLength(1);
    });

    it('updates metadata on re-upsert instead of duplicating the row', async () =>
    {
        const db = await freshDb();
        await db.upsertToken({ address: USDT, symbol: '???', name: 'Unknown token', decimals: 18 });
        await db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        expect(await db.listTokens()).toHaveLength(1);
        expect(await db.getToken(USDT)).toEqual({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
    });

    it('answers null for an unknown token rather than throwing', async () =>
    {
        const db = await freshDb();
        expect(await db.getToken('0x00000000000000000000000000000000000000ff')).toBeNull();
    });

    it('lists tokens ordered by symbol', async () =>
    {
        const db = await freshDb();
        await db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'b', decimals: 6 });
        await db.upsertToken({ address: NURA, symbol: 'NURA', name: 'a', decimals: 18 });
        expect((await db.listTokens()).map((token) => token.symbol)).toEqual(['NURA', 'mUSDT']);
    });

    it('accepts zero decimals - a real ERC20 shape, not a missing value', async () =>
    {
        const db = await freshDb();
        await db.upsertToken({ address: USDT, symbol: 'ZERO', name: 'Zero decimals', decimals: 0 });
        expect((await db.getToken(USDT))?.decimals).toBe(0);
    });
});

describe('v3 pools', () =>
{
    it('stores a pool and reads it back', async () =>
    {
        const db = await freshDb();
        await db.upsertV3Pool({ address: POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 7 });
        const row = await db.getV3Pool(POOL);
        expect(row).not.toBeNull();
        expect(row?.token0).toBe(NURA);
        expect(row?.token1).toBe(USDT);
        expect(row?.fee).toBe(500);
        expect(row?.createdBlock).toBe(7);
        // A pool that has never been refreshed reads zero, not null or NaN - and
        // the price map skips a pool quoting nothing rather than pricing off it.
        expect(row?.balance0).toBe(0n);
        expect(row?.balance1).toBe(0n);
        expect(row?.sqrtPriceX96).toBe(0n);
    });

    // PoolCreated is emitted once per pool, but the tail gets replayed on restart
    // and after a reorg rewind. A second insert must not reset state.
    it('ignores a duplicate creation instead of clobbering live balances', async () =>
    {
        const db = await freshDb();
        await db.upsertV3Pool({ address: POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 7 });
        await db.updateV3Balances(POOL, 100n, 200n);
        await db.updateV3Price(POOL, 999n);
        await db.upsertV3Pool({ address: POOL, token0: USDT, token1: NURA, fee: 3000, createdBlock: 9 });
        const row = await db.getV3Pool(POOL);
        expect(row?.balance0).toBe(100n);
        expect(row?.balance1).toBe(200n);
        expect(row?.sqrtPriceX96).toBe(999n);
        expect(row?.token0).toBe(NURA);
        expect(row?.fee).toBe(500);
        expect(row?.createdBlock).toBe(7);
    });

    it('normalizes address case across creation, update and lookup', async () =>
    {
        const db = await freshDb();
        await db.upsertV3Pool({
            address: POOL.toUpperCase() as Address,
            token0: NURA.toUpperCase() as Address,
            token1: USDT,
            fee: 100,
            createdBlock: 1
        });
        await db.updateV3Balances(POOL.toUpperCase(), 5n, 6n);
        expect((await db.getV3Pool(POOL))?.balance0).toBe(5n);
        expect((await db.getV3Pool(POOL))?.token0).toBe(NURA);
    });

    it('holds full uint256 balances without truncating them', async () =>
    {
        // uint256 does not fit any native integer column - BIGINT is i64 and a
        // double loses everything past 2^53. NUMERIC(78,0) holds all 78 digits,
        // and the string crossing keeps the driver from rounding on the way out.
        const db = await freshDb();
        await db.upsertV3Pool({ address: POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 1 });
        await db.updateV3Balances(POOL, MAX_UINT256, MAX_UINT256 - 1n);
        expect((await db.getV3Pool(POOL))?.balance0).toBe(MAX_UINT256);
        expect((await db.getV3Pool(POOL))?.balance1).toBe(MAX_UINT256 - 1n);
    });

    it('treats a balance update for an unknown pool as a no-op', async () =>
    {
        const db = await freshDb();
        await expect(db.updateV3Balances(POOL, 1n, 2n)).resolves.toBeUndefined();
        expect(await db.getV3Pool(POOL)).toBeNull();
    });

    it('lists pools in creation order', async () =>
    {
        const db = await freshDb();
        await db.upsertV3Pool({ address: OTHER_POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 20 });
        await db.upsertV3Pool({ address: POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 10 });
        expect((await db.listV3Pools()).map((pool) => pool.createdBlock)).toEqual([10, 20]);
    });

    it('updates the stored slot0 price in place', async () =>
    {
        const db = await freshDb();
        await db.upsertV3Pool({ address: POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 1 });
        await db.updateV3Price(POOL, (1n << 96n));
        expect((await db.getV3Pool(POOL))?.sqrtPriceX96).toBe(1n << 96n);
        await db.updateV3Price(POOL, (2n << 96n));
        expect((await db.getV3Pool(POOL))?.sqrtPriceX96).toBe(2n << 96n);
    });

    it('holds a full uint160 slot0 price exactly', async () =>
    {
        // sqrtPriceX96 is a uint160 - far past a BIGINT, well inside NUMERIC.
        const db = await freshDb();
        const MAX_UINT160 = (1n << 160n) - 1n;
        await db.upsertV3Pool({ address: POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 1 });
        await db.updateV3Price(POOL, MAX_UINT160);
        expect((await db.getV3Pool(POOL))?.sqrtPriceX96).toBe(MAX_UINT160);
    });
});

describe('events', () =>
{
    it('reports a first insert and refuses the replay of the same log', async () =>
    {
        const db = await freshDb();
        expect(await db.insertEvent(event())).toBe(true);
        expect(await db.insertEvent(event())).toBe(false);
        expect(await db.recentEvents(10)).toHaveLength(1);
    });

    // The key is (block, logIndex) and logIndex is block-global on EVM chains, so
    // two different pools can never collide. Same block, different index must
    // both land - a restart that replayed one block would otherwise drop trades.
    it('keys on block and log index, not on the transaction', async () =>
    {
        const db = await freshDb();
        expect(await db.insertEvent(event({ logIndex: 0, pair: POOL }))).toBe(true);
        expect(await db.insertEvent(event({ logIndex: 1, pair: OTHER_POOL }))).toBe(true);
        expect(await db.insertEvent(event({ blockNumber: 101, logIndex: 0 }))).toBe(true);
        expect(await db.recentEvents(10)).toHaveLength(3);
    });

    it('round-trips uint256 amounts exactly', async () =>
    {
        const db = await freshDb();
        await db.insertEvent(event({
            amount0In: MAX_UINT256,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: MAX_UINT256 - 1n
        }));
        const [row] = await db.recentEvents(1);
        expect(row.amount0In).toBe(MAX_UINT256);
        expect(row.amount1Out).toBe(MAX_UINT256 - 1n);
    });

    it('round-trips block number and timestamp as plain numbers', async () =>
    {
        // BIGINT columns: pg hands int8 back as a string, PGlite as a number. The
        // row mapper coerces either way, so the type a caller sees is fixed.
        const db = await freshDb();
        await db.insertEvent(event({ blockNumber: 123_456_789, timestamp: 1_700_000_123 }));
        const [row] = await db.recentEvents(1);
        expect(row.blockNumber).toBe(123_456_789);
        expect(row.timestamp).toBe(1_700_000_123);
    });

    it('normalizes pool and account case on write', async () =>
    {
        const db = await freshDb();
        await db.insertEvent(event({ pair: POOL.toUpperCase() as Address, account: ALICE.toUpperCase() as Address }));
        expect(await db.recentEvents(10, { pair: POOL })).toHaveLength(1);
        expect(await db.recentEvents(10, { account: ALICE })).toHaveLength(1);
    });

    it('filters case-insensitively, so a checksummed query still matches', async () =>
    {
        const db = await freshDb();
        await db.insertEvent(event({ account: ALICE }));
        expect(await db.recentEvents(10, { account: ALICE.toUpperCase() })).toHaveLength(1);
        expect(await db.recentEvents(10, { pair: POOL.toUpperCase() })).toHaveLength(1);
    });

    it('returns newest first, breaking ties on log index', async () =>
    {
        const db = await freshDb();
        await db.insertEvent(event({ blockNumber: 1, logIndex: 1, timestamp: 100 }));
        await db.insertEvent(event({ blockNumber: 1, logIndex: 2, timestamp: 100 }));
        await db.insertEvent(event({ blockNumber: 2, logIndex: 3, timestamp: 200 }));
        expect((await db.recentEvents(10)).map((row) => row.logIndex)).toEqual([3, 2, 1]);
    });

    it('honours the limit', async () =>
    {
        const db = await freshDb();
        for (let index = 0; index < 10; index++)
        {
            await db.insertEvent(event({ logIndex: index, timestamp: 1000 + index }));
        }
        expect(await db.recentEvents(3)).toHaveLength(3);
        expect(await db.recentEvents(0)).toHaveLength(0);
    });

    it('combines the pool and account filters with AND', async () =>
    {
        const db = await freshDb();
        await db.insertEvent(event({ logIndex: 1, pair: POOL, account: ALICE }));
        await db.insertEvent(event({ logIndex: 2, pair: POOL, account: BOB }));
        await db.insertEvent(event({ logIndex: 3, pair: OTHER_POOL, account: ALICE }));
        expect(await db.recentEvents(10, { pair: POOL, account: ALICE })).toHaveLength(1);
        expect(await db.recentEvents(10, { pair: POOL })).toHaveLength(2);
        expect(await db.recentEvents(10, { account: ALICE })).toHaveLength(2);
    });

    it('answers an empty list for an account with no history', async () =>
    {
        const db = await freshDb();
        await db.insertEvent(event({ account: ALICE }));
        expect(await db.recentEvents(10, { account: BOB })).toEqual([]);
    });

    it('preserves the event kind', async () =>
    {
        const db = await freshDb();
        await db.insertEvent(event({ logIndex: 1, kind: 'swap' }));
        await db.insertEvent(event({ logIndex: 2, kind: 'mint' }));
        await db.insertEvent(event({ logIndex: 3, kind: 'burn' }));
        expect((await db.recentEvents(10)).map((row) => row.kind).sort()).toEqual(['burn', 'mint', 'swap']);
    });
});

// Every query in this layer sends its values as bound $n parameters. These pin
// that: the filters take user-supplied strings straight off the query string of
// /api/market/txs, so a value that closes a quote must be treated as a value.
describe('parameter binding is injection-proof', () =>
{
    const HOSTILE = "0xaa' OR '1'='1";

    it('treats an injection payload in an account filter as a literal', async () =>
    {
        const db = await freshDb();
        await db.insertEvent(event({ account: ALICE }));
        expect(await db.recentEvents(10, { account: HOSTILE })).toEqual([]);
        expect(await db.recentEvents(10)).toHaveLength(1);
    });

    it('treats an injection payload in a pool filter as a literal', async () =>
    {
        const db = await freshDb();
        await db.insertEvent(event({ pair: POOL }));
        expect(await db.recentEvents(10, { pair: HOSTILE })).toEqual([]);
    });

    it('does not let a lookup drop a table', async () =>
    {
        const db = await freshDb();
        await db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        expect(await db.getToken("x'; DROP TABLE tokens; --")).toBeNull();
        expect(await db.getV3Pool("x'; DROP TABLE v3_pools; --")).toBeNull();
        expect(await db.candles("x'; DROP TABLE candles; --", 0)).toEqual([]);
        // The table is still there, with its row.
        expect((await db.getToken(USDT))?.symbol).toBe('mUSDT');
    });
});

describe('candles', () =>
{
    const HOUR = 3600;

    it('opens a candle on the first point of an hour', async () =>
    {
        const db = await freshDb();
        await db.recordCandlePoint(POOL, HOUR, 100n, 5n, 7n);
        const [candle] = await db.candles(POOL, 0);
        expect(candle).toEqual({
            pair: POOL,
            hourStart: HOUR,
            open: 100n,
            high: 100n,
            low: 100n,
            close: 100n,
            volume0: 5n,
            volume1: 7n
        });
    });

    it('merges later points into the same hour, tracking high, low and close', async () =>
    {
        const db = await freshDb();
        await db.recordCandlePoint(POOL, HOUR, 100n, 1n, 1n);
        await db.recordCandlePoint(POOL, HOUR, 140n, 2n, 2n);
        await db.recordCandlePoint(POOL, HOUR, 80n, 3n, 3n);
        await db.recordCandlePoint(POOL, HOUR, 120n, 4n, 4n);
        const [candle] = await db.candles(POOL, 0);
        expect(candle.open).toBe(100n);
        expect(candle.high).toBe(140n);
        expect(candle.low).toBe(80n);
        // The close is the LAST point, not the highest or the latest extreme.
        expect(candle.close).toBe(120n);
        expect(candle.volume0).toBe(10n);
        expect(candle.volume1).toBe(10n);
    });

    it('compares high and low numerically, not as text', async () =>
    {
        // As strings '9' > '10'. The merge runs GREATEST/LEAST on NUMERIC, so a
        // price that gains a digit is still the higher one.
        const db = await freshDb();
        await db.recordCandlePoint(POOL, HOUR, 9n, 1n, 1n);
        await db.recordCandlePoint(POOL, HOUR, 10n, 1n, 1n);
        await db.recordCandlePoint(POOL, HOUR, MAX_UINT256, 1n, 1n);
        await db.recordCandlePoint(POOL, HOUR, 2n, 1n, 1n);
        const [candle] = await db.candles(POOL, 0);
        expect(candle.high).toBe(MAX_UINT256);
        expect(candle.low).toBe(2n);
        expect(candle.open).toBe(9n);
        expect(candle.close).toBe(2n);
    });

    it('accumulates volume past the 64-bit ceiling', async () =>
    {
        // The sum runs in the database, on NUMERIC - not in a BIGINT that would
        // overflow, nor in a double that would round.
        const db = await freshDb();
        await db.recordCandlePoint(POOL, HOUR, 1n, MAX_UINT256 / 3n, MAX_UINT256 / 3n);
        await db.recordCandlePoint(POOL, HOUR, 1n, MAX_UINT256 / 3n, MAX_UINT256 / 3n);
        const [candle] = await db.candles(POOL, 0);
        expect(candle.volume0 > (1n << 63n)).toBe(true);
        expect(candle.volume0).toBe((MAX_UINT256 / 3n) * 2n);
    });

    it('keeps hours and pools in separate rows', async () =>
    {
        const db = await freshDb();
        await db.recordCandlePoint(POOL, HOUR, 10n, 1n, 1n);
        await db.recordCandlePoint(POOL, 2 * HOUR, 20n, 1n, 1n);
        await db.recordCandlePoint(OTHER_POOL, HOUR, 30n, 1n, 1n);
        expect(await db.candles(POOL, 0)).toHaveLength(2);
        expect(await db.candles(OTHER_POOL, 0)).toHaveLength(1);
        expect((await db.candles(OTHER_POOL, 0))[0].open).toBe(30n);
    });

    it('returns candles in chronological order from the requested hour', async () =>
    {
        const db = await freshDb();
        await db.recordCandlePoint(POOL, 3 * HOUR, 30n, 1n, 1n);
        await db.recordCandlePoint(POOL, HOUR, 10n, 1n, 1n);
        await db.recordCandlePoint(POOL, 2 * HOUR, 20n, 1n, 1n);
        expect((await db.candles(POOL, 0)).map((candle) => candle.hourStart)).toEqual([HOUR, 2 * HOUR, 3 * HOUR]);
        // The bound is inclusive.
        expect((await db.candles(POOL, 2 * HOUR)).map((candle) => candle.hourStart)).toEqual([2 * HOUR, 3 * HOUR]);
        expect(await db.candles(POOL, 99 * HOUR)).toEqual([]);
    });

    it('is case-insensitive on the pool address', async () =>
    {
        const db = await freshDb();
        await db.recordCandlePoint(POOL.toUpperCase(), HOUR, 10n, 1n, 1n);
        expect(await db.candles(POOL, 0)).toHaveLength(1);
    });

    it('reads the last close straight off the primary key', async () =>
    {
        const db = await freshDb();
        expect(await db.latestClose(POOL)).toBeNull();
        await db.recordCandlePoint(POOL, HOUR, 10n, 1n, 1n);
        await db.recordCandlePoint(POOL, 2 * HOUR, 20n, 1n, 1n);
        expect(await db.latestClose(POOL)).toBe(20n);
    });
});

describe('volumeSince', () =>
{
    const HOUR = 3600;

    it('sums the window and excludes hours before it', async () =>
    {
        const db = await freshDb();
        await db.recordCandlePoint(POOL, HOUR, 1n, 10n, 100n);
        await db.recordCandlePoint(POOL, 2 * HOUR, 1n, 20n, 200n);
        await db.recordCandlePoint(POOL, 3 * HOUR, 1n, 30n, 300n);
        expect(await db.volumeSince(POOL, 0)).toEqual({ volume0: 60n, volume1: 600n });
        // Inclusive lower bound: the 2h candle counts.
        expect(await db.volumeSince(POOL, 2 * HOUR)).toEqual({ volume0: 50n, volume1: 500n });
        expect(await db.volumeSince(POOL, 4 * HOUR)).toEqual({ volume0: 0n, volume1: 0n });
    });

    it('is zero for a pool that has never traded', async () =>
    {
        const db = await freshDb();
        expect(await db.volumeSince(POOL, 0)).toEqual({ volume0: 0n, volume1: 0n });
    });

    it('does not mix one pool volume into another', async () =>
    {
        const db = await freshDb();
        await db.recordCandlePoint(POOL, HOUR, 1n, 10n, 10n);
        await db.recordCandlePoint(OTHER_POOL, HOUR, 1n, 99n, 99n);
        expect(await db.volumeSince(POOL, 0)).toEqual({ volume0: 10n, volume1: 10n });
    });

    it('sums uint256-sized volumes across hours without losing digits', async () =>
    {
        const db = await freshDb();
        await db.recordCandlePoint(POOL, HOUR, 1n, MAX_UINT256 / 4n, 1n);
        await db.recordCandlePoint(POOL, 2 * HOUR, 1n, MAX_UINT256 / 4n, 1n);
        expect(await db.volumeSince(POOL, 0)).toEqual({ volume0: (MAX_UINT256 / 4n) * 2n, volume1: 2n });
    });
});

describe('wipe', () =>
{
    it('clears every table, including the identity it was keyed on', async () =>
    {
        const db = await freshDb();
        await db.setMeta('identity', 'chain:factory');
        await db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        await db.upsertV3Pool({ address: POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 1 });
        await db.insertEvent(event());
        await db.recordCandlePoint(POOL, 3600, 1n, 1n, 1n);

        await db.wipe();

        expect(await db.getMeta('identity')).toBeNull();
        expect(await db.listTokens()).toEqual([]);
        expect(await db.listV3Pools()).toEqual([]);
        expect(await db.recentEvents(10)).toEqual([]);
        expect(await db.candles(POOL, 0)).toEqual([]);
    });

    it('leaves the schema usable, so the re-index can write immediately', async () =>
    {
        const db = await freshDb();
        await db.upsertV3Pool({ address: POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 1 });
        await db.wipe();
        await db.upsertV3Pool({ address: POOL, token0: NURA, token1: USDT, fee: 500, createdBlock: 2 });
        expect((await db.getV3Pool(POOL))?.createdBlock).toBe(2);
    });
});
