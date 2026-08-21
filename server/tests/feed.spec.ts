// The external price feed: the only outbound HTTP this server makes, and the
// anchor every USD figure on a chain with no stable liquidity hangs off. What
// matters here is not the happy path but the three failure shapes - a source
// down, a source answering nonsense, and both down at once - because each of
// them, mishandled, silently prints $0 across the whole site.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WAD } from '@nuraswap/shared/math';

import { fetchTokenPrice, parseBinance, parseCoinGecko, startPriceFeed, toPriceWad } from '../src/feed.ts';
import type { FeedToken } from '../src/feed.ts';

const BNB: FeedToken = { symbol: 'BNB', binance: 'BNBUSDT', coingecko: 'binancecoin' };

const lines: Array<{ level: string; message: string }> = [];
const log = {
    info: (message: string) => lines.push({ level: 'info', message }),
    warn: (message: string) => lines.push({ level: 'warn', message }),
    error: (message: string) => lines.push({ level: 'error', message }),
    debug: () => undefined
} as never;

/** Answers each URL by the first pattern that matches it; anything else 500s. */
function stubFetch(routes: Array<[RegExp, () => Promise<Response> | Response]>): void
{
    vi.stubGlobal('fetch', async (input: string | URL): Promise<Response> =>
    {
        const url = String(input);
        for (const [pattern, answer] of routes)
        {
            if (pattern.test(url))
            {
                return await answer();
            }
        }
        return new Response('nope', { status: 500 });
    });
}

const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() =>
{
    vi.unstubAllGlobals();
    lines.length = 0;
});

describe('toPriceWad', () =>
{
    it('converts a plain USD number to 1e18 fixed point', () =>
    {
        expect(toPriceWad(1)).toBe(WAD);
        expect(toPriceWad(860.5)).toBe(8605n * WAD / 10n);
    });

    it('refuses numbers that are not prices', () =>
    {
        // A parse miss reads as a number and would be indistinguishable downstream
        // from a real quote - every one of these has to die at the boundary.
        expect(toPriceWad(0)).toBeNull();
        expect(toPriceWad(-5)).toBeNull();
        expect(toPriceWad(Number.NaN)).toBeNull();
        expect(toPriceWad(Number.POSITIVE_INFINITY)).toBeNull();
        expect(toPriceWad(50_000_000)).toBeNull();
        expect(toPriceWad(null)).toBeNull();
    });
});

describe('source parsers', () =>
{
    it('reads Binance\'s string price and CoinGecko\'s nested number', () =>
    {
        expect(parseBinance({ price: '860.50000000' })).toBe(860.5);
        expect(parseCoinGecko({ binancecoin: { usd: 860.5 } }, 'binancecoin')).toBe(860.5);
    });

    it('returns null rather than coercing a shape it did not expect', () =>
    {
        expect(parseBinance({})).toBeNull();
        expect(parseBinance({ code: -1121, msg: 'Invalid symbol.' })).toBeNull();
        expect(parseBinance(null)).toBeNull();
        expect(parseCoinGecko({}, 'binancecoin')).toBeNull();
        expect(parseCoinGecko({ binancecoin: {} }, 'binancecoin')).toBeNull();
        // A string here would sail through a Number() and land as a real price.
        expect(parseCoinGecko({ binancecoin: { usd: '860.5' } }, 'binancecoin')).toBeNull();
    });
});

describe('fetchTokenPrice', () =>
{
    it('takes the primary when it answers', async () =>
    {
        stubFetch([[/api\.binance\.com/, () => json({ symbol: 'BNBUSDT', price: '860.50000000' })]]);
        expect(await fetchTokenPrice(BNB, log)).toBe(8605n * WAD / 10n);
    });

    it('falls back to the second source when the first is unreachable', async () =>
    {
        stubFetch([
            [/api\.binance\.com/, () => Promise.reject(new Error('ENOTFOUND'))],
            [/api\.coingecko\.com/, () => json({ binancecoin: { usd: 900 } })]
        ]);
        expect(await fetchTokenPrice(BNB, log)).toBe(900n * WAD);
        expect(lines.some((line) => line.message.includes('unreachable'))).toBe(true);
    });

    it('falls back when the first answers 200 with something that is not a price', async () =>
    {
        // Binance answers HTTP 200 with an error body for a bad symbol - a source
        // that is UP and useless is the case a status check alone would miss.
        stubFetch([
            [/api\.binance\.com/, () => json({ code: -1121, msg: 'Invalid symbol.' })],
            [/api\.coingecko\.com/, () => json({ binancecoin: { usd: 900 } })]
        ]);
        expect(await fetchTokenPrice(BNB, log)).toBe(900n * WAD);
    });

    it('falls back on a non-2xx as well', async () =>
    {
        stubFetch([
            [/api\.binance\.com/, () => new Response('rate limited', { status: 429 })],
            [/api\.coingecko\.com/, () => json({ binancecoin: { usd: 900 } })]
        ]);
        expect(await fetchTokenPrice(BNB, log)).toBe(900n * WAD);
    });

    it('answers null when both sources are down, rather than guessing', async () =>
    {
        stubFetch([[/./, () => Promise.reject(new Error('offline'))]]);
        expect(await fetchTokenPrice(BNB, log)).toBeNull();
    });
});

describe('startPriceFeed', () =>
{
    it('publishes a price under the upper-cased symbol', async () =>
    {
        stubFetch([[/api\.binance\.com/, () => json({ price: '860.5' })]]);
        const feed = startPriceFeed({ log, refreshMs: 60_000, tokens: [BNB] });
        await vi.waitFor(() => expect(feed.prices().size).toBe(1));
        expect(feed.prices().get('BNB')).toBe(8605n * WAD / 10n);
        feed.stop();
    });

    it('keeps the last good price when every source goes down', async () =>
    {
        stubFetch([[/api\.binance\.com/, () => json({ price: '860.5' })]]);
        const feed = startPriceFeed({ log, refreshMs: 10, tokens: [BNB] });
        await vi.waitFor(() => expect(feed.prices().get('BNB')).toBe(8605n * WAD / 10n));

        // The alternative to a slightly stale price is not a fresh one - it is
        // $0 on every figure that depends on it.
        stubFetch([[/./, () => Promise.reject(new Error('offline'))]]);
        await vi.waitFor(() => expect(lines.some((line) => line.message.includes('unreachable'))).toBe(true));
        expect(feed.prices().get('BNB')).toBe(8605n * WAD / 10n);
        feed.stop();
    });

    it('reports nothing at all until a first read lands', async () =>
    {
        stubFetch([[/./, () => Promise.reject(new Error('offline'))]]);
        const feed = startPriceFeed({ log, refreshMs: 10, tokens: [BNB] });
        await vi.waitFor(() => expect(lines.some((line) => line.message.includes('no price yet'))).toBe(true));
        // An empty map, not a zero: the price map seeds nothing and the existing
        // "unpriced tokens are skipped" behaviour takes over untouched.
        expect(feed.prices().size).toBe(0);
        feed.stop();
    });
});
