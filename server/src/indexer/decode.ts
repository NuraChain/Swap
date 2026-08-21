// UniswapV2 and UniswapV3 event canon, and the log -> domain event mapping. The
// ABIs are stable protocol facts, declared here once for the watcher, the
// catch-up scan, and tests.
//
// The two protocols never collide. A log's topic0 is the hash of its FULL event
// signature, and V2's Swap/Mint/Burn are shaped nothing like V3's, so a pool log
// identifies itself by what it says. That keeps `decodeLog` a pure function of
// one log: it needs no register of which addresses are V2 pairs and which are V3
// pools, and it cannot get that register out of date.

import { decodeEventLog, parseAbi } from 'viem';

import type { Address } from './db.ts';

// The fourth parameter is unnamed in the contract; naming it here keeps viem's
// decoded args an object (names are not part of the topic hash).
export const FACTORY_ABI = parseAbi([
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength)'
]);

export const PAIR_ABI = parseAbi([
    'event Sync(uint112 reserve0, uint112 reserve1)',
    'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
    'event Mint(address indexed sender, uint256 amount0, uint256 amount1)',
    'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)'
]);

export const V3_FACTORY_ABI = parseAbi([
    'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)'
]);

// V3 says the same three things in a different grammar:
// - Swap carries SIGNED deltas from the pool's own side of the trade. Positive
//   is what the pool took in, negative what it paid out - one field where V2
//   spends two, and the sign is the direction.
// - Mint and Burn name the position's `owner`, which for anything minted through
//   the position manager is the MANAGER, never the depositor. The live indexer
//   resolves those to the transaction sender, exactly as it already does for a
//   V2 mint.
// - Collect is deliberately absent. Withdrawing liquidity emits Burn and then
//   Collect for the same tokens, so indexing both would print every removal
//   twice; and the manager pokes `burn(0)` before a fee claim, which is why a
//   zero-amount V3 burn is dropped rather than stored as an empty row.
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
    | { kind: 'pairCreated'; pair: Address; token0: Address; token1: Address; blockNumber: number }
    | { kind: 'poolCreated'; pool: Address; token0: Address; token1: Address; fee: number; blockNumber: number }
    | { kind: 'sync'; pair: Address; reserve0: bigint; reserve1: bigint }
    | {
        kind: 'swap';
        protocol: 'v2' | 'v3';
        pair: Address;
        blockNumber: number;
        logIndex: number;
        txHash: `0x${ string }`;
        account: Address;
        amount0In: bigint;
        amount1In: bigint;
        amount0Out: bigint;
        amount1Out: bigint;
        // V3 only: the pool's price AFTER the swap, straight off the event. A
        // concentrated pool has no reserves to price an hourly candle from, but
        // it states its own price on every trade - so the series does not need
        // them. Absent on V2, which is priced from the Sync that precedes it.
        sqrtPriceX96?: bigint;
    }
    | {
        kind: 'mint' | 'burn';
        protocol: 'v2' | 'v3';
        pair: Address;
        blockNumber: number;
        logIndex: number;
        txHash: `0x${ string }`;
        account: Address;
        amount0: bigint;
        amount1: bigint;
    };

function decodeV2Pool(log: RawLog, source: Address): DomainEvent | null
{
    try
    {
        const decoded = decodeEventLog({ abi: PAIR_ABI, topics: log.topics as never, data: log.data });
        if (decoded.eventName === 'Sync')
        {
            const args = decoded.args as { reserve0: bigint; reserve1: bigint };
            return { kind: 'sync', pair: source, reserve0: args.reserve0, reserve1: args.reserve1 };
        }
        if (decoded.eventName === 'Swap')
        {
            const args = decoded.args as {
                sender: Address;
                to: Address;
                amount0In: bigint;
                amount1In: bigint;
                amount0Out: bigint;
                amount1Out: bigint;
            };
            return {
                kind: 'swap',
                protocol: 'v2',
                pair: source,
                blockNumber: Number(log.blockNumber),
                logIndex: log.logIndex,
                txHash: log.transactionHash,
                account: args.to.toLowerCase() as Address,
                amount0In: args.amount0In,
                amount1In: args.amount1In,
                amount0Out: args.amount0Out,
                amount1Out: args.amount1Out
            };
        }
        if (decoded.eventName === 'Mint' || decoded.eventName === 'Burn')
        {
            const args = decoded.args as { sender: Address; to?: Address; amount0: bigint; amount1: bigint };
            return {
                kind: decoded.eventName === 'Mint' ? 'mint' : 'burn',
                protocol: 'v2',
                pair: source,
                blockNumber: Number(log.blockNumber),
                logIndex: log.logIndex,
                txHash: log.transactionHash,
                // Burn carries the withdrawal recipient in `to`; Mint has ONLY
                // `sender`, which is the router. The live indexer overrides a
                // mint's account with the transaction sender - the decoder stays
                // a pure function over the log.
                account: (args.to ?? args.sender).toLowerCase() as Address,
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

function decodeV3Pool(log: RawLog, source: Address): DomainEvent | null
{
    try
    {
        const decoded = decodeEventLog({ abi: V3_POOL_ABI, topics: log.topics as never, data: log.data });
        const base = {
            protocol: 'v3' as const,
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
                // Signed deltas back into the four unsigned fields a V2 swap
                // fills, so one storage row and one wire shape serve both.
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
export function decodeLog(log: RawLog, factory: Address, v3Factory?: Address | null): DomainEvent | null
{
    const source = log.address.toLowerCase() as Address;
    if (source === factory.toLowerCase())
    {
        try
        {
            const decoded = decodeEventLog({ abi: FACTORY_ABI, topics: log.topics as never, data: log.data });
            return {
                kind: 'pairCreated',
                pair: (decoded.args as { pair: Address }).pair.toLowerCase() as Address,
                token0: (decoded.args as { token0: Address }).token0.toLowerCase() as Address,
                token1: (decoded.args as { token1: Address }).token1.toLowerCase() as Address,
                blockNumber: Number(log.blockNumber)
            };
        }
        catch
        {
            return null;
        }
    }

    if (v3Factory !== undefined && v3Factory !== null && source === v3Factory.toLowerCase())
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

    return decodeV2Pool(log, source) ?? decodeV3Pool(log, source);
}
