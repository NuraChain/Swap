// The indexer's storage layer, exercised against a real in-memory SQLite - the
// same engine production runs, not a stand-in. What is being defended here is
// mostly one property: this database holds MONEY numbers in a store whose native
// integer is a signed 64-bit, so every amount crosses as TEXT and every read has
// to bring the exact bigint back. A silently truncated reserve is a wrong price
// on every screen that reads it.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { IndexerDb } from '../src/indexer/db.ts';
import type { Address, EventRow } from '../src/indexer/db.ts';

const PAIR = '0x00000000000000000000000000000000000000aa' as Address;
const OTHER_PAIR = '0x00000000000000000000000000000000000000bb' as Address;
const NURA = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const ALICE = '0x00000000000000000000000000000000000000c1' as Address;
const BOB = '0x00000000000000000000000000000000000000c2' as Address;

/** uint112 max - the largest reserve a UniswapV2 pair can hold. */
const MAX_UINT112 = (1n << 112n) - 1n;
/** uint256 max - the largest amount a Swap event can carry. */
const MAX_UINT256 = (1n << 256n) - 1n;

const open: IndexerDb[] = [];
const scratchDirs: string[] = [];

// The migration path needs a database that OUTLIVES one connection, which an
// in-memory one does not - it dies with the handle that opened it.
function scratchPath(): string
{
    const dir = mkdtempSync(join(tmpdir(), 'nuraswap-db-'));
    scratchDirs.push(dir);
    return join(dir, 'chain.db');
}

function freshDb(): IndexerDb
{
    const db = new IndexerDb(':memory:');
    open.push(db);
    return db;
}

afterEach(() =>
{
    // Every database this file opens is closed, so a failing assertion cannot
    // leak a handle into the next test file.
    while (open.length > 0)
    {
        open.pop()?.close();
    }
    while (scratchDirs.length > 0)
    {
        rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
    }
});

describe('schema migration', () =>
{
    // An indexer restart must not be a reindex. CREATE TABLE IF NOT EXISTS does
    // nothing to a table that already exists, so every column added after the
    // fact has to be added in place - and a server that cannot open its own
    // database does not start at all.
    it('adds columns to a database written before they existed', () =>
    {
        const path = scratchPath();
        const old = new DatabaseSync(path);
        old.exec(`
            CREATE TABLE events (
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
            CREATE TABLE v3_pools (
                address TEXT PRIMARY KEY,
                token0 TEXT NOT NULL,
                token1 TEXT NOT NULL,
                fee INTEGER NOT NULL,
                created_block INTEGER NOT NULL
            );
        `);
        old.prepare('INSERT INTO events (block_number, log_index, tx_hash, ts, pair, kind, account, amount0_in) '
            + "VALUES (1, 0, '0xold', 100, ?, 'swap', ?, '5')").run(PAIR, ALICE);
        old.prepare('INSERT INTO v3_pools (address, token0, token1, fee, created_block) VALUES (?, ?, ?, 500, 3)')
            .run(OTHER_PAIR, NURA, USDT);
        old.close();

        const db = new IndexerDb(path);
        open.push(db);

        // The row predates the column, and it was a V2 row by definition - which
        // is exactly what the DEFAULT has to say for the read to stay truthful.
        const [event] = db.recentEvents(10);
        expect(event.protocol).toBe('v2');
        expect(event.amount0In).toBe(5n);

        // A pool whose balances and price were never read is not a pool worth
        // zero - but zero is what it holds until the first read lands, and the
        // price map skips a pool quoting nothing rather than pricing off it.
        const pool = db.getV3Pool(OTHER_PAIR);
        expect(pool?.fee).toBe(500);
        expect(pool?.balance0).toBe(0n);
        expect(pool?.sqrtPriceX96).toBe(0n);
    });

    it('is idempotent - a second open of a migrated database changes nothing', () =>
    {
        const path = scratchPath();
        const first = new IndexerDb(path);
        first.upsertV3Pool({ address: OTHER_PAIR, token0: NURA, token1: USDT, fee: 500, createdBlock: 3 });
        first.updateV3Price(OTHER_PAIR, 12345n);
        first.close();

        const second = new IndexerDb(path);
        open.push(second);
        expect(second.getV3Pool(OTHER_PAIR)?.sqrtPriceX96).toBe(12345n);
    });
});

