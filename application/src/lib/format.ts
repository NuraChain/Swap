// Display formatting over raw on-chain values. Everything here returns strings
// for the UI; parsing user input lives in @nuraswap/shared/digits.

import { formatTokenAmount } from '@nuraswap/shared/digits';

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
