import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { describe, expect, it } from 'vitest';

import { HOUR, applyEvent, fillCandles, hourStartOf } from '../src/indexer/apply.ts';
import { FACTORY_ABI, PAIR_ABI, decodeLog } from '../src/indexer/decode.ts';
import { IndexerDb } from '../src/indexer/db.ts';
import type { ApplyContext } from '../src/indexer/apply.ts';
import type { Address, TokenRow } from '../src/indexer/db.ts';

const FACTORY = '0x00000000000000000000000000000000000000f0' as Address;
const PAIR = '0x00000000000000000000000000000000000000aa' as Address;
const NURA = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const TRADER = '0x00000000000000000000000000000000000000cc' as Address;

const TOKENS: TokenRow[] = [
    { address: NURA, symbol: 'NURA', name: 'Nura', decimals: 18 },
    { address: USDT, symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 }
];

function freshDb(): IndexerDb
{
    const db = new IndexerDb(':memory:');
    for (const token of TOKENS)
    {
        db.upsertToken(token);
    }
    return db;
}

const context: ApplyContext = {
    timestampOf: (blockNumber) => 1_700_000_000 + blockNumber * 3,
    decimalsOf: (address) => TOKENS.find((token) => token.address === address.toLowerCase())?.decimals ?? 18
};

function pairCreated(db: IndexerDb): void
{
    applyEvent(db, { kind: 'pairCreated', pair: PAIR, token0: NURA, token1: USDT, blockNumber: 10 }, context);
}

