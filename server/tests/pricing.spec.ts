// Every number a user reads as money - TVL, 24h volume, fee APR, portfolio
// value - comes out of this file, so a wrong derivation is not a cosmetic bug,
// it is the exchange lying about its own size.
//
// Two anchors feed it: the stable at $1, and SEEDED prices for bridged assets
// nothing on chain can value. Everything else is derived from pools - and where
// pools disagree, the DEEPEST one wins, which is the whole reason a pool holding
// one wei cannot set the price of the token beside it.

import { describe, expect, it } from 'vitest';

import { WAD, pow10 } from '@nuraswap/shared/math';
import { sqrtX96FromPriceWad } from '@nuraswap/shared/v3-math';

import { anchorsOnly, buildPriceMap, feeAprBps, poolTvlUsd, toUsdNumber, volumeUsd } from '../src/indexer/pricing.ts';
import type { Address, TokenRow, V3PoolRow } from '../src/indexer/db.ts';

const WNURA = '0x000000000000000000000000000000000000b0b0' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const ALPHA = '0x0000000000000000000000000000000000000001' as Address;
const OMEGA = '0x0000000000000000000000000000000000000003' as Address;
const ORPHAN = '0x0000000000000000000000000000000000000004' as Address;

const TOKENS: TokenRow[] = [
    { address: WNURA, symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 },
    { address: USDT, symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 },
    { address: ALPHA, symbol: 'ALPHA', name: 'Alpha', decimals: 18 },
    { address: OMEGA, symbol: 'OMEGA', name: 'Omega', decimals: 8 },
    { address: ORPHAN, symbol: 'ORPHAN', name: 'Orphan', decimals: 18 }
];

const REFS = { stable: USDT, wrappedNative: WNURA };

function v3Pool(overrides: Partial<V3PoolRow> & Pick<V3PoolRow, 'address' | 'token0' | 'token1'>): V3PoolRow
{
    return {
        fee: 500,
        createdBlock: 1,
        balance0: 0n,
        balance1: 0n,
        sqrtPriceX96: 0n,
        ...overrides
    };
}

// A V3 price round-trips through an INTEGER square root in Q64.96, so it lands a
// few wei off a round number. Asserting exact equality here would be asserting
// the rounding, not the pricing.
function expectAboutWad(actual: bigint | undefined, expected: bigint): void
{
    expect(actual).toBeDefined();
    const value = actual as bigint;
    const delta = value > expected ? value - expected : expected - value;
    // A part per billion - orders tighter than any figure this feeds.
    expect(delta * 1_000_000_000n <= expected).toBe(true);
}

/** sqrtPriceX96 for a whole-number token1-per-token0 rate at the given decimals. */
function sqrtX96For(token1PerToken0: bigint, decimals0 = 18, decimals1 = 18): bigint
{
    return sqrtX96FromPriceWad(token1PerToken0 * WAD, decimals0, decimals1);
}

const decimalsOf = (address: string): number =>
    TOKENS.find((token) => token.address === address.toLowerCase())?.decimals ?? 18;

// 1000 WNURA against 850,000 USDT -> $850 per WNURA. The USDT side is also the
// depth that prices WNURA once the stable is anchored.
const WNURA_USDT = v3Pool({
    address: '0x00000000000000000000000000000000000000bb' as Address,
    token0: WNURA,
    token1: USDT,
    balance0: 1000n * WAD,
    balance1: 850_000n * pow10(6),
    sqrtPriceX96: sqrtX96For(850n, 18, 6)
});

// 10,000 ALPHA against 100 WNURA -> 0.01 WNURA each -> $8.50.
const ALPHA_WNURA = v3Pool({
    address: '0x00000000000000000000000000000000000000aa' as Address,
    token0: ALPHA,
    token1: WNURA,
    balance0: 10_000n * WAD,
    balance1: 100n * WAD,
    sqrtPriceX96: sqrtX96FromPriceWad(WAD / 100n, 18, 18)
});

