// USD pricing is derived, never fetched: there is no oracle here, only pool
// reserves and one anchor. Every number a user reads as money - TVL, 24h volume,
// fee APR, portfolio value - comes out of this file, so a wrong derivation is not
// a cosmetic bug, it is the exchange lying about its own size.

import { describe, expect, it } from 'vitest';

import { WAD, pow10 } from '@nuraswap/shared/math';

import { buildPriceMap, feeAprBps, pairTvlUsd, toUsdNumber, volumeUsd } from '../src/indexer/pricing.ts';
import type { Address, PairRow, TokenRow } from '../src/indexer/db.ts';

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

function pair(overrides: Partial<PairRow> & Pick<PairRow, 'address' | 'token0' | 'token1'>): PairRow
{
    return { createdBlock: 1, reserve0: 0n, reserve1: 0n, ...overrides };
}

const decimalsOf = (address: string): number =>
    TOKENS.find((token) => token.address === address.toLowerCase())?.decimals ?? 18;

// 1000 WNURA against 850,000 USDT -> $850 per WNURA.
const WNURA_USDT = pair({
    address: '0x00000000000000000000000000000000000000bb' as Address,
    token0: WNURA,
    token1: USDT,
    reserve0: 1000n * WAD,
    reserve1: 850_000n * pow10(6)
});

// 10,000 ALPHA against 100 WNURA -> 0.01 WNURA each -> $8.50.
const ALPHA_WNURA = pair({
    address: '0x00000000000000000000000000000000000000aa' as Address,
    token0: ALPHA,
    token1: WNURA,
    reserve0: 10_000n * WAD,
    reserve1: 100n * WAD
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
        expect(prices.get(WNURA)).toBe(850n * WAD);
    });

    // The second pass is what makes this work: ALPHA can only be priced once
    // WNURA has a price, and nothing guarantees the pools arrive in that order.
    it('prices a token two hops out, whichever order the pools arrive in', () =>
    {
        const forward = buildPriceMap([WNURA_USDT, ALPHA_WNURA], TOKENS, REFS);
        const reversed = buildPriceMap([ALPHA_WNURA, WNURA_USDT], TOKENS, REFS);
        expect(forward.get(ALPHA)).toBe(85n * WAD / 10n);
        expect(reversed.get(ALPHA)).toBe(forward.get(ALPHA));
    });

    it('prices from either side of a pool', () =>
    {
        // Same pool with the token order flipped: USDT as token0.
        const flipped = pair({
            address: '0x00000000000000000000000000000000000000cc' as Address,
            token0: USDT,
            token1: WNURA,
            reserve0: 850_000n * pow10(6),
            reserve1: 1000n * WAD
        });
        expect(buildPriceMap([flipped], TOKENS, REFS).get(WNURA)).toBe(850n * WAD);
    });

    it('leaves a token with no path to the stable unpriced rather than guessing', () =>
    {
        const orphanPool = pair({
            address: '0x00000000000000000000000000000000000000dd' as Address,
            token0: ORPHAN,
            token1: OMEGA,
            reserve0: 100n * WAD,
            reserve1: 100n * pow10(8)
        });
        const prices = buildPriceMap([orphanPool], TOKENS, REFS);
        expect(prices.get(ORPHAN)).toBeUndefined();
        expect(prices.get(OMEGA)).toBeUndefined();
    });

    // Two passes reach two hops. A third hop is out of range by design, and the
    // consequence is an unpriced token, never a wrong price.
    it('reaches two hops and stops - a third hop stays unpriced', () =>
    {
        const omegaAlpha = pair({
            address: '0x00000000000000000000000000000000000000ee' as Address,
            token0: OMEGA,
            token1: ALPHA,
            reserve0: 100n * pow10(8),
            reserve1: 100n * WAD
        });
        const prices = buildPriceMap([omegaAlpha, ALPHA_WNURA, WNURA_USDT], TOKENS, REFS);
        expect(prices.get(WNURA)).toBeDefined();
        expect(prices.get(ALPHA)).toBeDefined();
        expect(prices.get(OMEGA)).toBeUndefined();
    });

    it('ignores a drained pool instead of dividing by its empty side', () =>
    {
        const drained = pair({ address: WNURA_USDT.address, token0: WNURA, token1: USDT, reserve0: 0n, reserve1: 0n });
        expect(buildPriceMap([drained], TOKENS, REFS).get(WNURA)).toBeUndefined();

        const halfDrained = pair({
            address: WNURA_USDT.address,
            token0: WNURA,
            token1: USDT,
            reserve0: 1000n * WAD,
            reserve1: 0n
        });
        expect(buildPriceMap([halfDrained], TOKENS, REFS).get(WNURA)).toBeUndefined();
    });

    it('skips a pool whose token decimals are unknown', () =>
    {
        // A pair discovered before its token metadata was registered: pricing it
        // with a guessed 18 would be wrong by orders of magnitude on a 6dp token.
        const prices = buildPriceMap([WNURA_USDT], [TOKENS[1]], REFS);
        expect(prices.get(WNURA)).toBeUndefined();
        expect(prices.get(USDT)).toBe(WAD);
    });

    it('keeps the first price it derives for a token', () =>
    {
        const thinner = pair({
            address: '0x00000000000000000000000000000000000000ff' as Address,
            token0: WNURA,
            token1: USDT,
            reserve0: 1n * WAD,
            reserve1: 1n * pow10(6)
        });
        const prices = buildPriceMap([WNURA_USDT, thinner], TOKENS, REFS);
        expect(prices.get(WNURA)).toBe(850n * WAD);
    });

    it('anchors on a lowercased stable address', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, { ...REFS, stable: USDT.toUpperCase() });
        expect(prices.get(USDT)).toBe(WAD);
        expect(prices.get(WNURA)).toBe(850n * WAD);
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

