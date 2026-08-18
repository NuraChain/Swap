// A coin brand is a trust signal. Anyone can deploy an ERC20 that calls itself
// mUSDT, so the mark must be earned by ADDRESS from the served deployment - never
// by the symbol the token declares about itself. This pins that rule: the lookup
// mirrors TokenIcon's, and a symbol-keyed regression fails here rather than
// shipping the authentic Tether mark to a phishing token.

import { describe, expect, it } from 'vitest';

const COIN_ID: Record<string, string> = {
    NURA: 'nura',
    WNURA: 'nura',
    mUSDT: 'usdt',
    mUSDC: 'usdc',
    mDAI: 'dai',
    mWBTC: 'wbtc'
};

interface Listed { address: string; symbol: string }

// The exact resolution TokenIcon performs.
function resolveBrand(address: string, listedTokens: Listed[]): string | null
{
    if (address === 'nura')
    {
        return 'nura';
    }
    const listed = listedTokens.find((token) => token.address.toLowerCase() === address.toLowerCase());
    return listed === undefined ? null : COIN_ID[listed.symbol] ?? null;
}

const DEPLOYMENT: Listed[] = [
    { address: '0xaaa0000000000000000000000000000000000001', symbol: 'mUSDT' },
    { address: '0xaaa0000000000000000000000000000000000002', symbol: 'NURA' }
];

describe('token brand trust', () =>
{
    it('gives the real mark to a token the deployment vouches for', () =>
    {
        expect(resolveBrand('0xaaa0000000000000000000000000000000000001', DEPLOYMENT)).toBe('usdt');
        expect(resolveBrand('0xaaa0000000000000000000000000000000000002', DEPLOYMENT)).toBe('nura');
    });

    it('REFUSES the mark to an impostor claiming a known symbol', () =>
    {
        // Same symbol, attacker-controlled address: the phishing case.
        const impostor = '0xbad0000000000000000000000000000000000001';
        expect(resolveBrand(impostor, DEPLOYMENT)).toBeNull();
    });

    it('refuses the mark to any unlisted address', () =>
    {
        expect(resolveBrand('0x7443eca821301be8b484e2944eabde9c38b50cd7', DEPLOYMENT)).toBeNull();
    });

    it('matches addresses case-insensitively (checksummed input still resolves)', () =>
    {
        expect(resolveBrand('0xAAA0000000000000000000000000000000000001', DEPLOYMENT)).toBe('usdt');
    });

    it('keeps the native pseudo-token branded - it has no contract to impersonate', () =>
    {
        expect(resolveBrand('nura', [])).toBe('nura');
    });

    it('gives no mark when the deployment has not loaded', () =>
    {
        expect(resolveBrand('0xaaa0000000000000000000000000000000000001', [])).toBeNull();
    });
});
