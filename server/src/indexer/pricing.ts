// USD pricing derived purely from pool reserves. The stable (mUSDT) anchors at
// $1; the wrapped native prices through its stable pair; every other token prices
// through its deepest pool against an already-priced token. Two passes cover
// chains where a token only pools against something that itself prices via WNURA.

import { WAD, priceFromReserves, scaleToWad, usdValue } from '@nuraswap/shared/math';

import type { Address, PairRow, TokenRow } from './db.ts';

export type PriceMap = Map<string, bigint>;

export interface PricingRefs
{
    stable: string;
    wrappedNative: string;
}

export function buildPriceMap(pairs: PairRow[], tokens: TokenRow[], refs: PricingRefs): PriceMap
{
    const decimalsOf = new Map(tokens.map((token) => [token.address, token.decimals]));
    const prices: PriceMap = new Map();
    prices.set(refs.stable.toLowerCase(), WAD);

    for (let pass = 0; pass < 2; pass++)
    {
        for (const pair of pairs)
        {
            if (pair.reserve0 <= 0n || pair.reserve1 <= 0n)
            {
                continue;
            }
            for (const [token, counter, reserveToken, reserveCounter] of [
                [pair.token0, pair.token1, pair.reserve0, pair.reserve1],
                [pair.token1, pair.token0, pair.reserve1, pair.reserve0]
            ] as Array<[Address, Address, bigint, bigint]>)
            {
                const counterPrice = prices.get(counter);
                if (counterPrice === undefined || prices.has(token))
                {
                    continue;
                }
                const tokenDecimals = decimalsOf.get(token);
                const counterDecimals = decimalsOf.get(counter);
                if (tokenDecimals === undefined || counterDecimals === undefined)
                {
                    continue;
                }
                const inCounter = priceFromReserves(reserveToken, tokenDecimals, reserveCounter, counterDecimals);
                prices.set(token, (inCounter * counterPrice) / WAD);
            }
        }
    }
    return prices;
}

export function pairTvlUsd(pair: PairRow, prices: PriceMap, decimalsOf: (address: string) => number): bigint
{
    const price0 = prices.get(pair.token0) ?? 0n;
    const price1 = prices.get(pair.token1) ?? 0n;
    return usdValue(pair.reserve0, decimalsOf(pair.token0), price0)
        + usdValue(pair.reserve1, decimalsOf(pair.token1), price1);
}

// Swap volume counts both sides of every trade, so halve the sum: input value and
// output value are the same trade seen twice (minus fee and impact).
export function volumeUsd(
    volume0: bigint,
    volume1: bigint,
    pair: PairRow,
    prices: PriceMap,
    decimalsOf: (address: string) => number
): bigint
{
    const usd0 = usdValue(volume0, decimalsOf(pair.token0), prices.get(pair.token0) ?? 0n);
    const usd1 = usdValue(volume1, decimalsOf(pair.token1), prices.get(pair.token1) ?? 0n);
    return (usd0 + usd1) / 2n;
}

// Fee APR in basis points: annualized 0.3% of 24h volume over TVL.
export function feeAprBps(volume24hUsd: bigint, tvlUsd: bigint): number
{
    if (tvlUsd <= 0n)
    {
        return 0;
    }
    return Number((volume24hUsd * 3n * 365n * 10_000n) / (1000n * tvlUsd));
}

export function toUsdNumber(valueWad: bigint): number
{
    // Display-only: cents precision is plenty and 2^53 dollars is not a real TVL.
    return Number((valueWad * 100n) / WAD) / 100;
}

export { scaleToWad };
