import { describe, expect, it } from 'vitest';

import {
    BPS,
    WAD,
    getAmountIn,
    getAmountOut,
    maxInForSlippage,
    minOutForSlippage,
    pow10,
    priceFromReserves,
    priceImpactBps,
    quote,
    scaleToWad,
    sqrtBigint,
    usdValue
} from '../src/math.ts';

describe('getAmountOut', () =>
{
    it('matches the 0.3% fee formula', () =>
    {
        const out = getAmountOut(1000n, 100_000n, 100_000n);
        expect(out).toBe((1000n * 997n * 100_000n) / (100_000n * 1000n + 1000n * 997n));
    });

    it('returns 0 on empty reserves or zero input', () =>
    {
        expect(getAmountOut(0n, 10n, 10n)).toBe(0n);
        expect(getAmountOut(10n, 0n, 10n)).toBe(0n);
        expect(getAmountOut(10n, 10n, 0n)).toBe(0n);
    });

    it('is monotonic in amountIn', () =>
    {
        const reserveIn = 10n ** 24n;
        const reserveOut = 10n ** 22n;
        let previous = 0n;
        for (const amountIn of [WAD, 10n * WAD, 100n * WAD, 1000n * WAD])
        {
            const out = getAmountOut(amountIn, reserveIn, reserveOut);
            expect(out > previous).toBe(true);
            previous = out;
        }
    });
});

describe('getAmountIn', () =>
{
    it('is a sufficient inverse of getAmountOut', () =>
    {
        const reserveIn = 5000n * WAD;
        const reserveOut = 12_000n * WAD;
        const amountIn = 37n * WAD;
        const out = getAmountOut(amountIn, reserveIn, reserveOut);
        const need = getAmountIn(out, reserveIn, reserveOut);
        expect(need <= amountIn).toBe(true);
        expect(getAmountOut(need, reserveIn, reserveOut) >= out).toBe(true);
    });

    it('returns 0 when the pool cannot pay the requested output', () =>
    {
        expect(getAmountIn(100n, 1000n, 100n)).toBe(0n);
        expect(getAmountIn(101n, 1000n, 100n)).toBe(0n);
        expect(getAmountIn(0n, 1000n, 100n)).toBe(0n);
    });
});

describe('quote', () =>
{
    it('fills the counterpart amount by reserve ratio', () =>
    {
        expect(quote(10n * WAD, 100n * WAD, 250n * WAD)).toBe(25n * WAD);
        expect(quote(10n, 0n, 250n)).toBe(0n);
    });
});

describe('priceImpactBps', () =>
{
    it('reports near-zero impact for a dust trade and excludes the fee', () =>
    {
        const impact = priceImpactBps(
            WAD / 1000n,
            getAmountOut(WAD / 1000n, 1_000_000n * WAD, 1_000_000n * WAD),
            1_000_000n * WAD,
            1_000_000n * WAD
        );
        expect(impact).toBeLessThanOrEqual(1);
    });

    it('reports ~1% for a trade of 1% of reserves', () =>
    {
        const reserveIn = 1000n * WAD;
        const reserveOut = 1000n * WAD;
        const amountIn = 10n * WAD;
        const out = getAmountOut(amountIn, reserveIn, reserveOut);
        const impact = priceImpactBps(amountIn, out, reserveIn, reserveOut);
        expect(impact).toBeGreaterThanOrEqual(95);
        expect(impact).toBeLessThanOrEqual(102);
    });
});

describe('slippage bounds', () =>
{
    it('minOutForSlippage applies bps downward', () =>
    {
        expect(minOutForSlippage(10_000n, 50)).toBe(9950n);
        expect(minOutForSlippage(10_000n, 0)).toBe(10_000n);
    });

    it('maxInForSlippage applies bps upward', () =>
    {
        expect(maxInForSlippage(10_000n, 50)).toBe(10_050n);
    });
});

describe('sqrtBigint', () =>
{
    it('handles exact squares and floors in between', () =>
    {
        expect(sqrtBigint(0n)).toBe(0n);
        expect(sqrtBigint(1n)).toBe(1n);
        expect(sqrtBigint(144n)).toBe(12n);
        expect(sqrtBigint(145n)).toBe(12n);
        expect(sqrtBigint((10n ** 18n) ** 2n)).toBe(10n ** 18n);
    });

    it('rejects negatives', () =>
    {
        expect(() => sqrtBigint(-1n)).toThrow(RangeError);
    });
});

describe('decimal scaling and pricing', () =>
{
    it('scaleToWad normalizes 6, 8, 18 and 24 decimal amounts', () =>
    {
        expect(scaleToWad(1_000_000n, 6)).toBe(WAD);
        expect(scaleToWad(100_000_000n, 8)).toBe(WAD);
        expect(scaleToWad(WAD, 18)).toBe(WAD);
        expect(scaleToWad(pow10(24), 24)).toBe(WAD);
    });

    it('priceFromReserves crosses decimals correctly (the 1e12 landmine)', () =>
    {
        // 1000 WBNB (18dp) against 850,000 mUSDT (6dp) -> 850 USD per WBNB.
        const price = priceFromReserves(1000n * WAD, 18, 850_000n * pow10(6), 6);
        expect(price).toBe(850n * WAD);
        // And inverted: 1/850 USD-per-mUSDT-in-WBNB terms.
        const inverse = priceFromReserves(850_000n * pow10(6), 6, 1000n * WAD, 18);
        expect(inverse).toBe(WAD * 1000n / 850_000n);
    });

    it('usdValue prices raw amounts of any decimals', () =>
    {
        const bnbPrice = 850n * WAD;
        expect(usdValue(2n * WAD, 18, bnbPrice)).toBe(1700n * WAD);
        // 0.5 mWBTC (8dp) at $60,000.
        expect(usdValue(50_000_000n, 8, 60_000n * WAD)).toBe(30_000n * WAD);
    });

    it('BPS constant is basis points', () =>
    {
        expect(BPS).toBe(10_000n);
    });
});
