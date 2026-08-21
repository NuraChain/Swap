// The V3 half of the indexer: its two extra ABIs, the signed-delta mapping, and
// the two events that must NOT become rows. Every log here is encoded by viem
// from the same ABI the decoder parses, so a signature typo fails the test
// rather than silently indexing nothing on a live chain.

import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { describe, expect, it } from 'vitest';

import { applyEvent } from '../src/indexer/apply.ts';
import { PAIR_ABI, V3_FACTORY_ABI, V3_POOL_ABI, decodeLog } from '../src/indexer/decode.ts';
import { IndexerDb } from '../src/indexer/db.ts';
import type { ApplyContext } from '../src/indexer/apply.ts';
import type { RawLog } from '../src/indexer/decode.ts';
import type { Address, TokenRow } from '../src/indexer/db.ts';

const FACTORY = '0x00000000000000000000000000000000000000f0' as Address;
const V3_FACTORY = '0x00000000000000000000000000000000000000f3' as Address;
const PAIR = '0x00000000000000000000000000000000000000aa' as Address;
const POOL = '0x00000000000000000000000000000000000000bb' as Address;
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

function log(address: Address, topics: ReturnType<typeof encodeEventTopics>, data: string, overrides: Partial<RawLog> = {}): RawLog
{
    return {
        address,
        topics: topics as [`0x${ string }`, ...`0x${ string }`[]],
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
        V3_FACTORY,
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

describe('decodeLog - V3 factory', () =>
{
    it('decodes a real encoded PoolCreated log', () =>
    {
        const event = decodeLog(poolCreatedLog(), FACTORY, V3_FACTORY);
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

    it('ignores the log entirely on a chain with no V3 factory', () =>
    {
        // A V2-only deployment passes no third argument. The address is not the
        // V2 factory and PoolCreated shares no topic with either pool ABI, so
        // the log falls all the way through instead of half-decoding.
        expect(decodeLog(poolCreatedLog(), FACTORY)).toBeNull();
        expect(decodeLog(poolCreatedLog(), FACTORY, null)).toBeNull();
    });
});

describe('decodeLog - V3 pool', () =>
{
    it('maps a swap\'s signed deltas onto the unsigned in/out fields', () =>
    {
        const event = decodeLog(v3SwapLog(5n * 10n ** 18n, -12n * 10n ** 6n), FACTORY, V3_FACTORY);
        expect(event?.kind).toBe('swap');
        if (event?.kind === 'swap')
        {
            expect(event.protocol).toBe('v3');
            expect(event.amount0In).toBe(5n * 10n ** 18n);
            expect(event.amount0Out).toBe(0n);
            expect(event.amount1In).toBe(0n);
            expect(event.amount1Out).toBe(12n * 10n ** 6n);
            expect(event.account).toBe(TRADER);
        }
    });

    it('maps the opposite direction too, without a negative amount escaping', () =>
    {
        const event = decodeLog(v3SwapLog(-7n, 3n), FACTORY, V3_FACTORY);
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
            FACTORY,
            V3_FACTORY
        );
        expect(event?.kind).toBe('mint');
        if (event?.kind === 'mint')
        {
            expect(event.protocol).toBe('v3');
            expect(event.amount0).toBe(11n);
            expect(event.amount1).toBe(22n);
            // The decoder stays pure; the live indexer swaps this for the tx sender.
            expect(event.account).toBe(MANAGER);
        }
    });

    it('never confuses a V2 pool log for a V3 one', () =>
    {
        const v2 = decodeLog(
            log(
                PAIR,
                encodeEventTopics({ abi: PAIR_ABI, eventName: 'Swap', args: { sender: ROUTER, to: TRADER } }),
                encodeAbiParameters(
                    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
                    [5n, 0n, 0n, 9n]
                )
            ),
            FACTORY,
            V3_FACTORY
        );
        expect(v2?.kind === 'swap' && v2.protocol).toBe('v2');

        const v3 = decodeLog(v3SwapLog(5n, -9n), FACTORY, V3_FACTORY);
        expect(v3?.kind === 'swap' && v3.protocol).toBe('v3');
    });
});

describe('applyEvent - V3', () =>
{
    it('stores a created pool by identity, with no reserves to hold', () =>
    {
        const db = freshDb();
        applyEvent(db, decodeLog(poolCreatedLog(), FACTORY, V3_FACTORY)!, context);
        const stored = db.getV3Pool(POOL);
        expect(stored?.token0).toBe(NURA);
        expect(stored?.fee).toBe(500);
        expect(db.listV3Pools()).toHaveLength(1);
        // The V2 table is untouched - the two live side by side.
        expect(db.getPair(POOL)).toBeNull();
    });

    it('charts a V3 swap at the price the swap itself reports', () =>
    {
        const db = freshDb();
        applyEvent(db, decodeLog(poolCreatedLog(), FACTORY, V3_FACTORY)!, context);
        applyEvent(db, decodeLog(v3SwapLog(10n ** 18n, -2n * 10n ** 6n), FACTORY, V3_FACTORY)!, context);

        // In the feed...
        const [row] = db.recentEvents(10);
        expect(row.protocol).toBe('v3');
        expect(row.kind).toBe('swap');
        expect(row.amount1Out).toBe(2n * 10n ** 6n);

        // ...and in the chart. A concentrated pool has no reserves to divide,
        // but its Swap states the post-trade sqrtPriceX96 outright. The fixture
        // trades at Q96 - a raw 1:1 - which over 18 and 6 decimals is 1e30 wad,
        // the same orientation priceFromReserves gives a pair.
        const [candle] = db.candles(POOL, 0);
        expect(candle.close).toBe(10n ** 30n);
        expect(candle.open).toBe(10n ** 30n);
        // Volume counts both sides, exactly as it does for a V2 swap.
        expect(candle.volume0).toBe(10n ** 18n);
        expect(candle.volume1).toBe(2n * 10n ** 6n);
    });

    it('charts nothing for a pool it never saw created', () =>
    {
        // No pool row means no token decimals to price the sqrt against, and a
        // candle priced on a guess is worse than no candle.
        const db = freshDb();
        applyEvent(db, decodeLog(v3SwapLog(10n ** 18n, -2n * 10n ** 6n), FACTORY, V3_FACTORY)!, context);
        expect(db.recentEvents(10)).toHaveLength(1);
        expect(db.candles(POOL, 0)).toHaveLength(0);
    });

    it('drops the manager\'s zero-amount burn poke', () =>
    {
        const db = freshDb();
        applyEvent(db, decodeLog(poolCreatedLog(), FACTORY, V3_FACTORY)!, context);

        // `burn(0)` settles a position's fees before a collect. It is a real log
        // describing nothing, and an empty row in somebody's activity is a lie.
        applyEvent(db, decodeLog(v3BurnLog(0n, 0n), FACTORY, V3_FACTORY)!, context);
        expect(db.recentEvents(10)).toHaveLength(0);

        applyEvent(db, decodeLog(v3BurnLog(11n, 22n), FACTORY, V3_FACTORY)!, context);
        expect(db.recentEvents(10)).toHaveLength(1);
    });

    it('serves both protocols as one feed, newest first', () =>
    {
        const db = freshDb();
        applyEvent(db, { kind: 'pairCreated', pair: PAIR, token0: NURA, token1: USDT, blockNumber: 10 }, context);
        applyEvent(db, decodeLog(poolCreatedLog(), FACTORY, V3_FACTORY)!, context);
        applyEvent(db, { kind: 'sync', pair: PAIR, reserve0: 40_000n * 10n ** 18n, reserve1: 100_000n * 10n ** 6n }, context);

        applyEvent(db, {
            kind: 'swap',
            protocol: 'v2',
            pair: PAIR,
            blockNumber: 11,
            logIndex: 0,
            txHash: '0xv2',
            account: TRADER,
            amount0In: 10n ** 18n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 2n * 10n ** 6n
        }, context);
        applyEvent(
            db,
            decodeLog(v3SwapLog(10n ** 18n, -3n * 10n ** 6n, { blockNumber: 12n, logIndex: 1 }), FACTORY, V3_FACTORY)!,
            context
        );

        const feed = db.recentEvents(10);
        expect(feed.map((row) => row.protocol)).toEqual(['v3', 'v2']);
        // And the account filter reaches across both halves in one query.
        expect(db.recentEvents(10, { account: TRADER })).toHaveLength(2);
    });
});
