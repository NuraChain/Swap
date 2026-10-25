// Display formatting over raw on-chain values. Everything here returns strings
// for the UI; parsing user input lives in @nuraswap/shared/digits.

import { formatTokenAmount } from '@nuraswap/shared/digits';
import { MAX_TICK, nearestUsableTick, tickSpacingForFee, tickToPriceWad } from '@nuraswap/shared/v3-math';

import { fmtNumber, langInfo, markUsd } from './i18n.ts';

export function shortAddress(address: string): string
{
    return `${ address.slice(0, 6) }…${ address.slice(-4) }`;
}

/** Two hues from the address bytes - the deterministic identicon gradient. */
export function addressGradient(address: string): string
{
    let first = 0;
    let second = 0;
    for (let index = 2; index < address.length; index++)
    {
        const code = address.charCodeAt(index);
        if (index % 2 === 0)
        {
            first = (first + code * 7) % 360;
        }
        else
        {
            second = (second + code * 13) % 360;
        }
    }
    return `linear-gradient(135deg, hsl(${ first } 70% 55%), hsl(${ second } 70% 40%))`;
}

// Raw units -> localized amount. Precision scales down as magnitude grows.
export function fmtAmount(raw: bigint, decimals: number): string
{
    const plain = formatTokenAmount(raw, decimals);
    const value = Number(plain);
    if (!Number.isFinite(value))
    {
        return plain;
    }
    const fraction = value >= 10_000 ? 0 : value >= 1 ? 4 : 6;
    return fmtNumber(value, fraction);
}

// The same amount in a slot that cannot grow: the header balance. fmtAmount
// drops the fraction above ten thousand but keeps every grouped digit, so a large
// NURA balance pushed the connect button, and the header with it, off the page.
// Here a thousand and up goes compact in the reader's locale (1.23M, ۱٫۲ میلیون);
// the exact figure stays in the wallet menu.
export function fmtAmountCompact(raw: bigint, decimals: number): string
{
    const plain = formatTokenAmount(raw, decimals);
    const value = Number(plain);
    if (!Number.isFinite(value))
    {
        return plain;
    }
    if (Math.abs(value) < 1000)
    {
        return fmtNumber(value, Math.abs(value) >= 1 ? 2 : 4);
    }
    return new Intl.NumberFormat(langInfo().locale, {
        notation: 'compact',
        maximumFractionDigits: 2
    }).format(value);
}

// One bound of a V3 range, as a price. A full-range position sits on the tick
// limits, and the upper limit prices out around 3.4e38 - fifty-one grouped
// digits that walk straight out of whatever card they are printed in. The add
// form already writes that bound as the infinity sign; the position views read
// back the same character. The LOWER limit needs no such guard: its price
// rounds to zero in wad on its own, and formats as the locale's zero digit.
export function fmtTickPrice(tick: number, decimals0: number, decimals1: number, fee: number): string
{
    return tick >= nearestUsableTick(MAX_TICK, tickSpacingForFee(fee))
        ? '∞'
        : fmtAmount(tickToPriceWad(tick, decimals0, decimals1), 18);
}

// A token PRICE, at a precision that suits its magnitude. A fixed four decimals
// prints a token worth $0.00026 as '$0.0003' - a 15% error, where the only digits
// carrying information are the ones being rounded away. Amounts already scale
// this way in fmtAmount; prices had been left at a constant.
export function fmtUsdPrice(price: number): string
{
    const fraction = price >= 1 ? 4 : price >= 0.01 ? 6 : 8;
    return fmtNumber(price, fraction);
}

// The same price wearing its currency mark, for anywhere it stands ALONE - a
// header ticker, a tooltip - rather than under a column header that already says
// USD. fmtUsd is the obvious call here and the wrong one: its two-decimal money
// rule prints a sub-cent token as $0.00, which is the exact rounding fmtUsdPrice
// exists to avoid.
export function fmtUsdPriceLabel(price: number): string
{
    return markUsd(fmtUsdPrice(price));
}

// A pool price, which can sit many places past the point: a pair of 18-decimal
// tokens worth a billion to one prices at 0.000000002, and every fixed-fraction
// rule above prints that as 0. Below one it keeps four significant digits.
export function fmtPrice(value: number): string
{
    if (value >= 1 || value === 0)
    {
        return fmtNumber(value, value >= 10_000 ? 2 : 6);
    }
    return new Intl.NumberFormat(langInfo().locale, { maximumSignificantDigits: 4 }).format(value);
}

export function fmtPercentBps(bps: number): string
{
    const text = fmtNumber(bps / 100, 2);
    return `${ text }${ langInfo().percent }`;
}

export function fmtTime(timestamp: number): string
{
    return new Intl.DateTimeFormat(langInfo().locale, {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric'
    }).format(timestamp * 1000);
}
