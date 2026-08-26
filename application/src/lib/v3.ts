// The chain half of UniswapV3, kept out of the components: pool discovery,
// pool state, quotes, position reads, and the two calldata shapes a V3 swap or
// mint can take. Nothing here touches the DOM, so the SSR bundle can evaluate it.
//
// V3 asks two questions V2 never did, and both are answered by probing rather
// than assuming - which contract flavour the deployment shipped, and which fee
// tiers its factory enables. A hardcoded guess would work against mainnet's
// canonical deployment and silently mis-encode a call against anything else.

import { encodeFunctionData, type Abi } from 'viem';

import { FEE_TIERS, getAmountsForLiquidity, getSqrtRatioAtTick } from '@nuraswap/shared/v3-math';

import {
    ERC20_ABI,
    POSITION_COLLECT_STATIC_ABI,
    POSITION_MANAGER_ABI,
    QUOTER_V1_ABI,
    QUOTER_V2_ABI,
    SWAP_ROUTER_02_ABI,
    SWAP_ROUTER_ABI,
    V3_FACTORY_ABI,
    V3_POOL_ABI,
    ZERO_ADDRESS,
    publicClient
} from './chain.ts';
import type { Address } from './chain.ts';

export { ZERO_ADDRESS };
/** SwapRouter02's "pay me, not the caller" sentinel; the original uses address(0). */
const ADDRESS_THIS_02 = '0x0000000000000000000000000000000000000002' as Address;
const MAX_UINT128 = (1n << 128n) - 1n;
/** A position list is a wallet's own NFTs; nobody browses a thousand of them. */
const MAX_POSITIONS = 120;

export interface FeeTier
{
    fee: number;
    tickSpacing: number;
}

export interface V3PoolState
{
    address: Address;
    fee: number;
    tickSpacing: number;
    token0: Address;
    token1: Address;
    sqrtPriceX96: bigint;
    tick: number;
    liquidity: bigint;
}

export interface V3Position
{
    tokenId: bigint;
    token0: Address;
    token1: Address;
    fee: number;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
}

/** A viem writeContract request, built here and signed by the caller. */
export interface WriteRequest
{
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
}

interface PoolLocation
{
    token0: Address;
    token1: Address;
    fee: number;
    address: Address;
}

