// Display formatting over raw on-chain values. Nothing here moves money, but
// everything here is what someone reads BEFORE they move money: a balance shown
// with too few digits reads as zero, and an address abbreviated wrongly is the
// one check a user has against sending to the wrong contract.

import { afterEach, describe, expect, it } from 'vitest';

import { addressGradient, fmtAmount, fmtPercentBps, fmtTime, fmtUsdPrice, shortAddress } from '../src/lib/format.ts';
import { setLang } from '../src/lib/i18n.ts';

const WAD = 10n ** 18n;

afterEach(() =>
{
    setLang('en');
});

describe('shortAddress', () =>
{
    it('keeps the first six and last four characters', () =>
    {
        expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
    });

    // The abbreviation is a verification aid: two addresses that differ only in
    // the middle must still LOOK different, which is why both ends are kept.
    it('distinguishes addresses that share a prefix', () =>
    {
        const first = shortAddress('0xabcdef0000000000000000000000000000001111');
        const second = shortAddress('0xabcdef0000000000000000000000000000002222');
        expect(first).not.toBe(second);
    });

    it('does not throw on a short or empty input', () =>
    {
        expect(() => shortAddress('')).not.toThrow();
        expect(() => shortAddress('0x')).not.toThrow();
    });
});

describe('addressGradient', () =>
{
    it('is deterministic for one address', () =>
    {
        const address = '0x1234567890abcdef1234567890abcdef12345678';
        expect(addressGradient(address)).toBe(addressGradient(address));
    });

    it('gives different addresses different gradients', () =>
    {
        expect(addressGradient('0x' + '1'.repeat(40))).not.toBe(addressGradient('0x' + '2'.repeat(40)));
    });

    it('emits CSS with hues inside the colour wheel', () =>
    {
        const gradient = addressGradient('0xdeadbeef00000000000000000000000000000001');
        expect(gradient).toMatch(/^linear-gradient\(135deg, hsl\(\d+ 70% 55%\), hsl\(\d+ 70% 40%\)\)$/);
        for (const hue of [...gradient.matchAll(/hsl\((\d+)/g)].map((match) => Number(match[1])))
        {
            expect(hue).toBeGreaterThanOrEqual(0);
            expect(hue).toBeLessThan(360);
        }
    });
});

describe('fmtUsdPrice', () =>
{
    it('scales its precision to the size of the price', () =>
    {
        // A native token quoted against a bridged asset lands here, and four fixed
        // decimals printed $0.00026146 as $0.0003 - off by 15%, with every digit
        // that carried information rounded away.
        expect(fmtUsdPrice(0.00026146)).toBe('0.00026146');
        expect(fmtUsdPrice(0.0525)).toBe('0.0525');
        expect(fmtUsdPrice(653.67)).toBe('653.67');
        expect(fmtUsdPrice(1)).toBe('1');
    });

    it('still rounds, just not before the digits run out', () =>
    {
        expect(fmtUsdPrice(0.000000004)).toBe('0');
        expect(fmtUsdPrice(1234.56789)).toBe('1,234.5679');
    });
});

describe('fmtAmount', () =>
{
    it('shows more decimals the smaller the number gets', () =>
    {
        setLang('en');
        // Below one, six fraction digits: dust is still a balance.
        expect(fmtAmount(1234n, 18)).toBe('0');
        expect(fmtAmount(WAD / 1000n, 18)).toBe('0.001');
        // Between one and ten thousand, four.
        expect(fmtAmount(WAD * 5n, 18)).toBe('5');
        expect(fmtAmount(WAD * 5n + WAD / 4n, 18)).toBe('5.25');
        // Above ten thousand, none - the cents are noise at that size.
        expect(fmtAmount(WAD * 12_345n, 18)).toBe('12,345');
    });

    it("respects the token's own decimals", () =>
    {
        setLang('en');
        expect(fmtAmount(1_500_000n, 6)).toBe('1.5');
        expect(fmtAmount(150_000_000n, 8)).toBe('1.5');
        expect(fmtAmount(15n, 1)).toBe('1.5');
    });

    it('renders zero as zero, not as an empty string', () =>
    {
        setLang('en');
        expect(fmtAmount(0n, 18)).toBe('0');
        expect(fmtAmount(0n, 0)).toBe('0');
    });

    it('shows negatives with their sign', () =>
    {
        setLang('en');
        expect(fmtAmount(-WAD * 2n, 18)).toBe('-2');
    });

    // A balance too large for a float still has to render as something truthful
    // rather than as "Infinity" or "1e+30".
    it('falls back to the plain decimal when the value outruns a float', () =>
    {
        setLang('en');
        const huge = 10n ** 40n;
        const text = fmtAmount(huge, 0);
        expect(text).not.toContain('Infinity');
        expect(text).not.toContain('e+');
    });

    it("uses the reader's own numerals", () =>
    {
        setLang('fa');
        expect(fmtAmount(WAD * 5n, 18)).toMatch(/[۰-۹]/);
    });
});

describe('fmtPercentBps', () =>
{
    it('reads basis points as a percentage', () =>
    {
        setLang('en');
        expect(fmtPercentBps(0)).toBe('0%');
        expect(fmtPercentBps(25)).toBe('0.25%');
        expect(fmtPercentBps(100)).toBe('1%');
        expect(fmtPercentBps(10_000)).toBe('100%');
    });

    // V3 fee tiers are parts per million, so callers divide by 100 first and
    // fractional basis points arrive here. 100 ppm is 0.01%, not 0%.
    it('keeps a fractional basis point visible', () =>
    {
        setLang('en');
        expect(fmtPercentBps(1)).toBe('0.01%');
        expect(fmtPercentBps(500 / 100)).toBe('0.05%');
        expect(fmtPercentBps(3000 / 100)).toBe('0.3%');
        expect(fmtPercentBps(10_000 / 100)).toBe('1%');
    });

    it('uses the Persian percent sign in Persian', () =>
    {
        setLang('fa');
        expect(fmtPercentBps(100)).toContain('٪');
        expect(fmtPercentBps(100)).not.toContain('%');
    });
});

describe('fmtTime', () =>
{
    it('formats a unix timestamp without throwing', () =>
    {
        setLang('en');
        const text = fmtTime(1_700_000_000);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toContain('Invalid');
    });

    it('formats in every locale the picker offers', () =>
    {
        for (const lang of ['en', 'fa', 'ar', 'zh', 'ru'] as const)
        {
            setLang(lang);
            expect(fmtTime(1_700_000_000).length, lang).toBeGreaterThan(0);
        }
    });

    it('orders two timestamps differently', () =>
    {
        setLang('en');
        expect(fmtTime(1_700_000_000)).not.toBe(fmtTime(1_700_000_000 + 86_400));
    });
});
