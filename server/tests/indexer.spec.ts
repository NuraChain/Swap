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
                topics: topics as [`0x${ string }`, ...`0x${ string }`[]],
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