/** Pool token order is the address order - the pool itself has no say in it. */
export function sortTokens(a: Address, b: Address): [Address, Address]
{
    return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

export function poolKey(token0: Address, token1: Address, fee: number): string
{
    const [first, second] = sortTokens(token0, token1);
    return `${ first.toLowerCase() }-${ second.toLowerCase() }-${ fee }`;
}

// ---------------------------------------------------------------------------
// Fee tiers

let tiersCache: FeeTier[] | null = null;

/**
 * The tiers this factory actually enables. The canonical four are a convention -
 * `feeAmountTickSpacing` is the factory's own answer, and a tier it does not
 * enable has no pool and never will until its owner enables one.
 *
 * Only a COMPLETE pass is cached. A tier whose read failed would otherwise be
 * indistinguishable from a tier the factory disabled - one flaky multicall
 * response could hide three of the four tiers for the life of the tab. A
 * partial answer still serves this call (what answered, plus the canonical set
 * is NOT mixed in: an unproven tier may simply not exist), and the next call
 * probes again for a clean pass to pin.
 */
export async function enabledFeeTiers(factory: Address): Promise<FeeTier[]>
{
    if (tiersCache !== null)
    {
        return tiersCache;
    }
    const reads = await publicClient().multicall({
        contracts: FEE_TIERS.map((tier) => ({
            address: factory,
            abi: V3_FACTORY_ABI,
            functionName: 'feeAmountTickSpacing' as const,
            args: [tier.fee] as const
        })),
        allowFailure: true
    });
    if (!reads.some((read) => read.status === 'success'))
    {
        return FEE_TIERS.map((tier) => ({ ...tier }));
    }
    const enabled: FeeTier[] = [];
    FEE_TIERS.forEach((tier, index) =>
    {
        const read = reads[index];
        const spacing = read.status === 'success' ? Number(read.result) : 0;
        if (spacing > 0)
        {
            enabled.push({ fee: tier.fee, tickSpacing: spacing });
        }
    });
    if (reads.every((read) => read.status === 'success'))
    {
        tiersCache = enabled;
    }
    return enabled;
}

// ---------------------------------------------------------------------------
// Pools

/** Which of the asked-for pools exist; the rest come back as the zero address. */
async function poolAddresses(
    factory: Address,
    wanted: Array<{ token0: Address; token1: Address; fee: number }>
): Promise<PoolLocation[]>
{
    if (wanted.length === 0)
    {
        return [];
    }
    const reads = await publicClient().multicall({
        contracts: wanted.map((entry) => ({
            address: factory,
            abi: V3_FACTORY_ABI,
            functionName: 'getPool' as const,
            args: [entry.token0, entry.token1, entry.fee] as const
        })),
        allowFailure: true
    });
    const found: PoolLocation[] = [];
    wanted.forEach((entry, index) =>
    {
        const read = reads[index];
        const address = read.status === 'success' ? read.result as Address : ZERO_ADDRESS;
        if (address !== ZERO_ADDRESS)
        {
            found.push({ ...entry, address });
        }
    });
    return found;
}

/** slot0 + liquidity for pools already known to exist. */
async function poolStates(located: PoolLocation[], tiers: FeeTier[]): Promise<V3PoolState[]>
{
    if (located.length === 0)
    {
        return [];
    }
    const reader = publicClient();
    const [slots, liquidities] = await Promise.all([
        reader.multicall({
            contracts: located.map((pool) => ({
                address: pool.address,
                abi: V3_POOL_ABI,
                functionName: 'slot0' as const
            })),
            allowFailure: true
        }),
        reader.multicall({
            contracts: located.map((pool) => ({
                address: pool.address,
                abi: V3_POOL_ABI,
                functionName: 'liquidity' as const
            })),
            allowFailure: true
        })
    ]);
    const states: V3PoolState[] = [];
    located.forEach((pool, index) =>
    {
        const slot = slots[index];
        if (slot.status !== 'success')
        {
            return;
        }
        const [sqrtPriceX96, tick] = slot.result as readonly [bigint, number, number, number, number, number, boolean];
        // An uninitialized pool has a zero price: the contract exists but nobody
        // has set its opening price, so it can neither quote nor be charted.
        if (sqrtPriceX96 <= 0n)
        {
            return;
        }
        const liquidityRead = liquidities[index];
        states.push({
            address: pool.address,
            fee: pool.fee,
            tickSpacing: tiers.find((tier) => tier.fee === pool.fee)?.tickSpacing ?? 60,
            token0: pool.token0,
            token1: pool.token1,
            sqrtPriceX96,
            tick: Number(tick),
            liquidity: liquidityRead.status === 'success' ? liquidityRead.result as bigint : 0n
        });
    });
    return states;
}

/** Every initialized pool for one pair, one entry per enabled fee tier. */
export async function poolsForPair(factory: Address, tokenA: Address, tokenB: Address): Promise<V3PoolState[]>
{
    if (tokenA.toLowerCase() === tokenB.toLowerCase())
    {
        return [];
    }
    const [token0, token1] = sortTokens(tokenA, tokenB);
    const tiers = await enabledFeeTiers(factory);
    const located = await poolAddresses(factory, tiers.map((tier) => ({ token0, token1, fee: tier.fee })));
    return poolStates(located, tiers);
}

/** Every initialized pool over every pair of the given tokens. */
export async function discoverPools(factory: Address, tokens: Address[]): Promise<V3PoolState[]>
{
    const tiers = await enabledFeeTiers(factory);
    // Deduplicated FIRST: a token repeated in the list forms the same pair twice,
    // and the sweep would then find - and the table would then list - the same
    // pool once per repetition.
    const unique = [...new Map(tokens.map((token) => [token.toLowerCase(), token])).values()];
    const wanted: Array<{ token0: Address; token1: Address; fee: number }> = [];
    for (let left = 0; left < unique.length; left++)
    {
        for (let right = left + 1; right < unique.length; right++)
        {
            const [token0, token1] = sortTokens(unique[left], unique[right]);
            for (const tier of tiers)
            {
                wanted.push({ token0, token1, fee: tier.fee });
            }
        }
    }
    const located = await poolAddresses(factory, wanted);
    return poolStates(located, tiers);
}

/** The pools behind a set of positions, keyed by poolKey. */
export async function poolStatesFor(
    factory: Address,
    wanted: Array<{ token0: Address; token1: Address; fee: number }>
): Promise<Map<string, V3PoolState>>
{
    const unique = new Map<string, { token0: Address; token1: Address; fee: number }>();
    for (const entry of wanted)
    {
        unique.set(poolKey(entry.token0, entry.token1, entry.fee), entry);
    }
    const tiers = await enabledFeeTiers(factory);
    const located = await poolAddresses(factory, [...unique.values()]);
    const states = await poolStates(located, tiers);
    return new Map(states.map((state) => [poolKey(state.token0, state.token1, state.fee), state]));
}

/** The tokens a pool physically holds - the honest reading of a V3 pool's size. */
export async function poolBalances(pools: V3PoolState[]): Promise<Map<string, { amount0: bigint; amount1: bigint }>>
{
    const balances = new Map<string, { amount0: bigint; amount1: bigint }>();
    if (pools.length === 0)
    {
        return balances;
    }
    const reads = await publicClient().multicall({
        contracts: pools.flatMap((pool) => [
            { address: pool.token0, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [pool.address] as const },
            { address: pool.token1, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [pool.address] as const }
        ]),
        allowFailure: true
    });
    pools.forEach((pool, index) =>
    {
        const first = reads[index * 2];
        const second = reads[index * 2 + 1];
        balances.set(pool.address.toLowerCase(), {
            amount0: first.status === 'success' ? first.result as bigint : 0n,
            amount1: second.status === 'success' ? second.result as bigint : 0n
        });
    });
    return balances;
}

// ---------------------------------------------------------------------------
// Quoting

let quoterFlavour: 'v2' | 'v1' | null = null;

async function quoteAsV2(
    quoter: Address,
    tokenIn: Address,
    tokenOut: Address,
    fee: number,
    amountIn: bigint
): Promise<bigint>
{
    const result = await publicClient().readContract({
        address: quoter,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }]
    }) as readonly [bigint, bigint, number, bigint];
    return result[0];
}

