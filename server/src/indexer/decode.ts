// UniswapV3 event canon, and the log -> domain event mapping. The ABIs are
// stable protocol facts, declared here once for the watcher, the catch-up scan,
// and tests.
//
// A log's topic0 is the hash of its FULL event signature, so a pool log
// identifies itself by what it says. That keeps `decodeLog` a pure function of
// one log: it needs no register of which addresses are pools, and it cannot get
// that register out of date.

import { decodeEventLog, parseAbi } from 'viem';

import type { Address } from './db.ts';

export const V3_FACTORY_ABI = parseAbi([
    'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)'
]);

// - Swap carries SIGNED deltas from the pool's own side of the trade. Positive
//   is what the pool took in, negative what it paid out - one field where the
//   sign is the direction.
// - Mint and Burn name the position's `owner`, which for anything minted through
//   the position manager is the MANAGER, never the depositor. The live indexer
//   resolves those to the transaction sender.
// - Collect is deliberately absent. Withdrawing liquidity emits Burn and then
//   Collect for the same tokens, so indexing both would print every removal
//   twice; and the manager pokes `burn(0)` before a fee claim, which is why a
//   zero-amount burn is dropped rather than stored as an empty row.
export const V3_POOL_ABI = parseAbi([
    'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
    'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
    'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)'
]);

export interface RawLog
{
    address: Address;
    topics: [`0x${ string }`, ...`0x${ string }`[]] | [];
    data: `0x${ string }`;
    blockNumber: bigint;
    logIndex: number;
    transactionHash: `0x${ string }`;
}

export type DomainEvent =
    | { kind: 'poolCreated'; pool: Address; token0: Address; token1: Address; fee: number; blockNumber: number }
    | {
        kind: 'swap';
        pair: Address;
        blockNumber: number;
        logIndex: number;
        txHash: `0x${ string }`;
        account: Address;
        amount0In: bigint;
        amount1In: bigint;
        amount0Out: bigint;
        amount1Out: bigint;
        // The pool's price AFTER the swap, straight off the event. A concentrated
        // pool has no reserves to price an hourly candle from, but it states its
        // own price on every trade - so the series does not need them.
        sqrtPriceX96?: bigint;
    }
    | {
        kind: 'mint' | 'burn';
        pair: Address;
        blockNumber: number;
        logIndex: number;
        txHash: `0x${ string }`;
        account: Address;
        amount0: bigint;
        amount1: bigint;
    };

function decodeV3Pool(log: RawLog, source: Address): DomainEvent | null
{
    try
    {
        const decoded = decodeEventLog({ abi: V3_POOL_ABI, topics: log.topics as never, data: log.data });
        const base = {
            pair: source,
            blockNumber: Number(log.blockNumber),
            logIndex: log.logIndex,
            txHash: log.transactionHash
        };
        if (decoded.eventName === 'Swap')
        {
            const args = decoded.args as {
                recipient: Address; amount0: bigint; amount1: bigint; sqrtPriceX96: bigint;
            };
            return {
                kind: 'swap',
                ...base,
                account: args.recipient.toLowerCase() as Address,
                // Signed deltas back into the four unsigned fields one storage
                // row fills: positive meant "in" to the pool, negative "out".
                amount0In: args.amount0 > 0n ? args.amount0 : 0n,
                amount1In: args.amount1 > 0n ? args.amount1 : 0n,
                amount0Out: args.amount0 < 0n ? -args.amount0 : 0n,
                amount1Out: args.amount1 < 0n ? -args.amount1 : 0n,
                sqrtPriceX96: args.sqrtPriceX96
            };
        }
        if (decoded.eventName === 'Mint' || decoded.eventName === 'Burn')
        {
            const args = decoded.args as { owner: Address; amount0: bigint; amount1: bigint };
            return {
                kind: decoded.eventName === 'Mint' ? 'mint' : 'burn',
                ...base,
                // The position manager, for every position it custodies. The live
                // indexer replaces this with the transaction sender.
                account: args.owner.toLowerCase() as Address,
                amount0: args.amount0,
                amount1: args.amount1
            };
        }
        return null;
    }
    catch
    {
        return null;
    }
}

// Decodes a factory or pool log; null for anything else (unknown contracts share
// no topics with the canon, and a foreign event on a watched address is skipped).
export function decodeLog(log: RawLog, factory: Address): DomainEvent | null
{
    const source = log.address.toLowerCase() as Address;
    if (source === factory.toLowerCase())
    {
        try
        {
            const decoded = decodeEventLog({ abi: V3_FACTORY_ABI, topics: log.topics as never, data: log.data });
            const args = decoded.args as { pool: Address; token0: Address; token1: Address; fee: number };
            return {
                kind: 'poolCreated',
                pool: args.pool.toLowerCase() as Address,
                token0: args.token0.toLowerCase() as Address,
                token1: args.token1.toLowerCase() as Address,
                fee: Number(args.fee),
                blockNumber: Number(log.blockNumber)
            };
        }
        catch
        {
            return null;
        }
    }

    return decodeV3Pool(log, source);
}