function event(overrides: Partial<EventRow> = {}): EventRow
{
    return {
        blockNumber: 100,
        logIndex: 0,
        txHash: '0xaaa',
        timestamp: 1_700_000_000,
        pair: PAIR,
        kind: 'swap',
        protocol: 'v2',
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
    it('answers null for a key never written', () =>
    {
        expect(freshDb().getMeta('cursor')).toBeNull();
    });

    it('round-trips and then overwrites in place', () =>
    {
        const db = freshDb();
        db.setMeta('cursor', '10');
        expect(db.getMeta('cursor')).toBe('10');
        db.setMeta('cursor', '20');
        expect(db.getMeta('cursor')).toBe('20');
    });

    it('keeps keys independent', () =>
    {
        const db = freshDb();
        db.setMeta('cursor', '10');
        db.setMeta('identity', 'chain:factory');
        expect(db.getMeta('cursor')).toBe('10');
        expect(db.getMeta('identity')).toBe('chain:factory');
    });

    it('stores an empty value rather than treating it as absent', () =>
    {
        // The live indexer writes '' for a block with no hash; that has to read
        // back as a written value, not as "never indexed".
        const db = freshDb();
        db.setMeta('cursorHash', '');
        expect(db.getMeta('cursorHash')).toBe('');
        expect(db.getMeta('cursorHash')).not.toBeNull();
    });
});

