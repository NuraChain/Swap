// A scriptable EVM stand-in for the indexer tests: real ABI-encoded logs, real
// decoding, no network. Only the transport is fake - `decodeLog` still runs
// viem's decoder over bytes this file encoded with viem's encoder, so a change
// to either side shows up as a test failure rather than as a mock that agrees
// with itself.

import { encodeAbiParameters, encodeEventTopics, pad, toHex } from 'viem';

import { FACTORY_ABI, PAIR_ABI, V3_FACTORY_ABI } from '../src/indexer/decode.ts';
import type { Address } from '../src/indexer/db.ts';
import type { RawLog } from '../src/indexer/decode.ts';

export interface FakeBlock
{
    hash: `0x${ string }`;
    timestamp: number;
}

interface GetLogsCall
{
    fromBlock: bigint;
    toBlock: bigint;
    addresses: string[];
}

export class FakeChain
{
    public blocks: FakeBlock[] = [];
    public logs: RawLog[] = [];
    public readonly txFrom = new Map<string, Address>();
    public readonly tokens = new Map<string, { symbol: string; name: string; decimals: number }>();
    /** Pool address -> sqrtPriceX96, for slot0. Absent reverts, like an unpooled address. */
    public readonly poolPrices = new Map<string, bigint>();
    /** `${ token }:${ holder }` -> balance, for balanceOf. Absent reads as zero. */
    public readonly balances = new Map<string, bigint>();
    /** Reads of these token addresses throw, exercising the unknown-token path. */
    public readonly unreadableTokens = new Set<string>();
    public readonly getLogsCalls: GetLogsCall[] = [];
    /** How many of the next getLogs calls should fail (chunk-halving path). */
    public failGetLogs = 0;
    /** getBlockNumber throws this many times before answering (poll-failure path). */
    public failHead = 0;

    constructor(blockCount: number, startTimestamp = 1_700_000_000)
    {
        this.extendTo(blockCount - 1, startTimestamp);
    }

    /** Grows the chain to `height`, minting deterministic hashes. */
    public extendTo(height: number, startTimestamp = 1_700_000_000): void
    {
        while (this.blocks.length <= height)
        {
            const number = this.blocks.length;
            this.blocks.push({
                hash: pad(toHex(number + 1), { size: 32 }),
                timestamp: startTimestamp + number * 3
            });
        }
    }

    /** Re-genesis: same heights, different hashes - what a wiped node looks like. */
    public regenesis(): void
    {
        this.blocks = this.blocks.map((block, number) => ({
            hash: pad(toHex(number + 0xf000), { size: 32 }),
            timestamp: block.timestamp
        }));
    }

    /** Rewrites one block's hash - the shape a reorg presents to the cursor check. */
    public rewriteBlock(number: number): void
    {
        this.blocks[number] = {
            ...this.blocks[number],
            hash: pad(toHex(number + 0xbeef), { size: 32 })
        };
    }

    public get height(): number
    {
        return this.blocks.length - 1;
    }

    public addToken(address: Address, metadata: { symbol: string; name: string; decimals: number }): void
    {
        this.tokens.set(address.toLowerCase(), metadata);
    }

    // viem types an encoded topic list as possibly holding arrays and nulls (the
    // shape an unindexed or array-indexed argument would take); a concrete event
    // never does, so the cast happens once here rather than at every call site.
    #push(log: Omit<RawLog, 'topics'> & { topics: readonly unknown[] }): void
    {
        this.logs.push({ ...log, topics: log.topics as unknown as RawLog['topics'] });
    }

