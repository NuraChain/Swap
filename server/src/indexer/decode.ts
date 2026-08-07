// UniswapV2 event canon and the log -> domain event mapping. The ABIs are stable
// protocol facts, declared here once for the watcher, the catch-up scan, and tests.

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
    | { kind: 'sync'; pair: Address; reserve0: bigint; reserve1: bigint }
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

// Decodes a factory or pair log; null for anything else (unknown contracts share
// no topics with the canon, and a foreign event on a watched address is skipped).
export function decodeLog(log: RawLog, factory: Address): DomainEvent | null
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
