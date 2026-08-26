import { describe, expect, it } from 'vitest';

import {
    BPS,
    WAD,
    maxInForSlippage,
    minOutForSlippage,
    pow10,
    scaleToWad,
    sqrtBigint,
    usdValue
} from '../src/math.ts';

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

    it('usdValue prices raw amounts of any decimals', () =>
    {
        const nuraPrice = 850n * WAD;
        expect(usdValue(2n * WAD, 18, nuraPrice)).toBe(1700n * WAD);
        // 0.5 mWBTC (8dp) at $60,000.
        expect(usdValue(50_000_000n, 8, 60_000n * WAD)).toBe(30_000n * WAD);
    });

    it('BPS constant is basis points', () =>
    {
        expect(BPS).toBe(10_000n);
    });
});