    public pairCreated(options: {
        factory: Address;
        pair: Address;
        token0: Address;
        token1: Address;
        blockNumber: number;
        logIndex: number;
        txHash?: `0x${ string }`;
    }): void
    {
        this.#push({
            address: options.factory,
            topics: encodeEventTopics({
                abi: FACTORY_ABI,
                eventName: 'PairCreated',
                args: { token0: options.token0, token1: options.token1 }
            }),
            data: encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [options.pair, 1n]),
            blockNumber: BigInt(options.blockNumber),
            logIndex: options.logIndex,
            transactionHash: options.txHash ?? '0xf0'
        });
    }

    public poolCreated(options: {
        factory: Address;
        pool: Address;
        token0: Address;
        token1: Address;
        fee: number;
        blockNumber: number;
        logIndex: number;
        txHash?: `0x${ string }`;
    }): void
    {
        this.#push({
            address: options.factory,
            topics: encodeEventTopics({
                abi: V3_FACTORY_ABI,
                eventName: 'PoolCreated',
                args: { token0: options.token0, token1: options.token1, fee: options.fee }
            }),
            data: encodeAbiParameters([{ type: 'int24' }, { type: 'address' }], [10, options.pool]),
            blockNumber: BigInt(options.blockNumber),
            logIndex: options.logIndex,
            transactionHash: options.txHash ?? '0xf3'
        });
    }

    public setBalance(token: Address, holder: Address, balance: bigint): void
    {
        this.balances.set(`${ token.toLowerCase() }:${ holder.toLowerCase() }`, balance);
    }

    public setPoolPrice(pool: Address, sqrtPriceX96: bigint): void
    {
        this.poolPrices.set(pool.toLowerCase(), sqrtPriceX96);
    }

    public sync(options: {
        pair: Address;
        reserve0: bigint;
        reserve1: bigint;
        blockNumber: number;
        logIndex: number;
        txHash?: `0x${ string }`;
    }): void
    {
        this.#push({
            address: options.pair,
            topics: encodeEventTopics({ abi: PAIR_ABI, eventName: 'Sync' }),
            data: encodeAbiParameters(
                [{ type: 'uint112' }, { type: 'uint112' }],
                [options.reserve0, options.reserve1]
            ),
            blockNumber: BigInt(options.blockNumber),
            logIndex: options.logIndex,
            transactionHash: options.txHash ?? '0xf1'
        });
    }

    public swap(options: {
        pair: Address;
        sender: Address;
        to: Address;
        amount0In: bigint;
        amount1In: bigint;
        amount0Out: bigint;
        amount1Out: bigint;
        blockNumber: number;
        logIndex: number;
        txHash?: `0x${ string }`;
    }): void
    {
        this.#push({
            address: options.pair,
            topics: encodeEventTopics({
                abi: PAIR_ABI,
                eventName: 'Swap',
                args: { sender: options.sender, to: options.to }
            }),
            data: encodeAbiParameters(
                [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
                [options.amount0In, options.amount1In, options.amount0Out, options.amount1Out]
            ),
            blockNumber: BigInt(options.blockNumber),
            logIndex: options.logIndex,
            transactionHash: options.txHash ?? '0xf2'
        });
    }

    public mint(options: {
        pair: Address;
        sender: Address;
        amount0: bigint;
        amount1: bigint;
        blockNumber: number;
        logIndex: number;
        txHash: `0x${ string }`;
    }): void
    {
        this.#push({
            address: options.pair,
            topics: encodeEventTopics({ abi: PAIR_ABI, eventName: 'Mint', args: { sender: options.sender } }),
            data: encodeAbiParameters(
                [{ type: 'uint256' }, { type: 'uint256' }],
                [options.amount0, options.amount1]
            ),
            blockNumber: BigInt(options.blockNumber),
            logIndex: options.logIndex,
            transactionHash: options.txHash
        });
    }

    public burn(options: {
        pair: Address;
        sender: Address;
        to: Address;
        amount0: bigint;
        amount1: bigint;
        blockNumber: number;
        logIndex: number;
        txHash?: `0x${ string }`;
    }): void
    {
        this.#push({
            address: options.pair,
            topics: encodeEventTopics({
                abi: PAIR_ABI,
                eventName: 'Burn',
                args: { sender: options.sender, to: options.to }
            }),
            data: encodeAbiParameters(
                [{ type: 'uint256' }, { type: 'uint256' }],
                [options.amount0, options.amount1]
            ),
            blockNumber: BigInt(options.blockNumber),
            logIndex: options.logIndex,
            transactionHash: options.txHash ?? '0xf3'
        });
    }

    /** A log the canon does not recognize, sitting on a watched address. */
    public foreignLog(address: Address, blockNumber: number, logIndex: number): void
    {
        this.#push({
            address,
            topics: [`0x${ 'ab'.repeat(32) }`],
            data: '0x',
            blockNumber: BigInt(blockNumber),
            logIndex,
            transactionHash: '0xf9'
        });
    }

    /** The subset of viem's PublicClient the indexer actually calls. */
    public client(): Record<string, unknown>
    {
        return {
            getBlockNumber: async (): Promise<bigint> =>
            {
                if (this.failHead > 0)
                {
                    this.failHead--;
                    throw new Error('rpc: head unavailable');
                }
                return BigInt(this.height);
            },
            getBlock: async ({ blockNumber }: { blockNumber: bigint }): Promise<FakeBlock & { number: bigint }> =>
            {
                const block = this.blocks[Number(blockNumber)];
                if (block === undefined)
                {
                    throw new Error(`rpc: block ${ blockNumber } not found`);
                }
                return { ...block, number: blockNumber };
            },
            getLogs: async (options: { fromBlock: bigint; toBlock: bigint; address: string[] }): Promise<RawLog[]> =>
            {
                this.getLogsCalls.push({
                    fromBlock: options.fromBlock,
                    toBlock: options.toBlock,
                    addresses: options.address.map((entry) => entry.toLowerCase())
                });
                if (this.failGetLogs > 0)
                {
                    this.failGetLogs--;
                    throw new Error('rpc: query returned more than 10000 results');
                }
                const wanted = new Set(options.address.map((entry) => entry.toLowerCase()));
                // Deliberately UNSORTED: the indexer is responsible for ordering,
                // and a node is under no obligation to hand logs over in order.
                return this.logs
                    .filter((log) => log.blockNumber >= options.fromBlock
                        && log.blockNumber <= options.toBlock
                        && wanted.has(log.address.toLowerCase()))
                    .slice()
                    .reverse();
            },
            getTransaction: async ({ hash }: { hash: string }): Promise<{ from: string }> =>
            {
                const from = this.txFrom.get(hash);
                if (from === undefined)
                {
                    throw new Error(`rpc: transaction ${ hash } not found`);
                }
                return { from };
            },
            readContract: async (options: { address: string; functionName: string }): Promise<unknown> =>
            {
                const key = options.address.toLowerCase();
                if (this.unreadableTokens.has(key))
                {
                    throw new Error('execution reverted');
                }
                // Answered before the token lookup: a pool is not in the token
                // registry, and slot0 is the one call made against its own address.
                if (options.functionName === 'slot0')
                {
                    const sqrtPriceX96 = this.poolPrices.get(key);
                    if (sqrtPriceX96 === undefined)
                    {
                        throw new Error('execution reverted');
                    }
                    return [sqrtPriceX96, 0, 0, 1, 1, 0, true];
                }
                const token = this.tokens.get(key);
                if (token === undefined)
                {
                    throw new Error('execution reverted');
                }
                if (options.functionName === 'decimals')
                {
                    return token.decimals;
                }
                if (options.functionName === 'symbol')
                {
                    return token.symbol;
                }
                if (options.functionName === 'name')
                {
                    return token.name;
                }
                if (options.functionName === 'balanceOf')
                {
                    const holder = String((options as { args?: unknown[] }).args?.[0] ?? '').toLowerCase();
                    return this.balances.get(`${ key }:${ holder }`) ?? 0n;
                }
                throw new Error(`unexpected call ${ options.functionName }`);
            }
        };
    }
}
