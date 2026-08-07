import { describe, expect, it } from 'vitest';

import { formatTokenAmount, normalizeDigits, parseTokenAmount } from '../src/digits.ts';

describe('normalizeDigits', () =>
{
    it('converts Persian digits (U+06F0-06F9)', () =>
    {
        expect(normalizeDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
    });

    it('converts Arabic-Indic digits (U+0660-0669)', () =>
    {
        expect(normalizeDigits('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
    });

    it('maps the Arabic decimal separator and drops thousands separators', () =>
    {
        expect(normalizeDigits('۰٫۵')).toBe('0.5');
        expect(normalizeDigits('۱۲٬۳۴۵')).toBe('12345');
        expect(normalizeDigits('1,000,000')).toBe('1000000');
        expect(normalizeDigits('1 000')).toBe('1000');
    });

    it('passes ASCII decimals through untouched', () =>
    {
        expect(normalizeDigits('123.456')).toBe('123.456');
    });
});

describe('parseTokenAmount', () =>
{
    it('parses plain decimals into raw units', () =>
    {
        expect(parseTokenAmount('1.5', 6)).toBe(1_500_000n);
        expect(parseTokenAmount('0.000001', 6)).toBe(1n);
        expect(parseTokenAmount('250', 18)).toBe(250n * 10n ** 18n);
    });

    it('parses Persian input', () =>
    {
        expect(parseTokenAmount('۲۵۰', 6)).toBe(250_000_000n);
        expect(parseTokenAmount('۱٫۵', 6)).toBe(1_500_000n);
    });

    it('clamps excess fraction digits instead of throwing', () =>
    {
        expect(parseTokenAmount('1.2345678', 6)).toBe(1_234_567n);
    });

    it('accepts leading and trailing decimal points', () =>
    {
        expect(parseTokenAmount('.5', 6)).toBe(500_000n);
        expect(parseTokenAmount('5.', 6)).toBe(5_000_000n);
    });

    it('rejects garbage', () =>
    {
        expect(parseTokenAmount('', 6)).toBeNull();
        expect(parseTokenAmount('.', 6)).toBeNull();
        expect(parseTokenAmount('abc', 6)).toBeNull();
        expect(parseTokenAmount('1.2.3', 6)).toBeNull();
        expect(parseTokenAmount('-1', 6)).toBeNull();
        expect(parseTokenAmount('1e5', 6)).toBeNull();
    });
});

describe('formatTokenAmount', () =>
{
    it('renders raw units as ASCII decimals with trailing zeros stripped', () =>
    {
        expect(formatTokenAmount(1_500_000n, 6)).toBe('1.5');
        expect(formatTokenAmount(1_000_000n, 6)).toBe('1');
        expect(formatTokenAmount(0n, 6)).toBe('0');
        expect(formatTokenAmount(1n, 6)).toBe('0.000001');
    });

    it('truncates to maxFractionDigits', () =>
    {
        expect(formatTokenAmount(1_234_567n, 6, 2)).toBe('1.23');
    });

    it('handles negatives', () =>
    {
        expect(formatTokenAmount(-1_500_000n, 6)).toBe('-1.5');
    });

    it('round-trips with parseTokenAmount', () =>
    {
        const raw = 123_456_789_012_345_678n;
        expect(parseTokenAmount(formatTokenAmount(raw, 18), 18)).toBe(raw);
    });
});
