// Numeric input handling for a bilingual UI. Persian keyboards emit U+06F0-06F9,
// some Arabic layouts emit U+0660-0669 with U+066B/U+066C separators - all of it
// must become plain ASCII before any on-chain amount is parsed.

const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

export function normalizeDigits(input: string): string
{
    let output = '';
    for (const char of input)
    {
        const code = char.codePointAt(0) as number;
        if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9)
        {
            output += String.fromCharCode(48 + code - PERSIAN_ZERO);
        }
        else if (code >= ARABIC_ZERO && code <= ARABIC_ZERO + 9)
        {
            output += String.fromCharCode(48 + code - ARABIC_ZERO);
        }
        else if (code === 0x066b)
        {
            output += '.';
        }
        else if (code === 0x066c || code === 0x2c || code === 0x200c || code === 0x20)
        {
            // thousands separators (Arabic, ASCII comma), ZWNJ, spaces: dropped
        }
        else
        {
            output += char;
        }
    }
    return output;
}

// Parses a human amount into raw token units. Fraction digits beyond the token's
// decimals are clamped, not rejected (parseUnits-style throwing turns a 7th
// decimal keystroke on a 6-decimal token into a broken input field).
// Returns null for anything that is not a plain non-negative decimal number.
export function parseTokenAmount(input: string, decimals: number): bigint | null
{
    const normalized = normalizeDigits(input).trim();
    if (!/^\d*\.?\d*$/.test(normalized) || normalized === '' || normalized === '.')
    {
        return null;
    }
    const [wholePart, fractionPart = ''] = normalized.split('.');
    const whole = wholePart === '' ? '0' : wholePart;
    const fraction = fractionPart.slice(0, decimals).padEnd(decimals, '0');
    return BigInt(whole) * 10n ** BigInt(decimals) + (fraction === '' ? 0n : BigInt(fraction));
}

// Formats raw token units as a plain ASCII decimal string. Display-layer locale
// formatting (Persian digits, grouping) happens in the UI, never here.
export function formatTokenAmount(amount: bigint, decimals: number, maxFractionDigits = decimals): string
{
    const negative = amount < 0n;
    const absolute = negative ? -amount : amount;
    const base = 10n ** BigInt(decimals);
    const whole = absolute / base;
    let fraction = (absolute % base).toString().padStart(decimals, '0').slice(0, maxFractionDigits);
    fraction = fraction.replace(/0+$/, '');
    const text = fraction === '' ? whole.toString() : `${ whole }.${ fraction }`;
    return negative ? `-${ text }` : text;
}