describe('decodeLog', () =>
{
    it('decodes a real encoded PairCreated log', () =>
    {
        const topics = encodeEventTopics({
            abi: FACTORY_ABI,
            eventName: 'PairCreated',
            args: { token0: NURA, token1: USDT }
        });
        const data = encodeAbiParameters(
            [{ type: 'address' }, { type: 'uint256' }],
            [PAIR, 1n]
        );
        const event = decodeLog(
            {
                address: FACTORY,
                topics: topics as unknown as [`0x${ string }`, ...`0x${ string }`[]],
                data,
                blockNumber: 10n,
                logIndex: 0,
                transactionHash: '0xdead'
            },
            FACTORY
        );
        expect(event).toEqual({ kind: 'pairCreated', pair: PAIR, token0: NURA, token1: USDT, blockNumber: 10 });
    });

    it('decodes Sync and Swap logs from a pair address', () =>
    {
        const syncTopics = encodeEventTopics({ abi: PAIR_ABI, eventName: 'Sync' });
        const syncData = encodeAbiParameters(
            [{ type: 'uint112' }, { type: 'uint112' }],
            [1000n, 2000n]
        );
        expect(decodeLog(
            { address: PAIR, topics: syncTopics as [`0x${ string }`, ...`0x${ string }`[]], data: syncData, blockNumber: 11n, logIndex: 1, transactionHash: '0x01' },
            FACTORY
        )).toEqual({ kind: 'sync', pair: PAIR, reserve0: 1000n, reserve1: 2000n });

        const swapTopics = encodeEventTopics({
            abi: PAIR_ABI,
            eventName: 'Swap',
            args: { sender: TRADER, to: TRADER }
        });
        const swapData = encodeAbiParameters(
            [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
            [5n, 0n, 0n, 9n]
        );
        const event = decodeLog(
            { address: PAIR, topics: swapTopics as [`0x${ string }`, ...`0x${ string }`[]], data: swapData, blockNumber: 11n, logIndex: 2, transactionHash: '0x01' },
            FACTORY
        );
        expect(event?.kind).toBe('swap');
        if (event?.kind === 'swap')
        {
            expect(event.amount0In).toBe(5n);
            expect(event.amount1Out).toBe(9n);
            expect(event.account).toBe(TRADER);
        }
    });

    it('returns null for foreign logs', () =>
    {
        expect(decodeLog(
            { address: PAIR, topics: ['0x' + 'ab'.repeat(32) as `0x${ string }`], data: '0x', blockNumber: 1n, logIndex: 0, transactionHash: '0x00' },
            FACTORY
        )).toBeNull();
    });
});

describe('applyEvent', () =>
{
    it('creates pairs, tracks reserves, and stores swaps idempotently', () =>
    {
        const db = freshDb();
        pairCreated(db);
        expect(db.getPair(PAIR)?.token0).toBe(NURA);

        applyEvent(db, { kind: 'sync', pair: PAIR, reserve0: 40_000n * 10n ** 18n, reserve1: 100_000n * 10n ** 6n }, context);
        expect(db.getPair(PAIR)?.reserve1).toBe(100_000n * 10n ** 6n);

        const swap = {
            kind: 'swap' as const,
            pair: PAIR,
            blockNumber: 12,
            logIndex: 3,
            txHash: '0xaaa' as const,
            account: TRADER,
            amount0In: 100n * 10n ** 18n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 248n * 10n ** 6n
        };
        applyEvent(db, swap, context);
        applyEvent(db, swap, context); // replayed tail must not double-count
        expect(db.recentEvents(10)).toHaveLength(1);

        const candles = db.candles(PAIR, 0);
        expect(candles).toHaveLength(1);
        expect(candles[0].volume0).toBe(100n * 10n ** 18n);
        expect(candles[0].volume1).toBe(248n * 10n ** 6n);
        // Price is token1-per-token0, decimals adjusted: 100k USDT / 40k NURA = 2.5.
        expect(candles[0].close).toBe(25n * 10n ** 17n);
    });

    it('merges swaps in the same hour into one candle with high/low', () =>
    {
        const db = freshDb();
        pairCreated(db);
        const base = context.timestampOf(12);
        const hour = hourStartOf(base);

        applyEvent(db, { kind: 'sync', pair: PAIR, reserve0: 40_000n * 10n ** 18n, reserve1: 100_000n * 10n ** 6n }, context);
        applyEvent(db, {
            kind: 'swap', pair: PAIR, blockNumber: 12, logIndex: 1, txHash: '0x01', account: TRADER,
            amount0In: 10n ** 18n, amount1In: 0n, amount0Out: 0n, amount1Out: 2n * 10n ** 6n
        }, context);
        // Price moves: more USDT per NURA now.
        applyEvent(db, { kind: 'sync', pair: PAIR, reserve0: 38_000n * 10n ** 18n, reserve1: 105_000n * 10n ** 6n }, context);
        applyEvent(db, {
            kind: 'swap', pair: PAIR, blockNumber: 12, logIndex: 5, txHash: '0x02', account: TRADER,
            amount0In: 0n, amount1In: 5n * 10n ** 6n, amount0Out: 18n * 10n ** 17n, amount1Out: 0n
        }, context);

        const candles = db.candles(PAIR, 0);
        expect(candles).toHaveLength(1);
        expect(candles[0].hourStart).toBe(hour);
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
});

describe('IndexerDb.wipe', () =>
{
    it('clears every table', () =>
    {
        const db = freshDb();
        pairCreated(db);
        db.setMeta('cursor', '5');
        db.wipe();
        expect(db.listPairs()).toEqual([]);
        expect(db.listTokens()).toEqual([]);
        expect(db.getMeta('cursor')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Decoder edges. `decodeLog` runs over whatever a node hands back, including
// events from contracts this exchange has never heard of, so its contract is
// "decode what you know, return null for everything else, and never throw".

const PAIR_TWO = '0x00000000000000000000000000000000000000ab' as Address;
const ROUTER = '0x00000000000000000000000000000000000000f1' as Address;

// viem types an encoded topic list as possibly holding arrays and nulls (the
// shape an array-indexed argument would take); a concrete event never does.
function log(
    address: Address,
    topics: readonly unknown[],
    data: string,
    overrides: Partial<{ blockNumber: bigint; logIndex: number; transactionHash: `0x${ string }` }> = {}
)
{
    return {
        address,
        topics: topics as unknown as [`0x${ string }`, ...`0x${ string }`[]],
        data: data as `0x${ string }`,
        blockNumber: overrides.blockNumber ?? 11n,
        logIndex: overrides.logIndex ?? 0,
        transactionHash: overrides.transactionHash ?? ('0x01' as `0x${ string }`)
    };
}

describe('decodeLog edges', () =>
{
    it('files a Mint under its sender - the decoder has nothing better', () =>
    {
        const decoded = decodeLog(
            log(
                PAIR,
                encodeEventTopics({ abi: PAIR_ABI, eventName: 'Mint', args: { sender: ROUTER } }),
                encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [7n, 8n])
            ),
            FACTORY
        );
        expect(decoded?.kind).toBe('mint');
        if (decoded?.kind === 'mint')
        {
            // Only the live indexer knows the transaction sender; the pure
            // decoder reports what the log itself carries.
            expect(decoded.account).toBe(ROUTER);
            expect(decoded.amount0).toBe(7n);
            expect(decoded.amount1).toBe(8n);
        }
    });

    it('files a Burn under its withdrawal recipient, not its caller', () =>
    {
        const decoded = decodeLog(
            log(
                PAIR,
                encodeEventTopics({ abi: PAIR_ABI, eventName: 'Burn', args: { sender: ROUTER, to: TRADER } }),
                encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [3n, 4n])
            ),
            FACTORY
        );
        expect(decoded?.kind).toBe('burn');
        if (decoded?.kind === 'burn')
        {
            expect(decoded.account).toBe(TRADER);
            expect(decoded.account).not.toBe(ROUTER);
        }
    });

    it('carries the block, log index and transaction through', () =>
    {
        const decoded = decodeLog(
            log(
                PAIR,
                encodeEventTopics({ abi: PAIR_ABI, eventName: 'Swap', args: { sender: TRADER, to: TRADER } }),
                encodeAbiParameters(
                    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
                    [1n, 0n, 0n, 2n]
                ),
                { blockNumber: 4242n, logIndex: 17, transactionHash: '0xfeed' }
            ),
            FACTORY
        );
        expect(decoded?.kind).toBe('swap');
        if (decoded?.kind === 'swap')
        {
            expect(decoded.blockNumber).toBe(4242);
            expect(decoded.logIndex).toBe(17);
            expect(decoded.txHash).toBe('0xfeed');
        }
    });

    it('matches the factory address case-insensitively', () =>
    {
        const topics = encodeEventTopics({
            abi: FACTORY_ABI,
            eventName: 'PairCreated',
            args: { token0: NURA, token1: USDT }
        });
        const data = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [PAIR, 1n]);
        expect(decodeLog(log(FACTORY.toUpperCase() as Address, topics, data), FACTORY)?.kind).toBe('pairCreated');
        expect(decodeLog(log(FACTORY, topics, data), FACTORY.toUpperCase() as Address)?.kind).toBe('pairCreated');
    });

    it('lowercases every address it reports', () =>
    {
        const decoded = decodeLog(
            log(
                PAIR.toUpperCase() as Address,
                encodeEventTopics({ abi: PAIR_ABI, eventName: 'Sync' }),
                encodeAbiParameters([{ type: 'uint112' }, { type: 'uint112' }], [1n, 2n])
            ),
            FACTORY
        );
        expect(decoded?.kind === 'sync' && decoded.pair).toBe(PAIR);
    });

    // A pair event arriving from the factory address is not a pair event. The
    // factory branch decodes against the factory canon and stops - it must not
    // fall through and credit the factory with a Sync.
    it('does not read a pair event emitted from the factory address', () =>
    {
        const decoded = decodeLog(
            log(
                FACTORY,
                encodeEventTopics({ abi: PAIR_ABI, eventName: 'Sync' }),
                encodeAbiParameters([{ type: 'uint112' }, { type: 'uint112' }], [1n, 2n])
            ),
            FACTORY
        );
        expect(decoded).toBeNull();
    });

    it('does not read a PairCreated emitted by something that is not the factory', () =>
    {
        const decoded = decodeLog(
            log(
                PAIR_TWO,
                encodeEventTopics({
                    abi: FACTORY_ABI,
                    eventName: 'PairCreated',
                    args: { token0: NURA, token1: USDT }
                }),
                encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [PAIR, 1n])
            ),
            FACTORY
        );
        expect(decoded).toBeNull();
    });

    it('returns null for a known topic with truncated data', () =>
    {
        expect(decodeLog(
            log(PAIR, encodeEventTopics({ abi: PAIR_ABI, eventName: 'Sync' }), '0x00'),
            FACTORY
        )).toBeNull();
        expect(decodeLog(
            log(
                FACTORY,
                encodeEventTopics({
                    abi: FACTORY_ABI,
                    eventName: 'PairCreated',
                    args: { token0: NURA, token1: USDT }
                }),
                '0x'
            ),
            FACTORY
        )).toBeNull();
    });

    it('returns null for a log with no topics at all', () =>
    {
        expect(decodeLog(log(PAIR, [], '0x'), FACTORY)).toBeNull();
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
            const from = next() < 0.5 ? FACTORY : PAIR;
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
            decodedSomething ||= decodeLog(log(PAIR, topics, randomHex(next, 64)), FACTORY) !== null;
        }
        // A random 32-byte topic colliding with a real event signature is a
        // 1-in-2^256 event; anything else would mean the decoder is guessing.
        expect(decodedSomething).toBe(false);
    });

    it('survives a real topic paired with random data', () =>
    {
        const next = lcg(99);
        const swapTopics = encodeEventTopics({
            abi: PAIR_ABI,
            eventName: 'Swap',
            args: { sender: TRADER, to: TRADER }
        });
        for (let round = 0; round < 200; round++)
        {
            expect(() => decodeLog(log(PAIR, swapTopics, randomHex(next, Math.floor(next() * 160))), FACTORY))
                .not.toThrow();
        }
    });
});

describe('applyEvent - deposits, withdrawals and guards', () =>
{
    it('stores a mint with both deposited amounts and no outputs', () =>
    {
        const db = freshDb();
        pairCreated(db);
        applyEvent(db, {
            kind: 'mint',
            pair: PAIR,
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
        expect(db.candles(PAIR, 0)).toEqual([]);
    });

    it('stores a burn the same way and stays idempotent on replay', () =>
    {
        const db = freshDb();
        pairCreated(db);
        const burn = {
            kind: 'burn' as const,
            pair: PAIR,
            blockNumber: 13,
            logIndex: 0,
            txHash: '0xd2' as const,
            account: TRADER,
            amount0: 5n,
            amount1: 6n
        };
        applyEvent(db, burn, context);
        applyEvent(db, burn, context);
        expect(db.recentEvents(10)).toHaveLength(1);
        expect(db.recentEvents(10)[0].kind).toBe('burn');
    });

    it('records the trade but no candle when the pool has no reserves yet', () =>
    {
        // Reserves arrive with Sync. A swap seen before one - a chunk boundary,
        // a rewind - must not price against zero and store a zero candle.
        const db = freshDb();
        pairCreated(db);
        applyEvent(db, {
            kind: 'swap',
            pair: PAIR,
            blockNumber: 12,
            logIndex: 0,
            txHash: '0xs1',
            account: TRADER,
            amount0In: 1n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 1n
        }, context);
        expect(db.recentEvents(10)).toHaveLength(1);
        expect(db.candles(PAIR, 0)).toEqual([]);
    });

    it('records a trade on a pair it has never seen without inventing a candle', () =>
    {
        const db = freshDb();
        applyEvent(db, {
            kind: 'swap',
            pair: PAIR,
            blockNumber: 12,
            logIndex: 0,
            txHash: '0xs2',
            account: TRADER,
            amount0In: 1n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 1n
        }, context);
        expect(db.recentEvents(10)).toHaveLength(1);
        expect(db.candles(PAIR, 0)).toEqual([]);
    });

    it('counts both directions of a trade into the hour volume', () =>
    {
        const db = freshDb();
        pairCreated(db);
        applyEvent(db, {
            kind: 'sync',
            pair: PAIR,
            reserve0: 40_000n * 10n ** 18n,
            reserve1: 100_000n * 10n ** 6n
        }, context);
        applyEvent(db, {
            kind: 'swap',
            pair: PAIR,
            blockNumber: 12,
            logIndex: 0,
            txHash: '0xs3',
            account: TRADER,
            amount0In: 3n,
            amount1In: 5n,
            amount0Out: 7n,
            amount1Out: 11n
        }, context);
        const [candle] = db.candles(PAIR, 0);
        expect(candle.volume0).toBe(10n);
        expect(candle.volume1).toBe(16n);
    });

    it('splits trades in different hours into different candles', () =>
    {
        const db = freshDb();
        pairCreated(db);
        applyEvent(db, {
            kind: 'sync',
            pair: PAIR,
            reserve0: 100n * 10n ** 18n,
            reserve1: 100n * 10n ** 6n
        }, context);
        const hourApart: ApplyContext = {
            ...context,
            timestampOf: (blockNumber) => (blockNumber === 12 ? 1_700_000_000 : 1_700_000_000 + HOUR)
        };
        applyEvent(db, {
            kind: 'swap',
            pair: PAIR,
            blockNumber: 12,
            logIndex: 0,
            txHash: '0xh1',
            account: TRADER,
            amount0In: 1n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 1n
        }, hourApart);
        applyEvent(db, {
            kind: 'swap',
            pair: PAIR,
            blockNumber: 13,
            logIndex: 0,
            txHash: '0xh2',
            account: TRADER,
            amount0In: 1n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 1n
        }, hourApart);
        expect(db.candles(PAIR, 0)).toHaveLength(2);
    });

    it('does not re-count a replayed swap into the candle volume', () =>
    {
        // The reorg rewind replays the tail. Idempotency is enforced by the
        // event insert, and the candle write sits BEHIND that check - if it did
        // not, every rewind would inflate 24h volume.
        const db = freshDb();
        pairCreated(db);
        applyEvent(db, {
            kind: 'sync',
            pair: PAIR,
            reserve0: 100n * 10n ** 18n,
            reserve1: 100n * 10n ** 6n
        }, context);
        const swap = {
            kind: 'swap' as const,
            pair: PAIR,
            blockNumber: 12,
            logIndex: 0,
            txHash: '0xr1' as const,
            account: TRADER,
            amount0In: 9n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 9n
        };
        applyEvent(db, swap, context);
        applyEvent(db, swap, context);
        applyEvent(db, swap, context);
        expect(db.candles(PAIR, 0)[0].volume0).toBe(9n);
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

describe('fillCandles edges', () =>
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