describe('tokens', () =>
{
    it('inserts and reads back a token', () =>
    {
        const db = freshDb();
        db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        expect(db.getToken(USDT)).toEqual({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
    });

    // Addresses arrive checksummed from viem and lowercased from the artifact.
    // Two spellings of one token would be two rows, and the price map keys on the
    // address - a token priced under one spelling reads as unpriced under the other.
    it('normalizes address case on write and on read', () =>
    {
        const db = freshDb();
        db.upsertToken({ address: USDT.toUpperCase() as Address, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        expect(db.getToken(USDT)?.symbol).toBe('mUSDT');
        expect(db.getToken(USDT.toUpperCase())?.symbol).toBe('mUSDT');
        expect(db.listTokens()).toHaveLength(1);
    });

    it('updates metadata on re-upsert instead of duplicating the row', () =>
    {
        const db = freshDb();
        db.upsertToken({ address: USDT, symbol: '???', name: 'Unknown token', decimals: 18 });
        db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        expect(db.listTokens()).toHaveLength(1);
        expect(db.getToken(USDT)).toEqual({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
    });

    it('answers null for an unknown token rather than throwing', () =>
    {
        expect(freshDb().getToken('0x00000000000000000000000000000000000000ff')).toBeNull();
    });

    it('lists tokens ordered by symbol', () =>
    {
        const db = freshDb();
        db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'b', decimals: 6 });
        db.upsertToken({ address: NURA, symbol: 'NURA', name: 'a', decimals: 18 });
        expect(db.listTokens().map((token) => token.symbol)).toEqual(['NURA', 'mUSDT']);
    });

    it('accepts zero decimals - a real ERC20 shape, not a missing value', () =>
    {
        const db = freshDb();
        db.upsertToken({ address: USDT, symbol: 'ZERO', name: 'Zero decimals', decimals: 0 });
        expect(db.getToken(USDT)?.decimals).toBe(0);
    });
});

describe('pairs', () =>
{
    it('stores a pair and reads its reserves back as bigints', () =>
    {
        const db = freshDb();
        db.upsertPair({ address: PAIR, token0: NURA, token1: USDT, createdBlock: 7 });
        const row = db.getPair(PAIR);
        expect(row).not.toBeNull();
        expect(row?.token0).toBe(NURA);
        expect(row?.createdBlock).toBe(7);
        // A pair that has never synced reads zero, not null or NaN.
        expect(row?.reserve0).toBe(0n);
        expect(row?.reserve1).toBe(0n);
    });

    // PairCreated is emitted once per pair, but the tail gets replayed on restart
    // and after a reorg rewind. A second insert must not reset the reserves the
    // scan has already learned.
    it('ignores a duplicate creation instead of clobbering live reserves', () =>
    {
        const db = freshDb();
        db.upsertPair({ address: PAIR, token0: NURA, token1: USDT, createdBlock: 7 });
        db.updateReserves(PAIR, 100n, 200n);
        db.upsertPair({ address: PAIR, token0: USDT, token1: NURA, createdBlock: 9 });
        const row = db.getPair(PAIR);
        expect(row?.reserve0).toBe(100n);
        expect(row?.reserve1).toBe(200n);
        expect(row?.token0).toBe(NURA);
        expect(row?.createdBlock).toBe(7);
    });

    it('normalizes address case across creation, update and lookup', () =>
    {
        const db = freshDb();
        db.upsertPair({
            address: PAIR.toUpperCase() as Address,
            token0: NURA.toUpperCase() as Address,
            token1: USDT,
            createdBlock: 1
        });
        db.updateReserves(PAIR.toUpperCase(), 5n, 6n);
        expect(db.getPair(PAIR)?.reserve0).toBe(5n);
        expect(db.getPair(PAIR)?.token0).toBe(NURA);
    });

    it('holds a full uint112 reserve without truncating it', () =>
    {
        // SQLite's native integer is i64; uint112 does not fit. This is the whole
        // reason reserves are TEXT columns.
        const db = freshDb();
        db.upsertPair({ address: PAIR, token0: NURA, token1: USDT, createdBlock: 1 });
        db.updateReserves(PAIR, MAX_UINT112, MAX_UINT112 - 1n);
        expect(db.getPair(PAIR)?.reserve0).toBe(MAX_UINT112);
        expect(db.getPair(PAIR)?.reserve1).toBe(MAX_UINT112 - 1n);
    });

    it('treats a reserve update for an unknown pair as a no-op', () =>
    {
        const db = freshDb();
        expect(() => db.updateReserves(PAIR, 1n, 2n)).not.toThrow();
        expect(db.getPair(PAIR)).toBeNull();
    });

    it('lists pairs in creation order', () =>
    {
        const db = freshDb();
        db.upsertPair({ address: OTHER_PAIR, token0: NURA, token1: USDT, createdBlock: 20 });
        db.upsertPair({ address: PAIR, token0: NURA, token1: USDT, createdBlock: 10 });
        expect(db.listPairs().map((pair) => pair.createdBlock)).toEqual([10, 20]);
    });
});

describe('events', () =>
{
    it('reports a first insert and refuses the replay of the same log', () =>
    {
        const db = freshDb();
        expect(db.insertEvent(event())).toBe(true);
        expect(db.insertEvent(event())).toBe(false);
        expect(db.recentEvents(10)).toHaveLength(1);
    });

    // The key is (block, logIndex) and logIndex is block-global on EVM chains, so
    // two different pairs can never collide. Same block, different index must
    // both land - a restart that replayed one block would otherwise drop trades.
    it('keys on block and log index, not on the transaction', () =>
    {
        const db = freshDb();
        expect(db.insertEvent(event({ logIndex: 0, pair: PAIR }))).toBe(true);
        expect(db.insertEvent(event({ logIndex: 1, pair: OTHER_PAIR }))).toBe(true);
        expect(db.insertEvent(event({ blockNumber: 101, logIndex: 0 }))).toBe(true);
        expect(db.recentEvents(10)).toHaveLength(3);
    });

    it('round-trips uint256 amounts exactly', () =>
    {
        const db = freshDb();
        db.insertEvent(event({
            amount0In: MAX_UINT256,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: MAX_UINT256 - 1n
        }));
        const [row] = db.recentEvents(1);
        expect(row.amount0In).toBe(MAX_UINT256);
        expect(row.amount1Out).toBe(MAX_UINT256 - 1n);
    });

    it('normalizes pair and account case on write', () =>
    {
        const db = freshDb();
        db.insertEvent(event({ pair: PAIR.toUpperCase() as Address, account: ALICE.toUpperCase() as Address }));
        expect(db.recentEvents(10, { pair: PAIR })).toHaveLength(1);
        expect(db.recentEvents(10, { account: ALICE })).toHaveLength(1);
    });

    it('filters case-insensitively, so a checksummed query still matches', () =>
    {
        const db = freshDb();
        db.insertEvent(event({ account: ALICE }));
        expect(db.recentEvents(10, { account: ALICE.toUpperCase() })).toHaveLength(1);
        expect(db.recentEvents(10, { pair: PAIR.toUpperCase() })).toHaveLength(1);
    });

    it('returns newest first, breaking ties on log index', () =>
    {
        const db = freshDb();
        db.insertEvent(event({ blockNumber: 1, logIndex: 1, timestamp: 100 }));
        db.insertEvent(event({ blockNumber: 1, logIndex: 2, timestamp: 100 }));
        db.insertEvent(event({ blockNumber: 2, logIndex: 3, timestamp: 200 }));
        expect(db.recentEvents(10).map((row) => row.logIndex)).toEqual([3, 2, 1]);
    });

    it('honours the limit', () =>
    {
        const db = freshDb();
        for (let index = 0; index < 10; index++)
        {
            db.insertEvent(event({ logIndex: index, timestamp: 1000 + index }));
        }
        expect(db.recentEvents(3)).toHaveLength(3);
        expect(db.recentEvents(0)).toHaveLength(0);
    });

    it('combines the pair and account filters with AND', () =>
    {
        const db = freshDb();
        db.insertEvent(event({ logIndex: 1, pair: PAIR, account: ALICE }));
        db.insertEvent(event({ logIndex: 2, pair: PAIR, account: BOB }));
        db.insertEvent(event({ logIndex: 3, pair: OTHER_PAIR, account: ALICE }));
        expect(db.recentEvents(10, { pair: PAIR, account: ALICE })).toHaveLength(1);
        expect(db.recentEvents(10, { pair: PAIR })).toHaveLength(2);
        expect(db.recentEvents(10, { account: ALICE })).toHaveLength(2);
    });

    it('answers an empty list for an account with no history', () =>
    {
        const db = freshDb();
        db.insertEvent(event({ account: ALICE }));
        expect(db.recentEvents(10, { account: BOB })).toEqual([]);
    });

    it('preserves the event kind', () =>
    {
        const db = freshDb();
        db.insertEvent(event({ logIndex: 1, kind: 'swap' }));
        db.insertEvent(event({ logIndex: 2, kind: 'mint' }));
        db.insertEvent(event({ logIndex: 3, kind: 'burn' }));
        expect(db.recentEvents(10).map((row) => row.kind).sort()).toEqual(['burn', 'mint', 'swap']);
    });
});

// Every query in this layer is a prepared statement with bound parameters. These
// pin that: the filters take user-supplied strings straight off the query string
// of /api/market/txs, so a value that closes a quote must be treated as a value.
describe('parameter binding is injection-proof', () =>
{
    const HOSTILE = "0xaa' OR '1'='1";

    it('treats an injection payload in an account filter as a literal', () =>
    {
        const db = freshDb();
        db.insertEvent(event({ account: ALICE }));
        expect(db.recentEvents(10, { account: HOSTILE })).toEqual([]);
        expect(db.recentEvents(10)).toHaveLength(1);
    });

    it('treats an injection payload in a pair filter as a literal', () =>
    {
        const db = freshDb();
        db.insertEvent(event({ pair: PAIR }));
        expect(db.recentEvents(10, { pair: HOSTILE })).toEqual([]);
    });

    it('does not let a lookup drop a table', () =>
    {
        const db = freshDb();
        db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        expect(db.getToken("x'; DROP TABLE tokens; --")).toBeNull();
        expect(db.getPair("x'; DROP TABLE pairs; --")).toBeNull();
        expect(db.candles("x'; DROP TABLE candles; --", 0)).toEqual([]);
        // The table is still there, with its row.
        expect(db.getToken(USDT)?.symbol).toBe('mUSDT');
    });
});

describe('candles', () =>
{
    const HOUR = 3600;

    it('opens a candle on the first point of an hour', () =>
    {
        const db = freshDb();
        db.recordCandlePoint(PAIR, HOUR, 100n, 5n, 7n);
        const [candle] = db.candles(PAIR, 0);
        expect(candle).toEqual({
            pair: PAIR,
            hourStart: HOUR,
            open: 100n,
            high: 100n,
            low: 100n,
            close: 100n,
            volume0: 5n,
            volume1: 7n
        });
    });

    it('merges later points into the same hour, tracking high, low and close', () =>
    {
        const db = freshDb();
        db.recordCandlePoint(PAIR, HOUR, 100n, 1n, 1n);
        db.recordCandlePoint(PAIR, HOUR, 140n, 2n, 2n);
        db.recordCandlePoint(PAIR, HOUR, 80n, 3n, 3n);
        db.recordCandlePoint(PAIR, HOUR, 120n, 4n, 4n);
        const [candle] = db.candles(PAIR, 0);
        expect(candle.open).toBe(100n);
        expect(candle.high).toBe(140n);
        expect(candle.low).toBe(80n);
        // The close is the LAST point, not the highest or the latest extreme.
        expect(candle.close).toBe(120n);
        expect(candle.volume0).toBe(10n);
        expect(candle.volume1).toBe(10n);
    });

    it('accumulates volume past the i64 ceiling', () =>
    {
        const db = freshDb();
        db.recordCandlePoint(PAIR, HOUR, 1n, MAX_UINT112, MAX_UINT112);
        db.recordCandlePoint(PAIR, HOUR, 1n, MAX_UINT112, MAX_UINT112);
        const [candle] = db.candles(PAIR, 0);
        expect(candle.volume0).toBe(MAX_UINT112 * 2n);
        expect(candle.volume1).toBe(MAX_UINT112 * 2n);
    });

    it('keeps hours and pairs in separate rows', () =>
    {
        const db = freshDb();
        db.recordCandlePoint(PAIR, HOUR, 10n, 1n, 1n);
        db.recordCandlePoint(PAIR, 2 * HOUR, 20n, 1n, 1n);
        db.recordCandlePoint(OTHER_PAIR, HOUR, 30n, 1n, 1n);
        expect(db.candles(PAIR, 0)).toHaveLength(2);
        expect(db.candles(OTHER_PAIR, 0)).toHaveLength(1);
        expect(db.candles(OTHER_PAIR, 0)[0].open).toBe(30n);
    });

    it('returns candles in chronological order from the requested hour', () =>
    {
        const db = freshDb();
        db.recordCandlePoint(PAIR, 3 * HOUR, 30n, 1n, 1n);
        db.recordCandlePoint(PAIR, HOUR, 10n, 1n, 1n);
        db.recordCandlePoint(PAIR, 2 * HOUR, 20n, 1n, 1n);
        expect(db.candles(PAIR, 0).map((candle) => candle.hourStart)).toEqual([HOUR, 2 * HOUR, 3 * HOUR]);
        // The bound is inclusive.
        expect(db.candles(PAIR, 2 * HOUR).map((candle) => candle.hourStart)).toEqual([2 * HOUR, 3 * HOUR]);
        expect(db.candles(PAIR, 99 * HOUR)).toEqual([]);
    });

    it('is case-insensitive on the pair address', () =>
    {
        const db = freshDb();
        db.recordCandlePoint(PAIR.toUpperCase(), HOUR, 10n, 1n, 1n);
        expect(db.candles(PAIR, 0)).toHaveLength(1);
    });
});

describe('volumeSince', () =>
{
    const HOUR = 3600;

    it('sums the window and excludes hours before it', () =>
    {
        const db = freshDb();
        db.recordCandlePoint(PAIR, HOUR, 1n, 10n, 100n);
        db.recordCandlePoint(PAIR, 2 * HOUR, 1n, 20n, 200n);
        db.recordCandlePoint(PAIR, 3 * HOUR, 1n, 30n, 300n);
        expect(db.volumeSince(PAIR, 0)).toEqual({ volume0: 60n, volume1: 600n });
        // Inclusive lower bound: the 2h candle counts.
        expect(db.volumeSince(PAIR, 2 * HOUR)).toEqual({ volume0: 50n, volume1: 500n });
        expect(db.volumeSince(PAIR, 4 * HOUR)).toEqual({ volume0: 0n, volume1: 0n });
    });

    it('is zero for a pair that has never traded', () =>
    {
        expect(freshDb().volumeSince(PAIR, 0)).toEqual({ volume0: 0n, volume1: 0n });
    });

    it('does not mix one pair volume into another', () =>
    {
        const db = freshDb();
        db.recordCandlePoint(PAIR, HOUR, 1n, 10n, 10n);
        db.recordCandlePoint(OTHER_PAIR, HOUR, 1n, 99n, 99n);
        expect(db.volumeSince(PAIR, 0)).toEqual({ volume0: 10n, volume1: 10n });
    });
});

describe('wipe', () =>
{
    it('clears every table, including the identity it was keyed on', () =>
    {
        const db = freshDb();
        db.setMeta('identity', 'chain:factory');
        db.upsertToken({ address: USDT, symbol: 'mUSDT', name: 'Mock Tether', decimals: 6 });
        db.upsertPair({ address: PAIR, token0: NURA, token1: USDT, createdBlock: 1 });
        db.insertEvent(event());
        db.recordCandlePoint(PAIR, 3600, 1n, 1n, 1n);

        db.wipe();

        expect(db.getMeta('identity')).toBeNull();
        expect(db.listTokens()).toEqual([]);
        expect(db.listPairs()).toEqual([]);
        expect(db.recentEvents(10)).toEqual([]);
        expect(db.candles(PAIR, 0)).toEqual([]);
    });

    it('leaves the schema usable, so the re-index can write immediately', () =>
    {
        const db = freshDb();
        db.upsertPair({ address: PAIR, token0: NURA, token1: USDT, createdBlock: 1 });
        db.wipe();
        db.upsertPair({ address: PAIR, token0: NURA, token1: USDT, createdBlock: 2 });
        expect(db.getPair(PAIR)?.createdBlock).toBe(2);
    });
});