describe('pairTvlUsd', () =>
{
    it('sums both sides at their derived prices', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, REFS);
        // 1000 WNURA at $850 plus 850,000 USDT at $1 = $1.7m.
        expect(pairTvlUsd(WNURA_USDT, prices, decimalsOf)).toBe(1_700_000n * WAD);
    });

    it('counts only the side it can price', () =>
    {
        const halfPriced = pair({
            address: '0x0000000000000000000000000000000000000abc' as Address,
            token0: USDT,
            token1: ORPHAN,
            reserve0: 500n * pow10(6),
            reserve1: 1n * WAD
        });
        const prices = buildPriceMap([], TOKENS, REFS);
        expect(pairTvlUsd(halfPriced, prices, decimalsOf)).toBe(500n * WAD);
    });

    it('is zero for a pool of two unpriced tokens', () =>
    {
        const unpriced = pair({
            address: '0x0000000000000000000000000000000000000abd' as Address,
            token0: ORPHAN,
            token1: OMEGA,
            reserve0: 10n * WAD,
            reserve1: 10n * pow10(8)
        });
        expect(pairTvlUsd(unpriced, buildPriceMap([], TOKENS, REFS), decimalsOf)).toBe(0n);
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
        const value = volumeUsd(1n * WAD, 850n * pow10(6), WNURA_USDT, prices, decimalsOf);
        expect(value).toBe(850n * WAD);
    });

    it('is zero when nothing traded', () =>
    {
        const prices = buildPriceMap([WNURA_USDT], TOKENS, REFS);
        expect(volumeUsd(0n, 0n, WNURA_USDT, prices, decimalsOf)).toBe(0n);
    });

    it('halves a one-sided figure when only one token is priced', () =>
    {
        const prices = buildPriceMap([], TOKENS, REFS);
        const half = volumeUsd(0n, 100n * pow10(6), WNURA_USDT, prices, decimalsOf);
        expect(half).toBe(50n * WAD);
    });
});

describe('feeAprBps', () =>
{
    it('annualizes the pool fee on 24h volume over TVL', () =>
    {
        // Volume equal to TVL, at 25 bps: 25 * 365 = 9125 bps a year.
        expect(feeAprBps(1000n * WAD, 1000n * WAD, 25)).toBe(9125);
    });

    it('scales with the fee the factory actually charges', () =>
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
