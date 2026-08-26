// The indexer over V3 events: the factory and pool ABIs, the signed-delta
// mapping, and the events that must NOT become rows. Every log here is encoded
// by viem from the same ABI the decoder parses, so a signature typo fails the
// test rather than silently indexing nothing on a live chain.

import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { describe, expect, it } from 'vitest';

import { HOUR, applyEvent, fillCandles, hourStartOf } from '../src/indexer/apply.ts';
import { V3_FACTORY_ABI, V3_POOL_ABI, decodeLog } from '../src/indexer/decode.ts';
import { IndexerDb } from '../src/indexer/db.ts';
import type { ApplyContext } from '../src/indexer/apply.ts';
import type { RawLog } from '../src/indexer/decode.ts';
import type { Address, TokenRow } from '../src/indexer/db.ts';

const FACTORY = '0x00000000000000000000000000000000000000f3' as Address;
const POOL = '0x00000000000000000000000000000000000000bb' as Address;
const POOL_TWO = '0x00000000000000000000000000000000000000bc' as Address;
const NURA = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const TRADER = '0x00000000000000000000000000000000000000cc' as Address;
const ROUTER = '0x00000000000000000000000000000000000000dd' as Address;
// Every position minted through the manager names the MANAGER as its owner -
// which is exactly why the decoder's account is not the final word.
const MANAGER = '0x00000000000000000000000000000000000000ee' as Address;

const TOKENS: TokenRow[] = [
    { address: NURA, symbol: 'NURA', name: 'Nura', decimals: 18 },
    { address: USDT, symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 }
];

const context: ApplyContext = {
    timestampOf: (blockNumber) => 1_700_000_000 + blockNumber * 3,
    decimalsOf: (address) => TOKENS.find((token) => token.address === address.toLowerCase())?.decimals ?? 18
};

function freshDb(): IndexerDb
{
    const db = new IndexerDb(':memory:');
    for (const token of TOKENS)
    {
        db.upsertToken(token);
    }
    return db;
}

// viem types an encoded topic list as possibly holding arrays and nulls (the
// shape an unindexed or array-indexed argument would take); a concrete event
// never does, so the cast happens once here rather than at every call site.
function log(address: Address, topics: readonly unknown[], data: string, overrides: Partial<RawLog> = {}): RawLog
{
    return {
        address,
        topics: topics as unknown as RawLog['topics'],
        data: data as `0x${ string }`,
        blockNumber: 20n,
        logIndex: 0,
        transactionHash: '0xf3',
        ...overrides
    };
}

function poolCreatedLog(): RawLog
{
    return log(
        FACTORY,
        encodeEventTopics({ abi: V3_FACTORY_ABI, eventName: 'PoolCreated', args: { token0: NURA, token1: USDT, fee: 500 } }),
        encodeAbiParameters([{ type: 'int24' }, { type: 'address' }], [10, POOL])
    );
}

// amount0/amount1 are the POOL's deltas: positive is what it took in.
function v3SwapLog(amount0: bigint, amount1: bigint, overrides: Partial<RawLog> = {}): RawLog
{
    return log(
        POOL,
        encodeEventTopics({ abi: V3_POOL_ABI, eventName: 'Swap', args: { sender: ROUTER, recipient: TRADER } }),
        encodeAbiParameters(
            [{ type: 'int256' }, { type: 'int256' }, { type: 'uint160' }, { type: 'uint128' }, { type: 'int24' }],
            [amount0, amount1, 1n << 96n, 10_000n, 100]
        ),
        overrides
    );
}

function v3BurnLog(amount0: bigint, amount1: bigint): RawLog
{
    return log(
        POOL,
        encodeEventTopics({
            abi: V3_POOL_ABI,
            eventName: 'Burn',
            args: { owner: MANAGER, tickLower: -887_270, tickUpper: 887_270 }
        }),
        encodeAbiParameters(
            [{ type: 'uint128' }, { type: 'uint256' }, { type: 'uint256' }],
            [5000n, amount0, amount1]
        )
    );
}