describe('buildPriceMap', () =>
{
    it('anchors the stable at exactly one dollar', () =>
    {
        expect(buildPriceMap([], TOKENS, REFS).get(USDT)).toBe(WAD);
    });

    it('prices a token through its direct pool against the stable', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, REFS);
        expectAboutWad(prices.get(WNURA), 850n * WAD);
    });

    // The second pass is what makes this work: ALPHA can only be priced once
    // WNURA has a price, and nothing guarantees the pools arrive in that order.
    it('prices a token two hops out, whichever order the pools arrive in', () =>
    {
        const forward = buildPriceMap([WNURA_USDT, ALPHA_WNURA], TOKENS, REFS);
        const reversed = buildPriceMap([ALPHA_WNURA, WNURA_USDT], TOKENS, REFS);
        expectAboutWad(forward.get(ALPHA), 85n * WAD / 10n);
        expect(reversed.get(ALPHA)).toBe(forward.get(ALPHA));
    });

    it('prices from either side of a pool', () =>
    {
        // Same pool with the token order flipped: USDT as token0.
        const flipped = v3Pool({
            address: '0x00000000000000000000000000000000000000cc' as Address,
            token0: USDT,
            token1: WNURA,
            balance0: 850_000n * pow10(6),
            balance1: 1000n * WAD,
            sqrtPriceX96: sqrtX96FromPriceWad(WAD / 850n, 6, 18)
        });
        const prices = buildPriceMap([flipped], TOKENS, REFS);
        expectAboutWad(prices.get(WNURA), 850n * WAD);
    });

    it('leaves a token with no path to the stable unpriced rather than guessing', () =>
    {
        const orphanPool = v3Pool({
            address: '0x00000000000000000000000000000000000000dd' as Address,
            token0: ORPHAN,
            token1: OMEGA,
            balance0: 100n * WAD,
            balance1: 100n * pow10(8),
            sqrtPriceX96: sqrtX96For(1n)
        });
        const prices = buildPriceMap([orphanPool], TOKENS, REFS);
        expect(prices.get(ORPHAN)).toBeUndefined();
        expect(prices.get(OMEGA)).toBeUndefined();
    });

    // Two passes reach two hops. A third hop is out of range by design, and the
    // consequence is an unpriced token, never a wrong price.
    it('reaches two hops and stops - a third hop stays unpriced', () =>
    {
        const omegaAlpha = v3Pool({
            address: '0x00000000000000000000000000000000000000ee' as Address,
            token0: OMEGA,
            token1: ALPHA,
            balance0: 100n * pow10(8),
            balance1: 100n * WAD,
            sqrtPriceX96: sqrtX96For(1n)
        });
        const prices = buildPriceMap([omegaAlpha, ALPHA_WNURA, WNURA_USDT], TOKENS, REFS);
        expect(prices.get(WNURA)).toBeDefined();
        expect(prices.get(ALPHA)).toBeDefined();
        expect(prices.get(OMEGA)).toBeUndefined();
    });

    it('ignores a pool that has never been initialized instead of dividing by its zero price', () =>
    {
        // sqrtPriceX96 is zero until the pool is initialized, and until the
        // indexer has read slot0 even once. Neither is a price of nothing.
        const uninitialized = v3Pool({
            address: WNURA_USDT.address,
            token0: WNURA,
            token1: USDT,
            balance0: 1000n * WAD,
            balance1: 850_000n * pow10(6)
        });
        expect(buildPriceMap([uninitialized], TOKENS, REFS).get(WNURA)).toBeUndefined();
    });

    it('skips a pool whose token decimals are unknown', () =>
    {
        // A pool discovered before its token metadata was registered: pricing it
        // with a guessed 18 would be wrong by orders of magnitude on a 6dp token.
        const prices = buildPriceMap([WNURA_USDT], [TOKENS[1]], REFS);
        expect(prices.get(WNURA)).toBeUndefined();
        expect(prices.get(USDT)).toBe(WAD);
    });

    it('takes the deepest pool that can name a price, whatever the scan order', () =>
    {
        // One WNURA against one USDT implies $1. It is not a market, it is a
        // rounding error with an address, and it must not outvote the pool holding
        // 850k - which is exactly what happened while the first match won.
        const thinner = v3Pool({
            address: '0x00000000000000000000000000000000000000ff' as Address,
            token0: WNURA,
            token1: USDT,
            balance0: 1n * WAD,
            balance1: 1n * pow10(6),
            sqrtPriceX96: sqrtX96For(1n, 18, 6)
        });
        expectAboutWad(buildPriceMap([thinner, WNURA_USDT], TOKENS, REFS).get(WNURA), 850n * WAD);
        expectAboutWad(buildPriceMap([WNURA_USDT, thinner], TOKENS, REFS).get(WNURA), 850n * WAD);
    });

    it('prices from slot0 rather than from what the pool holds', () =>
    {
        // 2 WNURA per ALPHA by slot0. The BALANCES are lopsided on purpose: a
        // concentrated pool holds whatever its ranges leave it holding, and reading
        // a rate out of that ratio would give 100, not 2.
        const pool = v3Pool({
            address: '0x00000000000000000000000000000000000000c3' as Address,
            token0: ALPHA,
            token1: WNURA,
            balance0: 1n * WAD,
            balance1: 100n * WAD,
            sqrtPriceX96: sqrtX96For(2n)
        });
        const prices = buildPriceMap([WNURA_USDT, pool], TOKENS, REFS);
        // 2 WNURA at $850 = $1700.
        expectAboutWad(prices.get(ALPHA), 1700n * WAD);
    });

    it('lets a funded pool outrank a dust pool on the same tokens', () =>
    {
        // The shape this chain is actually in: a pool holding a WEI beside one
        // holding real money, disagreeing about the native token's price.
        const dust = v3Pool({
            address: '0x00000000000000000000000000000000000000fe' as Address,
            token0: ALPHA,
            token1: WNURA,
            balance0: 1n,
            balance1: 4n,
            sqrtPriceX96: sqrtX96For(4n)
        });
        const funded = v3Pool({
            address: '0x00000000000000000000000000000000000000c4' as Address,
            token0: ALPHA,
            token1: WNURA,
            balance0: 10n * WAD,
            balance1: 20n * WAD,
            sqrtPriceX96: sqrtX96For(2n)
        });
        const prices = buildPriceMap([WNURA_USDT, dust, funded], TOKENS, REFS);
        // The dust pool says 4 WNURA each ($3400); the funded pool says 2 ($1700).
        expectAboutWad(prices.get(ALPHA), 1700n * WAD);
    });

    it('ignores a pool holding nothing, however confident its price', () =>
    {
        // Depth is what the pool holds of the side already priced. Zero of it means
        // the quote is backed by nothing, whatever slot0 says.
        const empty = v3Pool({
            address: '0x00000000000000000000000000000000000000c6' as Address,
            token0: ALPHA,
            token1: WNURA,
            sqrtPriceX96: sqrtX96For(2n)
        });
        const prices = buildPriceMap([WNURA_USDT, empty], TOKENS, REFS);
        expect(prices.get(ALPHA)).toBeUndefined();
    });

    it('anchors on a lowercased stable address', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, { ...REFS, stable: USDT.toUpperCase() });
        expect(prices.get(USDT)).toBe(WAD);
        expectAboutWad(prices.get(WNURA), 850n * WAD);
    });

    // A chain with no stable in its artifact: app.ts falls back to ''. Everything
    // reads "Unpriced", which is the honest answer, and nothing crashes.
    it('prices nothing when the deployment has no stable to anchor on', () =>
    {
        const prices = buildPriceMap([WNURA_USDT, ALPHA_WNURA], TOKENS, { stable: '', wrappedNative: WNURA });
        expect(prices.get(WNURA)).toBeUndefined();
        expect(prices.get(ALPHA)).toBeUndefined();
    });
});