async function quoteAsV1(
    quoter: Address,
    tokenIn: Address,
    tokenOut: Address,
    fee: number,
    amountIn: bigint
): Promise<bigint>
{
    return await publicClient().readContract({
        address: quoter,
        abi: QUOTER_V1_ABI,
        functionName: 'quoteExactInputSingle',
        args: [tokenIn, tokenOut, fee, amountIn, 0n]
    }) as bigint;
}

/**
 * One tier's output for an exact input, straight from the Quoter - the only
 * authority on a V3 amount, because the swap walks initialized ticks and a
 * closed-form guess from slot0 alone would be right only while the trade stayed
 * inside the current tick.
 *
 * Which Quoter is deployed decides the calldata, so the first quote of a session
 * tries QuoterV2's struct form and falls back to the original's flat arguments,
 * remembering whichever answered. A tier with no pool, or one too shallow for
 * the amount, reverts in both - and reverting is how a Quoter says "no route",
 * which is 0n here rather than an error every caller would have to catch.
 */
export async function quoteV3(
    quoter: Address,
    tokenIn: Address,
    tokenOut: Address,
    fee: number,
    amountIn: bigint
): Promise<bigint>
{
    if (amountIn <= 0n)
    {
        return 0n;
    }
    if (quoterFlavour !== 'v1')
    {
        try
        {
            const out = await quoteAsV2(quoter, tokenIn, tokenOut, fee, amountIn);
            quoterFlavour = 'v2';
            return out;
        }
        catch
        {
            // A known-V2 quoter that reverts is answering "no route"; an unknown
            // one may simply not be a V2, so fall through and ask the other way.
            if (quoterFlavour === 'v2')
            {
                return 0n;
            }
        }
    }
    try
    {
        const out = await quoteAsV1(quoter, tokenIn, tokenOut, fee, amountIn);
        quoterFlavour = 'v1';
        return out;
    }
    catch
    {
        return 0n;
    }
}

export interface TierQuote
{
    fee: number;
    out: bigint;
    pool: V3PoolState;
}

/**
 * Every enabled tier quoted for the same input. The caller picks: the swap card
 * defaults to the best output but lets a trader pin a tier, and a tier that
 * cannot fill the trade comes back at 0n rather than vanishing - a pool that
 * exists and cannot fill is worth showing as exactly that.
 */