describe('decodeLog - factory', () =>
{
    it('decodes a real encoded PoolCreated log', () =>
    {
        const event = decodeLog(poolCreatedLog(), FACTORY);
        expect(event?.kind).toBe('poolCreated');
        if (event?.kind === 'poolCreated')
        {
            expect(event.pool).toBe(POOL);
            expect(event.token0).toBe(NURA);
            expect(event.token1).toBe(USDT);
            expect(event.fee).toBe(500);
            expect(event.blockNumber).toBe(20);
        }
    });
});

describe('decodeLog - pool', () =>
{
    it('maps a swap\'s signed deltas onto the unsigned in/out fields', () =>
    {
        const event = decodeLog(v3SwapLog(5n * 10n ** 18n, -12n * 10n ** 6n), FACTORY);
        expect(event?.kind).toBe('swap');
        if (event?.kind === 'swap')
        {
            expect(event.amount0In).toBe(5n * 10n ** 18n);
            expect(event.amount0Out).toBe(0n);
            expect(event.amount1In).toBe(0n);
            expect(event.amount1Out).toBe(12n * 10n ** 6n);
            expect(event.account).toBe(TRADER);
        }
    });

    it('maps the opposite direction too, without a negative amount escaping', () =>
    {
        const event = decodeLog(v3SwapLog(-7n, 3n), FACTORY);
        if (event?.kind === 'swap')
        {
            expect(event.amount0Out).toBe(7n);
            expect(event.amount1In).toBe(3n);
            expect(event.amount0In).toBe(0n);
            expect(event.amount1Out).toBe(0n);
        }
    });

    it('reports the position manager as a mint\'s account, unresolved', () =>
    {
        const event = decodeLog(
            log(
                POOL,
                encodeEventTopics({
                    abi: V3_POOL_ABI,
                    eventName: 'Mint',
                    args: { owner: MANAGER, tickLower: -887_270, tickUpper: 887_270 }
                }),
                encodeAbiParameters(
                    [{ type: 'address' }, { type: 'uint128' }, { type: 'uint256' }, { type: 'uint256' }],
                    [MANAGER, 5000n, 11n, 22n]
                )
            ),
            FACTORY
        );
        expect(event?.kind).toBe('mint');
        if (event?.kind === 'mint')
        {
            expect(event.amount0).toBe(11n);
            expect(event.amount1).toBe(22n);
            // The decoder stays pure; the live indexer swaps this for the tx sender.
            expect(event.account).toBe(MANAGER);
        }
    });

    it('carries the block, log index and transaction through', () =>
    {
        const decoded = decodeLog(
            v3SwapLog(5n, -9n, { blockNumber: 4242n, logIndex: 17, transactionHash: '0xfeed' }),
            FACTORY
        );
        if (decoded?.kind === 'swap')
        {
            expect(decoded.blockNumber).toBe(4242);
            expect(decoded.logIndex).toBe(17);
            expect(decoded.txHash).toBe('0xfeed');
        }
    });

    // A pool event arriving from the factory address is not a pool event. The
    // factory branch decodes against the factory canon and stops - it must not
    // fall through and credit the factory with a swap.
    it('does not read a pool event emitted from the factory address', () =>
    {
        expect(decodeLog(v3SwapLog(5n, -9n, { address: FACTORY }), FACTORY)).toBeNull();
    });

    it('does not read a PoolCreated emitted by something that is not the factory', () =>
    {
        expect(decodeLog(poolCreatedLog(), POOL_TWO)).toBeNull();
    });

    it('matches the factory address case-insensitively', () =>
    {
        expect(decodeLog(poolCreatedLog(), FACTORY.toUpperCase() as Address)?.kind).toBe('poolCreated');
        expect(decodeLog(log(FACTORY.toUpperCase() as Address, poolCreatedLog().topics, poolCreatedLog().data), FACTORY)?.kind).toBe('poolCreated');
    });

    it('lowercases every address it reports', () =>
    {
        const decoded = decodeLog(
            v3SwapLog(1n, -2n, {
                address: POOL.toUpperCase() as Address,
                topics: encodeEventTopics({ abi: V3_POOL_ABI, eventName: 'Swap', args: { sender: ROUTER, recipient: TRADER } }) as RawLog['topics']
            }),
            FACTORY
        );
        expect(decoded?.kind === 'swap' && decoded.pair).toBe(POOL);
    });

    it('returns null for foreign logs', () =>
    {
        expect(decodeLog(
            { address: POOL, topics: ['0x' + 'ab'.repeat(32) as `0x${ string }`], data: '0x', blockNumber: 1n, logIndex: 0, transactionHash: '0x00' },
            FACTORY
        )).toBeNull();
    });

    it('returns null for a known topic with truncated data', () =>
    {
        expect(decodeLog(log(POOL, v3SwapLog(1n, -2n).topics, '0x00'), FACTORY)).toBeNull();
        expect(decodeLog(log(FACTORY, poolCreatedLog().topics, '0x'), FACTORY)).toBeNull();
    });

    it('returns null for a log with no topics at all', () =>
    {
        expect(decodeLog(log(POOL, [], '0x'), FACTORY)).toBeNull();
        expect(decodeLog(log(FACTORY, [], '0x'), FACTORY)).toBeNull();
    });
});