describe('anchorsOnly', () =>
{
    it('keeps the stable and the fed prices, drops everything derived', () =>
    {
        const seeds = new Map([[ALPHA, 500n * WAD]]);
        const prices = buildPriceMap([WNURA_USDT], TOKENS, REFS, seeds);
        const anchored = anchorsOnly(prices, REFS, seeds);

        // Both anchors survive: one by definition, one from outside the chain.
        expect(anchored.get(USDT)).toBe(WAD);
        expect(anchored.get(ALPHA)).toBe(500n * WAD);
        // WNURA has a price - it is just one a pool asserted, so it cannot be
        // counted as value the exchange can prove it holds.
        expectAboutWad(prices.get(WNURA), 850n * WAD);
        expect(anchored.has(WNURA)).toBe(false);
    });

    it('is empty when the stable has no price and nothing was fed', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, { ...REFS, stable: ORPHAN });
        // ORPHAN is anchored at $1 by being named the stable, so it IS in there -
        // what must not be is anything that priced off a pool.
        const anchored = anchorsOnly(prices, { ...REFS, stable: ORPHAN });
        expect([...anchored.keys()]).toEqual([ORPHAN]);
    });

    it('values a pool at its anchored side alone', () =>
    {
        // The shape that started this: one pool, one side anchored, one side priced
        // by that same pool. Counting both makes it worth double its real half.
        const prices = buildPriceMap([WNURA_USDT], TOKENS, REFS);
        const anchored = anchorsOnly(prices, REFS);
        expectAboutWad(poolTvlUsd(WNURA_USDT, WNURA_USDT.balance0, WNURA_USDT.balance1, prices, decimalsOf), 1_700_000n * WAD);
        expectAboutWad(poolTvlUsd(WNURA_USDT, WNURA_USDT.balance0, WNURA_USDT.balance1, anchored, decimalsOf), 850_000n * WAD);
    });
});

