// Display formatting over raw on-chain values. Everything here returns strings
// for the UI; parsing user input lives in @nuraswap/shared/digits.

import { formatTokenAmount } from '@nuraswap/shared/digits';
import { MAX_TICK, nearestUsableTick, tickSpacingForFee, tickToPriceWad } from '@nuraswap/shared/v3-math';

import { fmtNumber, langInfo } from './i18n.ts';

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