// Deterministic fuzz: a seeded generator, so a failure reproduces from the seed
// instead of being "it went red once on CI".
function lcg(seed: number): () => number
{
    let state = seed >>> 0;
    return (): number =>
    {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

function randomHex(next: () => number, bytes: number): `0x${ string }`
{
    let out = '';
    for (let index = 0; index < bytes; index++)
    {
        out += Math.floor(next() * 256).toString(16).padStart(2, '0');
    }
    return `0x${ out }`;
}

describe('decodeLog fuzz', () =>
{
    it('never throws on arbitrary bytes, from either address', () =>
    {
        const next = lcg(20_260_820);
        for (let round = 0; round < 400; round++)
        {
            const topics = Array.from({ length: Math.floor(next() * 5) }, () => randomHex(next, 32));
            const data = randomHex(next, Math.floor(next() * 200));
            const from = next() < 0.5 ? FACTORY : POOL;
            expect(() => decodeLog(log(from, topics, data), FACTORY), `round ${ round }`).not.toThrow();
        }
    });

    it('never invents an event out of noise', () =>
    {
        const next = lcg(7);
        let decodedSomething = false;
        for (let round = 0; round < 200; round++)
        {
            const topics = Array.from({ length: 1 + Math.floor(next() * 3) }, () => randomHex(next, 32));
            decodedSomething ||= decodeLog(log(POOL, topics, randomHex(next, 64)), FACTORY) !== null;
        }
        // A random 32-byte topic colliding with a real event signature is a
        // 1-in-2^256 event; anything else would mean the decoder is guessing.
        expect(decodedSomething).toBe(false);
    });

    it('survives a real topic paired with random data', () =>
    {
        const next = lcg(99);
        for (let round = 0; round < 200; round++)
        {
            expect(() => decodeLog(v3SwapLog(5n, -9n, { data: randomHex(next, Math.floor(next() * 160)) }), FACTORY))
                .not.toThrow();
        }
    });
});

describe('applyEvent', () =>
{
    function seedPool(db: IndexerDb): void
    {
        applyEvent(db, decodeLog(poolCreatedLog(), FACTORY)!, context);
    }

    it('stores a created pool by identity, with no reserves to hold', () =>
    {
        const db = freshDb();
        seedPool(db);
        const stored = db.getV3Pool(POOL);
        expect(stored?.token0).toBe(NURA);
        expect(stored?.fee).toBe(500);
        expect(db.listV3Pools()).toHaveLength(1);
    });

    it('charts a swap at the price the swap itself reports', () =>
    {
        const db = freshDb();
        seedPool(db);
        applyEvent(db, decodeLog(v3SwapLog(10n ** 18n, -2n * 10n ** 6n), FACTORY)!, context);

        // In the feed...
        const [row] = db.recentEvents(10);
        expect(row.kind).toBe('swap');
        expect(row.amount1Out).toBe(2n * 10n ** 6n);

        // ...and in the chart. A concentrated pool has no reserves to divide,
        // but its Swap states the post-trade sqrtPriceX96 outright. The fixture
        // trades at Q96 - a raw 1:1 - which over 18 and 6 decimals is 1e30 wad.
        const [candle] = db.candles(POOL, 0);
        expect(candle.close).toBe(10n ** 30n);
        expect(candle.open).toBe(10n ** 30n);
        // Volume counts both sides of the trade.
        expect(candle.volume0).toBe(10n ** 18n);
        expect(candle.volume1).toBe(2n * 10n ** 6n);
    });

    it('stores swaps idempotently', () =>
    {
        const db = freshDb();
        seedPool(db);
        const swap = {
            kind: 'swap' as const,
            pair: POOL,
            blockNumber: 12,
            logIndex: 3,
            txHash: '0xaaa' as const,
            account: TRADER,
            amount0In: 10n ** 18n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 2n * 10n ** 6n,
            sqrtPriceX96: 1n << 96n
        };
        applyEvent(db, swap, context);
        applyEvent(db, swap, context); // replayed tail must not double-count
        expect(db.recentEvents(10)).toHaveLength(1);
        expect(db.candles(POOL, 0)[0].volume0).toBe(10n ** 18n);
    });

    it('charts nothing for a pool it never saw created', () =>
    {
        // No pool row means no token decimals to price the sqrt against, and a
        // candle priced on a guess is worse than no candle.
        const db = freshDb();
        applyEvent(db, decodeLog(v3SwapLog(10n ** 18n, -2n * 10n ** 6n), FACTORY)!, context);
        expect(db.recentEvents(10)).toHaveLength(1);
        expect(db.candles(POOL, 0)).toHaveLength(0);
    });

    it('drops the manager\'s zero-amount burn poke', () =>
    {
        const db = freshDb();
        seedPool(db);

        // `burn(0)` settles a position's fees before a collect. It is a real log
        // describing nothing, and an empty row in somebody's activity is a lie.
        applyEvent(db, decodeLog(v3BurnLog(0n, 0n), FACTORY)!, context);
        expect(db.recentEvents(10)).toHaveLength(0);

        applyEvent(db, decodeLog(v3BurnLog(11n, 22n), FACTORY)!, context);
        expect(db.recentEvents(10)).toHaveLength(1);
    });

    it('stores a mint with both deposited amounts and no outputs', () =>
    {
        const db = freshDb();
        seedPool(db);
        applyEvent(db, {
            kind: 'mint',
            pair: POOL,
            blockNumber: 12,
            logIndex: 0,
            txHash: '0xd1',
            account: TRADER,
            amount0: 11n,
            amount1: 22n
        }, context);
        const [row] = db.recentEvents(10);
        expect(row.kind).toBe('mint');
        expect(row.amount0In).toBe(11n);
        expect(row.amount1In).toBe(22n);
        expect(row.amount0Out).toBe(0n);
        expect(row.amount1Out).toBe(0n);
        // A deposit is not a trade: it must not draw a candle.
        expect(db.candles(POOL, 0)).toEqual([]);
    });

    it('splits trades in different hours into different candles', () =>
    {
        const db = freshDb();
        seedPool(db);
        const hourApart: ApplyContext = {
            ...context,
            timestampOf: (blockNumber) => (blockNumber === 12 ? 1_700_000_000 : 1_700_000_000 + HOUR)
        };
        applyEvent(db, {
            kind: 'swap',
            pair: POOL,
            blockNumber: 12,
            logIndex: 0,
            txHash: '0xh1',
            account: TRADER,
            amount0In: 1n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 1n,
            sqrtPriceX96: 1n << 96n
        }, hourApart);
        applyEvent(db, {
            kind: 'swap',
            pair: POOL,
            blockNumber: 13,
            logIndex: 0,
            txHash: '0xh2',
            account: TRADER,
            amount0In: 1n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 1n,
            sqrtPriceX96: 2n << 96n
        }, hourApart);
        expect(db.candles(POOL, 0)).toHaveLength(2);
    });

    it('merges swaps in the same hour into one candle with high/low', () =>
    {
        const db = freshDb();
        seedPool(db);
        const base = context.timestampOf(12);
        expect(hourStartOf(base)).toBe(hourStartOf(context.timestampOf(13)));

        applyEvent(db, {
            kind: 'swap', pair: POOL, blockNumber: 12, logIndex: 1, txHash: '0x01', account: TRADER,
            amount0In: 10n ** 18n, amount1In: 0n, amount0Out: 0n, amount1Out: 0n,
            sqrtPriceX96: 1n << 96n
        }, context);
        // Price moves: the second trade reports a dearer post-trade price.
        applyEvent(db, {
            kind: 'swap', pair: POOL, blockNumber: 13, logIndex: 5, txHash: '0x02', account: TRADER,
            amount0In: 0n, amount1In: 5n * 10n ** 6n, amount0Out: 0n, amount1Out: 0n,
            sqrtPriceX96: 2n << 96n
        }, context);

        const candles = db.candles(POOL, 0);
        expect(candles).toHaveLength(1);
        expect(candles[0].high > candles[0].open).toBe(true);
        expect(candles[0].close).toBe(candles[0].high);
    });
});

describe('fillCandles', () =>
{
    const point = (hourStart: number, close: bigint) => ({
        hourStart,
        open: close,
        high: close,
        low: close,
        close,
        volume0: 1n,
        volume1: 1n
    });

    it('forward-fills quiet hours with flat candles', () =>
    {
        const filled = fillCandles([point(0, 10n), point(3 * HOUR, 20n)], 4 * HOUR);
        expect(filled.map((candle) => candle.hourStart)).toEqual([0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR]);
        expect(filled[1].close).toBe(10n);
        expect(filled[1].volume0).toBe(0n);
        expect(filled[4].close).toBe(20n);
    });

    it('returns empty for no candles', () =>
    {
        expect(fillCandles([], 10 * HOUR)).toEqual([]);
    });

    it('returns the single candle when the fill target is its own hour', () =>
    {
        expect(fillCandles([point(HOUR, 5n)], HOUR)).toHaveLength(1);
    });

    it('stops at the target even when the candles run past it', () =>
    {
        // Chain time can lead wall time; callers pass whichever is later, but a
        // target below the first candle must not produce a backwards range.
        expect(fillCandles([point(5 * HOUR, 5n)], HOUR)).toEqual([]);
    });

    it('carries the last CLOSE forward, not the last open', () =>
    {
        const rising = { hourStart: 0, open: 10n, high: 30n, low: 10n, close: 30n, volume0: 1n, volume1: 1n };
        const filled = fillCandles([rising], 2 * HOUR);
        expect(filled[1].open).toBe(30n);
        expect(filled[1].close).toBe(30n);
        expect(filled[2].close).toBe(30n);
    });
});

describe('hourStartOf', () =>
{
    it('floors to the hour and is stable inside one', () =>
    {
        expect(hourStartOf(0)).toBe(0);
        expect(hourStartOf(HOUR - 1)).toBe(0);
        expect(hourStartOf(HOUR)).toBe(HOUR);
        expect(hourStartOf(HOUR + 1)).toBe(HOUR);
        // The last second of the same hour still floors to its start.
        expect(hourStartOf(1_700_002_799)).toBe(hourStartOf(1_700_000_000));
        expect(hourStartOf(1_700_002_800)).toBe(hourStartOf(1_700_000_000) + HOUR);
    });
});

describe('IndexerDb.wipe', () =>
{
    it('clears every table', () =>
    {
        const db = freshDb();
        applyEvent(db, decodeLog(poolCreatedLog(), FACTORY)!, context);
        db.setMeta('cursor', '5');
        db.wipe();
        expect(db.listV3Pools()).toEqual([]);
        expect(db.listTokens()).toEqual([]);
        expect(db.getMeta('cursor')).toBeNull();
    });
});