describe('poolTvlUsd', () =>
{
    it('sums both sides at their derived prices', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, REFS);
        // 1000 WNURA at $850 plus 850,000 USDT at $1 = $1.7m.
        expectAboutWad(
            poolTvlUsd(WNURA_USDT, WNURA_USDT.balance0, WNURA_USDT.balance1, prices, decimalsOf),
            1_700_000n * WAD
        );
    });

    it('counts only the side it can price', () =>
    {
        const halfPriced = v3Pool({
            address: '0x0000000000000000000000000000000000000abc' as Address,
            token0: USDT,
            token1: ORPHAN,
            balance0: 500n * pow10(6),
            balance1: 1n * WAD,
            sqrtPriceX96: sqrtX96For(1n, 6, 18)
        });
        const prices = buildPriceMap([], TOKENS, REFS);
        expect(poolTvlUsd(halfPriced, halfPriced.balance0, halfPriced.balance1, prices, decimalsOf)).toBe(500n * WAD);
    });

    it('is zero for a pool of two unpriced tokens', () =>
    {
        const unpriced = v3Pool({
            address: '0x0000000000000000000000000000000000000abd' as Address,
            token0: ORPHAN,
            token1: OMEGA,
            balance0: 10n * WAD,
            balance1: 10n * pow10(8),
            sqrtPriceX96: sqrtX96For(1n)
        });
        expect(poolTvlUsd(unpriced, unpriced.balance0, unpriced.balance1, buildPriceMap([], TOKENS, REFS), decimalsOf)).toBe(0n);
    });
});

describe('volumeUsd', () =>
{
    // A swap moves value in and value out; counting both sides doubles it. The
    // halving is what keeps 24h volume comparable with any other exchange's.
    it('halves the two-sided sum into one trade of value', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, REFS);
        // 1 WNURA in ($850), ~850 USDT out ($850) -> $850 of volume, not $1700.
        expectAboutWad(volumeUsd(1n * WAD, 850n * pow10(6), WNURA_USDT, prices, decimalsOf), 850n * WAD);
    });

    it('is zero when nothing traded', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, REFS);
        expect(volumeUsd(0n, 0n, WNURA_USDT, prices, decimalsOf)).toBe(0n);
    });

    it('does NOT halve when only one side can be priced', () =>
    {
        // Halving exists to remove a double count: input and output are the same
        // trade seen twice. With one side unpriced there is no double to remove -
        // the priced side IS the trade - and halving reported a $100 swap as $50
        // because nobody could put a number on what it bought.
        const prices = buildPriceMap([], TOKENS, REFS);
        const whole = volumeUsd(0n, 100n * pow10(6), WNURA_USDT, prices, decimalsOf);
        expect(whole).toBe(100n * WAD);
    });

    it('still halves when both sides carry a price', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, REFS);
        // 1 WNURA ($850) in for 850 USDT out: one trade of $850, not $1700.
        expectAboutWad(volumeUsd(1n * WAD, 850n * pow10(6), WNURA_USDT, prices, decimalsOf), 850n * WAD);
    });
});

describe('feeAprBps', () =>
{
    it('annualizes the pool fee on 24h volume over TVL', () =>
    {
        // Volume equal to TVL, at 25 bps: 25 * 365 = 9125 bps a year.
        expect(feeAprBps(1000n * WAD, 1000n * WAD, 25)).toBe(9125);
    });

    it('scales with the fee the pool actually charges', () =>
    {
        expect(feeAprBps(1000n * WAD, 1000n * WAD, 30)).toBe(30 * 365);
        expect(feeAprBps(1000n * WAD, 1000n * WAD, 0)).toBe(0);
    });

    it('is zero on an empty pool rather than dividing by zero', () =>
    {
        expect(feeAprBps(1000n * WAD, 0n, 25)).toBe(0);
        expect(feeAprBps(0n, 0n, 25)).toBe(0);
    });

    it('is zero for a pool nobody traded', () =>
    {
        expect(feeAprBps(0n, 1000n * WAD, 25)).toBe(0);
    });

    it('handles volume far above TVL without overflowing into nonsense', () =>
    {
        const apr = feeAprBps(1_000_000n * WAD, 1n * WAD, 25);
        expect(Number.isFinite(apr)).toBe(true);
        expect(apr).toBe(1_000_000 * 25 * 365);
    });
});

describe('toUsdNumber', () =>
{
    it('keeps cents and truncates below them', () =>
    {
        expect(toUsdNumber(WAD)).toBe(1);
        expect(toUsdNumber(WAD / 2n)).toBe(0.5);
        expect(toUsdNumber(1_234_567_000_000_000_000n)).toBe(1.23);
        expect(toUsdNumber(0n)).toBe(0);
    });

    it('does not round dust up into a cent', () =>
    {
        expect(toUsdNumber(1n)).toBe(0);
        expect(toUsdNumber(WAD / 1000n)).toBe(0);
    });

    it('stays exact across a realistic TVL', () =>
    {
        expect(toUsdNumber(1_700_000n * WAD)).toBe(1_700_000);
        expect(Number.isSafeInteger(toUsdNumber(1_000_000_000n * WAD) * 100)).toBe(true);
    });
});
