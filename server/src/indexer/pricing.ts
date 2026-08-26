// USD pricing over a set of anchors. The stable (mUSDT) anchors at $1; every
// other token prices through a pool against an already-priced token. Two passes
// cover chains where a token only pools against something that itself prices via
// the wrapped native.
//
// SEEDS are the second kind of anchor: a bridged asset is worth what the asset
// it bridges is worth, which is a fact no pool on this chain contains. Without
// one, a chain whose stable has no liquidity prices nothing at all - the anchor
// exists but connects to no pool, and every figure downstream reads $0.
//
// DEPTH decides between pools, and it has to. This chain can carry a pool
// holding one wei beside one holding a whole BNB, and the two disagree by 4x
// about what the native token is worth. Taking whichever was scanned first let a
// wei outvote the pool with the money in it.

import { WAD, usdValue } from '@nuraswap/shared/math';
import { priceWadFromSqrtX96 } from '@nuraswap/shared/v3-math';

import type { Address, TokenRow, V3PoolRow } from './db.ts';

export type PriceMap = Map<string, bigint>;

export interface PricingRefs
{
    stable: string;
    wrappedNative: string;
}

// One SIDE of one pool: what `token` costs in `counter`, and how much of
// `counter` the pool holds. Depth is measured on the counter because that is the
// side whose USD value is already known - the token being priced has none yet.
interface Candidate
{
    token: Address;
    counter: Address;
    priceInCounter: bigint;
    counterAmount: bigint;
}

function candidatesOf(pools: V3PoolRow[], decimalsOf: Map<string, number>): Candidate[]
{
    const candidates: Candidate[] = [];

    for (const pool of pools)
    {
        const decimals0 = decimalsOf.get(pool.token0);
        const decimals1 = decimalsOf.get(pool.token1);
        if (pool.sqrtPriceX96 <= 0n || decimals0 === undefined || decimals1 === undefined)
        {
            continue;
        }
        // The pool's OWN price, out of slot0 - never a ratio of its balances. Where
        // a concentrated pool's liquidity sits decides what it holds, so the holdings
        // say nothing about the rate. They are the DEPTH, not the price.
        const priceWad = priceWadFromSqrtX96(pool.sqrtPriceX96, decimals0, decimals1);
        if (priceWad <= 0n)
        {
            continue;
        }
        candidates.push({
            token: pool.token0,
            counter: pool.token1,
            priceInCounter: priceWad,
            counterAmount: pool.balance1
        });
        candidates.push({
            token: pool.token1,
            counter: pool.token0,
            priceInCounter: (WAD * WAD) / priceWad,
            counterAmount: pool.balance0
        });
    }

    return candidates;
}

