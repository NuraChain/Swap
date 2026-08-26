// Applies decoded domain events to storage. Every swap feeds the hourly candles,
// priced from the sqrtPriceX96 its own event carries - a concentrated pool has
// no reserves to divide, but it states its post-trade price outright.

import { priceWadFromSqrtX96 } from '@nuraswap/shared/v3-math';

import type { DomainEvent } from './decode.ts';
import type { IndexerDb } from './db.ts';

export const HOUR = 3600;

export function hourStartOf(timestamp: number): number
{
    return timestamp - (timestamp % HOUR);
}

export interface ApplyContext
{
    // Block timestamp lookup for the event's block, already fetched by the caller.
    timestampOf: (blockNumber: number) => number;
    // Token decimals resolver; unknown tokens were registered at poolCreated time.
    decimalsOf: (address: string) => number;
}

export function applyEvent(db: IndexerDb, event: DomainEvent, context: ApplyContext): void
{
    if (event.kind === 'poolCreated')
    {
        db.upsertV3Pool({
            address: event.pool,
            token0: event.token0,
            token1: event.token1,
            fee: event.fee,
            createdBlock: event.blockNumber
        });
        return;
    }

    const timestamp = context.timestampOf(event.blockNumber);

    if (event.kind === 'swap')
    {
        const inserted = db.insertEvent({
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            txHash: event.txHash,
            timestamp,
            pair: event.pair,
            kind: 'swap',
            account: event.account,
            amount0In: event.amount0In,
            amount1In: event.amount1In,
            amount0Out: event.amount0Out,
            amount1Out: event.amount1Out
        });
        if (!inserted)
        {
            return; // replayed tail - candle already counted it
        }
        const pool = db.getV3Pool(event.pair);
        // A swap on a pool the indexer never saw created, or one from a
        // node that omitted the price: nothing honest to chart.
        if (pool === null || event.sqrtPriceX96 === undefined || event.sqrtPriceX96 <= 0n)
        {
            return;
        }
        db.recordCandlePoint(
            event.pair,
            hourStartOf(timestamp),
            priceWadFromSqrtX96(
                event.sqrtPriceX96,
                context.decimalsOf(pool.token0),
                context.decimalsOf(pool.token1)
            ),
            event.amount0In + event.amount0Out,
            event.amount1In + event.amount1Out
        );
        return;
    }

    // The position manager pokes `burn(0)` to settle a position's fees before
    // collecting them, which emits a real Burn log describing nothing. Storing it
    // would drop an empty row into the middle of somebody's activity.
    if (event.amount0 === 0n && event.amount1 === 0n)
    {
        return;
    }

    db.insertEvent({
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
        txHash: event.txHash,
        timestamp,
        pair: event.pair,
        kind: event.kind,
        account: event.account,
        amount0In: event.amount0,
        amount1In: event.amount1,
        amount0Out: 0n,
        amount1Out: 0n
    });
}

export interface CandlePoint
{
    hourStart: number;
    open: bigint;
    high: bigint;
    low: bigint;
    close: bigint;
    volume0: bigint;
    volume1: bigint;
}

// Forward-fills the gaps between traded hours with flat candles so a quiet chain
// still charts a continuous line. Pure - tested without a database.
export function fillCandles(candles: CandlePoint[], toHour: number): CandlePoint[]
{
    if (candles.length === 0)
    {
        return [];
    }
    const filled: CandlePoint[] = [];
    let cursor = 0;
    let lastClose = candles[0].open;
    for (let hour = candles[0].hourStart; hour <= toHour; hour += HOUR)
    {
        const next = candles[cursor];
        if (next !== undefined && next.hourStart === hour)
        {
            filled.push(next);
            lastClose = next.close;
            cursor++;
        }
        else
        {
            filled.push({
                hourStart: hour,
                open: lastClose,
                high: lastClose,
                low: lastClose,
                close: lastClose,
                volume0: 0n,
                volume1: 0n
            });
        }
    }
    return filled;
}