export async function quoteAllTiers(
    factory: Address,
    quoter: Address,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint
): Promise<TierQuote[]>
{
    const pools = await poolsForPair(factory, tokenIn, tokenOut);
    if (pools.length === 0)
    {
        return [];
    }
    // One sequential probe first when the flavour is still unknown: fanning out
    // would run the same detection once per tier and throw away all but one
    // answer, against a Quoter whose shape the first reply already settles.
    if (quoterFlavour === null)
    {
        await quoteV3(quoter, tokenIn, tokenOut, pools[0].fee, amountIn);
    }
    const quotes = await Promise.all(pools.map(async (pool) => ({
        fee: pool.fee,
        out: await quoteV3(quoter, tokenIn, tokenOut, pool.fee, amountIn),
        pool
    })));
    return quotes.sort((left, right) => left.fee - right.fee);
}

export function bestTier(quotes: TierQuote[]): TierQuote | null
{
    let best: TierQuote | null = null;
    for (const quote of quotes)
    {
        if (quote.out > 0n && (best === null || quote.out > best.out))
        {
            best = quote;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Swapping

let routerFlavour: 'v1' | '02' | null = null;

/**
 * SwapRouter or SwapRouter02. They differ in two places that matter here: the
 * deadline moved out of the parameter struct and into multicall, and the "keep
 * the output at the router" sentinel changed from address(0) to address(2).
 * `positionManager()` exists only on 02, so asking for it settles the question
 * with one read instead of a guess that would surface only at signing time.
 *
 * Only a DEFINITIVE answer is remembered. A v1 router reverts on the probe -
 * and so does an unreachable RPC - so a failure answers 'v1' for THIS trade
 * and leaves the question open: pinning the flavour off an RPC blip encoded
 * v1 calldata against a real SwapRouter02 for the life of the tab.
 */
export async function detectRouterFlavour(router: Address): Promise<'v1' | '02'>
{
    if (routerFlavour !== null)
    {
        return routerFlavour;
    }
    const answer = await publicClient().readContract({
        address: router,
        abi: SWAP_ROUTER_ABI,
        functionName: 'positionManager'
    }).catch(() => null);
    if (answer !== null)
    {
        routerFlavour = '02';
        return '02';
    }
    return 'v1';
}

export interface SwapParams
{
    router: Address;
    tokenIn: Address;
    tokenOut: Address;
    fee: number;
    amountIn: bigint;
    amountOutMin: bigint;
    recipient: Address;
    deadline: bigint;
    /** The input is native NURA: value rides along and the router wraps it. */
    nativeIn: boolean;
    /** The output must land as native NURA: the router unwraps before paying. */
    nativeOut: boolean;
}

/**
 * The single-hop exact-input swap as a signable request. Native output is the
 * one shape that needs a multicall: the swap has to pay the ROUTER so that
 * unwrapWETH9 in the same transaction can turn the WNURA back into NURA and
 * forward it - paying the trader directly would leave them holding the wrapper.
 */
export async function buildV3Swap(params: SwapParams): Promise<WriteRequest>
{
    const flavour = await detectRouterFlavour(params.router);
    const value = params.nativeIn ? params.amountIn : 0n;
    if (flavour === '02')
    {
        const calls = [encodeFunctionData({
            abi: SWAP_ROUTER_02_ABI,
            functionName: 'exactInputSingle',
            args: [{
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                fee: params.fee,
                recipient: params.nativeOut ? ADDRESS_THIS_02 : params.recipient,
                amountIn: params.amountIn,
                amountOutMinimum: params.amountOutMin,
                sqrtPriceLimitX96: 0n
            }]
        })];
        if (params.nativeOut)
        {
            calls.push(encodeFunctionData({
                abi: SWAP_ROUTER_02_ABI,
                functionName: 'unwrapWETH9',
                args: [params.amountOutMin, params.recipient]
            }));
        }
        // Even the single-call case goes through multicall: 02 dropped the
        // deadline from the swap itself, and this is where it still binds.
        return {
            address: params.router,
            abi: SWAP_ROUTER_02_ABI as Abi,
            functionName: 'multicall',
            args: [params.deadline, calls],
            value
        };
    }
    const struct = {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: params.fee,
        recipient: params.nativeOut ? ZERO_ADDRESS : params.recipient,
        deadline: params.deadline,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMin,
        sqrtPriceLimitX96: 0n
    };
    if (!params.nativeOut)
    {
        return {
            address: params.router,
            abi: SWAP_ROUTER_ABI as Abi,
            functionName: 'exactInputSingle',
            args: [struct],
            value
        };
    }
    return {
        address: params.router,
        abi: SWAP_ROUTER_ABI as Abi,
        functionName: 'multicall',
        args: [[
            encodeFunctionData({ abi: SWAP_ROUTER_ABI, functionName: 'exactInputSingle', args: [struct] }),
            encodeFunctionData({ abi: SWAP_ROUTER_ABI, functionName: 'unwrapWETH9', args: [params.amountOutMin, params.recipient] })
        ]],
        value
    };
}

// ---------------------------------------------------------------------------
// Positions

/** Every position NFT the owner holds, newest tokenId first. */
export async function loadPositions(manager: Address, owner: Address): Promise<V3Position[]>
{
    const reader = publicClient();
    const count = await reader.readContract({
        address: manager,
        abi: POSITION_MANAGER_ABI,
        functionName: 'balanceOf',
        args: [owner]
    }).catch(() => 0n) as bigint;
    const total = Number(count > BigInt(MAX_POSITIONS) ? BigInt(MAX_POSITIONS) : count);
    if (total === 0)
    {
        return [];
    }
    const idReads = await reader.multicall({
        contracts: Array.from({ length: total }, (_unused, index) => ({
            address: manager,
            abi: POSITION_MANAGER_ABI,
            functionName: 'tokenOfOwnerByIndex' as const,
            args: [owner, BigInt(index)] as const
        })),
        allowFailure: true
    });
    const ids = idReads
        .filter((read) => read.status === 'success')
        .map((read) => read.result as bigint);
    if (ids.length === 0)
    {
        return [];
    }
    const positionReads = await reader.multicall({
        contracts: ids.map((tokenId) => ({
            address: manager,
            abi: POSITION_MANAGER_ABI,
            functionName: 'positions' as const,
            args: [tokenId] as const
        })),
        allowFailure: true
    });
    const positions: V3Position[] = [];
    ids.forEach((tokenId, index) =>
    {
        const read = positionReads[index];
        if (read.status !== 'success')
        {
            return;
        }
        const row = read.result as readonly [
            bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint
        ];
        positions.push({
            tokenId,
            token0: row[2],
            token1: row[3],
            fee: Number(row[4]),
            tickLower: Number(row[5]),
            tickUpper: Number(row[6]),
            liquidity: row[7]
        });
    });
    return positions.sort((left, right) => (right.tokenId > left.tokenId ? 1 : -1));
}

/**
 * What a position would pay out if it were closed right now - principal only.
 * Fees are a separate question (collectableFees): they are separate balances
 * on-chain, and a UI that added them would offer the same tokens twice.
 */
export function positionAmounts(
    position: V3Position,
    pool: V3PoolState | undefined
): { amount0: bigint; amount1: bigint }
{
    if (pool === undefined || position.liquidity <= 0n)
    {
        return { amount0: 0n, amount1: 0n };
    }
    return getAmountsForLiquidity(
        pool.sqrtPriceX96,
        getSqrtRatioAtTick(position.tickLower),
        getSqrtRatioAtTick(position.tickUpper),
        position.liquidity
    );
}

/** In range means earning: outside its bounds a position holds one token and idles. */
export function inRange(position: V3Position, pool: V3PoolState | undefined): boolean
{
    return pool !== undefined && pool.tick >= position.tickLower && pool.tick < position.tickUpper;
}

/**
 * Uncollected fees, from a simulated collect. The `tokensOwed` fields that come
 * back with `positions()` are only as fresh as the last time the position was
 * touched, so one nobody has poked since minting reports zero while its pool has
 * been paying it all week. Simulating the collect pokes the pool inside the call
 * and yields the number a real collect would produce.
 *
 * The call is made AS the owner: collect is owner-gated, and an eth_call from
 * the zero address reverts before it computes anything.
 */
export async function collectableFees(
    manager: Address,
    tokenId: bigint,
    owner: Address
): Promise<{ amount0: bigint; amount1: bigint }>
{
    const result = await publicClient().readContract({
        account: owner,
        address: manager,
        abi: POSITION_COLLECT_STATIC_ABI,
        functionName: 'collect',
        args: [{ tokenId, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }]
    }).catch(() => null) as readonly [bigint, bigint] | null;
    return result === null
        ? { amount0: 0n, amount1: 0n }
        : { amount0: result[0], amount1: result[1] };
}

/** The token metadata a position card needs; TokenRef satisfies it structurally. */
export interface TokenLike
{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
}

/** One position with everything a card or a manage sheet has to show. */
export interface PositionView
{
    position: V3Position;
    pool: V3PoolState | null;
    ref0: TokenLike;
    ref1: TokenLike;
    amount0: bigint;
    amount1: bigint;
    fees0: bigint;
    fees1: bigint;
    /** The pool price is inside the bounds, so this position is earning. */
    active: boolean;
}

/**
 * Every position the owner holds, resolved against its pool and its uncollected
 * fees. Three round trips for the whole list rather than three per position: the
 * ids, then one multicall for the pools they share, then the fee probes - a
 * wallet with a dozen positions across three pools reads those three pools once.
 */
export async function loadPositionViews(
    v3: { factory: Address; positionManager: Address },
    owner: Address,
    tokenOf: (address: Address) => TokenLike
): Promise<PositionView[]>
{
    const positions = await loadPositions(v3.positionManager, owner);
    if (positions.length === 0)
    {
        return [];
    }
    const [pools, fees] = await Promise.all([
        poolStatesFor(v3.factory, positions.map((position) => ({
            token0: position.token0,
            token1: position.token1,
            fee: position.fee
        }))),
        Promise.all(positions.map((position) => collectableFees(v3.positionManager, position.tokenId, owner)))
    ]);
    return positions.map((position, index) =>
    {
        const pool = pools.get(poolKey(position.token0, position.token1, position.fee));
        const amounts = positionAmounts(position, pool);
        return {
            position,
            pool: pool ?? null,
            ref0: tokenOf(position.token0),
            ref1: tokenOf(position.token1),
            amount0: amounts.amount0,
            amount1: amounts.amount1,
            fees0: fees[index].amount0,
            fees1: fees[index].amount1,
            active: inRange(position, pool)
        };
    });
}

export interface MintRequest
{
    manager: Address;
    token0: Address;
    token1: Address;
    fee: number;
    tickLower: number;
    tickUpper: number;
    amount0Desired: bigint;
    amount1Desired: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    recipient: Address;
    deadline: bigint;
    /** Native value to send; the manager wraps it and refunds the remainder. */
    nativeValue: bigint;
}

/**
 * A new position. When one side is native the mint is bundled with refundETH:
 * the desired amount is an upper bound the pool may not take in full, and
 * without the refund the difference would stay in the position manager forever.
 */
export function buildMint(request: MintRequest): WriteRequest
{
    const struct = {
        token0: request.token0,
        token1: request.token1,
        fee: request.fee,
        tickLower: request.tickLower,
        tickUpper: request.tickUpper,
        amount0Desired: request.amount0Desired,
        amount1Desired: request.amount1Desired,
        amount0Min: request.amount0Min,
        amount1Min: request.amount1Min,
        recipient: request.recipient,
        deadline: request.deadline
    };
    if (request.nativeValue <= 0n)
    {
        return {
            address: request.manager,
            abi: POSITION_MANAGER_ABI as Abi,
            functionName: 'mint',
            args: [struct]
        };
    }
    return {
        address: request.manager,
        abi: POSITION_MANAGER_ABI as Abi,
        functionName: 'multicall',
        args: [[
            encodeFunctionData({ abi: POSITION_MANAGER_ABI, functionName: 'mint', args: [struct] }),
            encodeFunctionData({ abi: POSITION_MANAGER_ABI, functionName: 'refundETH', args: [] })
        ]],
        value: request.nativeValue
    };
}

/**
 * The first position in a tier that has no pool yet: create, initialize at the
 * opening price, and mint - in ONE transaction through the manager's multicall.
 * Split across two, a provider who signs the first and abandons the second
 * leaves an initialized pool at a price they chose and nobody's liquidity in it,
 * which is an arbitrage invitation with their name on it.
 */
export function buildCreateAndMint(request: MintRequest, sqrtPriceX96: bigint): WriteRequest
{
    const calls = [
        encodeFunctionData({
            abi: POSITION_MANAGER_ABI,
            functionName: 'createAndInitializePoolIfNecessary',
            args: [request.token0, request.token1, request.fee, sqrtPriceX96]
        }),
        encodeFunctionData({
            abi: POSITION_MANAGER_ABI,
            functionName: 'mint',
            args: [{
                token0: request.token0,
                token1: request.token1,
                fee: request.fee,
                tickLower: request.tickLower,
                tickUpper: request.tickUpper,
                amount0Desired: request.amount0Desired,
                amount1Desired: request.amount1Desired,
                amount0Min: request.amount0Min,
                amount1Min: request.amount1Min,
                recipient: request.recipient,
                deadline: request.deadline
            }]
        })
    ];
    if (request.nativeValue > 0n)
    {
        calls.push(encodeFunctionData({ abi: POSITION_MANAGER_ABI, functionName: 'refundETH', args: [] }));
    }
    return {
        address: request.manager,
        abi: POSITION_MANAGER_ABI as Abi,
        functionName: 'multicall',
        args: [calls],
        value: request.nativeValue > 0n ? request.nativeValue : undefined
    };
}

export interface IncreaseRequest
{
    manager: Address;
    tokenId: bigint;
    amount0Desired: bigint;
    amount1Desired: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    deadline: bigint;
    nativeValue: bigint;
}

export function buildIncrease(request: IncreaseRequest): WriteRequest
{
    const struct = {
        tokenId: request.tokenId,
        amount0Desired: request.amount0Desired,
        amount1Desired: request.amount1Desired,
        amount0Min: request.amount0Min,
        amount1Min: request.amount1Min,
        deadline: request.deadline
    };
    if (request.nativeValue <= 0n)
    {
        return {
            address: request.manager,
            abi: POSITION_MANAGER_ABI as Abi,
            functionName: 'increaseLiquidity',
            args: [struct]
        };
    }
    return {
        address: request.manager,
        abi: POSITION_MANAGER_ABI as Abi,
        functionName: 'multicall',
        args: [[
            encodeFunctionData({ abi: POSITION_MANAGER_ABI, functionName: 'increaseLiquidity', args: [struct] }),
            encodeFunctionData({ abi: POSITION_MANAGER_ABI, functionName: 'refundETH', args: [] })
        ]],
        value: request.nativeValue
    };
}

export interface DecreaseRequest
{
    manager: Address;
    tokenId: bigint;
    liquidity: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    recipient: Address;
    deadline: bigint;
}

/**
 * Withdraw and collect in ONE transaction. decreaseLiquidity only moves the
 * principal into the position's owed balance; without the collect that follows
 * it in the same multicall the tokens sit inside the manager and the withdrawal
 * looks to the owner like it did nothing. The collect asks for the maximum, so
 * the fees earned come out alongside the principal.
 *
 * Both sides come back as ERC20s - WNURA stays wrapped, exactly as the V2
 * withdrawal leaves it. Unwrapping is one step on the swap page, and folding it
 * in here would mean a different transaction shape depending on the pair.
 */
export function buildDecrease(request: DecreaseRequest): WriteRequest
{
    return {
        address: request.manager,
        abi: POSITION_MANAGER_ABI as Abi,
        functionName: 'multicall',
        args: [[
            encodeFunctionData({
                abi: POSITION_MANAGER_ABI,
                functionName: 'decreaseLiquidity',
                args: [{
                    tokenId: request.tokenId,
                    liquidity: request.liquidity,
                    amount0Min: request.amount0Min,
                    amount1Min: request.amount1Min,
                    deadline: request.deadline
                }]
            }),
            encodeFunctionData({
                abi: POSITION_MANAGER_ABI,
                functionName: 'collect',
                args: [{
                    tokenId: request.tokenId,
                    recipient: request.recipient,
                    amount0Max: MAX_UINT128,
                    amount1Max: MAX_UINT128
                }]
            })
        ]]
    };
}

export function buildCollect(manager: Address, tokenId: bigint, recipient: Address): WriteRequest
{
    return {
        address: manager,
        abi: POSITION_MANAGER_ABI as Abi,
        functionName: 'collect',
        args: [{ tokenId, recipient, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }]
    };
}

/**
 * Creates the pool at this tier if it does not exist yet, priced at
 * `sqrtPriceX96`. Minting into a pool nobody has initialized reverts, so a first
 * provider needs this before the mint - and only a first provider: against an
 * existing pool the call is a no-op that returns the address.
 */
export function buildCreatePool(
    manager: Address,
    token0: Address,
    token1: Address,
    fee: number,
    sqrtPriceX96: bigint
): WriteRequest
{
    return {
        address: manager,
        abi: POSITION_MANAGER_ABI as Abi,
        functionName: 'createAndInitializePoolIfNecessary',
        args: [token0, token1, fee, sqrtPriceX96]
    };
}