export function buildPriceMap(
    pools: V3PoolRow[],
    tokens: TokenRow[],
    refs: PricingRefs,
    /** Address -> USD price in 1e18, from outside the chain. Applied before propagation. */
    seeds?: ReadonlyMap<string, bigint>
): PriceMap
{
    const decimalsOf = new Map(tokens.map((token) => [token.address, token.decimals]));
    const prices: PriceMap = new Map();
    for (const [address, price] of seeds ?? [])
    {
        if (price > 0n)
        {
            prices.set(address.toLowerCase(), price);
        }
    }
    // Last, and deliberately: the stable is $1 BY DEFINITION in this model, and a
    // feed quoting it at 0.9997 would relabel every other price on the site.
    prices.set(refs.stable.toLowerCase(), WAD);

    const candidates = candidatesOf(pools, decimalsOf);

    for (let pass = 0; pass < 2; pass++)
    {
        // Resolved per PASS rather than per candidate: every pool that can name a
        // price for this token is weighed first, and the deepest one wins. Setting
        // inline would mean whichever pool the scan reached first, which is an
        // ordering accident, not a market.
        const best = new Map<string, { price: bigint; depth: bigint }>();
        for (const candidate of candidates)
        {
            const counterPrice = prices.get(candidate.counter);
            const counterDecimals = decimalsOf.get(candidate.counter);
            if (counterPrice === undefined || counterDecimals === undefined || prices.has(candidate.token))
            {
                continue;
            }
            const depth = usdValue(candidate.counterAmount, counterDecimals, counterPrice);
            const price = (candidate.priceInCounter * counterPrice) / WAD;
            if (depth <= 0n || price <= 0n)
            {
                continue;
            }
            const incumbent = best.get(candidate.token);
            if (incumbent === undefined || depth > incumbent.depth)
            {
                best.set(candidate.token, { price, depth });
            }
        }
        for (const [token, pick] of best)
        {
            prices.set(token, pick.price);
        }
    }
    return prices;
}
// The prices that came from OUTSIDE the pools: the stable by definition, and
// whatever the feed could name. Every other entry in the map was derived FROM a
// pool, and a pool cannot vouch for what it holds - the rate it quotes is one
// its own depositor chose when they funded it.
//
// `Value locked` is reported on this basis. Counting a derived price makes a
// two-token pool worth twice its anchored side no matter what is in it: deposit
// one BNB and any quantity of a token nobody else prices, and the headline
// reads two BNB. That is not a rounding problem, it is the exchange quoting
// itself as the source for half of its own size.
export function anchorsOnly(
    prices: PriceMap,
    refs: PricingRefs,
    seeds?: ReadonlyMap<string, bigint>
): PriceMap
{
    const anchored: PriceMap = new Map();
    for (const key of [refs.stable, ...(seeds === undefined ? [] : [...seeds.keys()])])
    {
        const address = key.toLowerCase();
        const price = prices.get(address);
        if (price !== undefined && price > 0n)
        {
            anchored.set(address, price);
        }
    }
    return anchored;
}

// What a pool is worth: both sides at their derived prices. The balances are
// what the pool contract actually holds - a concentrated pool has no reserves,
// and what it holds is the only honest answer.
export function poolTvlUsd(
    pool: { token0: Address; token1: Address },
    amount0: bigint,
    amount1: bigint,
    prices: PriceMap,
    decimalsOf: (address: string) => number
): bigint
{
    return usdValue(amount0, decimalsOf(pool.token0), prices.get(pool.token0) ?? 0n)
        + usdValue(amount1, decimalsOf(pool.token1), prices.get(pool.token1) ?? 0n);
}

// Swap volume counts both sides of every trade, so halve the sum: input value and
// output value are the same trade seen twice (minus fee and impact). When only
// ONE side can be priced there is no double to remove - that side IS the trade,
// and halving it would report a $100 swap as $50 because nobody could put a
// number on what it bought.
export function volumeUsd(
    volume0: bigint,
    volume1: bigint,
    pool: { token0: Address; token1: Address },
    prices: PriceMap,
    decimalsOf: (address: string) => number
): bigint
{
    const price0 = prices.get(pool.token0) ?? 0n;
    const price1 = prices.get(pool.token1) ?? 0n;
    const usd0 = usdValue(volume0, decimalsOf(pool.token0), price0);
    const usd1 = usdValue(volume1, decimalsOf(pool.token1), price1);
    return price0 > 0n && price1 > 0n ? (usd0 + usd1) / 2n : usd0 + usd1;
}

// Fee APR in basis points: the pool's own fee on 24h volume, annualized over
// TVL. Each pool carries its own tier fee, so the caller passes that pool's fee
// in basis points - an APR computed from a fee nobody charges is a number that
// lies in the direction that flatters us.
export function feeAprBps(volume24hUsd: bigint, tvlUsd: bigint, poolFeeBps: number): number
{
    if (tvlUsd <= 0n)
    {
        return 0;
    }
    return Number((volume24hUsd * BigInt(poolFeeBps) * 365n) / tvlUsd);
}

export function toUsdNumber(valueWad: bigint): number
{
    // Display-only: cents precision is plenty and 2^53 dollars is not a real TVL.
    return Number((valueWad * 100n) / WAD) / 100;
}

// A per-TOKEN price, where cents are NOT plenty. A native token quoted against a
// bridged asset lands around $0.00026, and rounding that to zero makes the token
// registry say the token is worthless - which the portfolio then prints. Totals
// keep toUsdNumber: a TVL carried to eight decimals is noise.
export function toUsdPrice(valueWad: bigint): number
{
    return Number((valueWad * 100_000_000n) / WAD) / 100_000_000;
}
