// The one place this server reaches outside its own chain.
//
// A BRIDGED asset is worth what the asset it bridges is worth, and nothing on
// this chain knows that number. Bridge BNB has no pool against the stable here,
// so the reserve-derived price map has nothing to anchor it on: BNB reads $0,
// WNURA prices through BNB and reads $0 too, and every USD figure on the site
// collapses to zero. One real price outside the chain unlocks the whole graph.
//
// Two sources tried in order, because this is the only external dependency in
// the process and a single unreachable host would take every dollar figure back
// to zero. Whatever last answered stays cached: a price from four minutes ago is
// a far better answer than $0, and the alternative to a stale number here is not
// a fresh one, it is nothing.

import type { Logger } from '@azerothjs/logger';

import { WAD } from '@nuraswap/shared/math';

const BINANCE = 'https://api.binance.com/api/v3/ticker/price';
const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price';

const TIMEOUT_MS = 5000;
// A number outside this range is a parse error wearing a price's clothes. A
// decimal point read in the wrong place moves every TVL on the site by orders of
// magnitude, and it would look plausible on the way past.
const MIN_USD = 0.000001;
const MAX_USD = 10_000_000;

export interface FeedToken
{
    /** Matched against the token registry's SYMBOL, case-insensitively. */
    symbol: string;
    /** Binance spot pair, e.g. BNBUSDT. */
    binance: string;
    /** CoinGecko coin id, e.g. binancecoin. */
    coingecko: string;
}

// Add a row to price another bridged asset; nothing else has to change.
export const FEED_TOKENS: readonly FeedToken[] = [
    { symbol: 'BNB', binance: 'BNBUSDT', coingecko: 'binancecoin' }
];

/** USD as a float -> 1e18 fixed point, or null if the number is not a price. */
export function toPriceWad(usd: number | null): bigint | null
{
    if (usd === null || !Number.isFinite(usd) || usd < MIN_USD || usd > MAX_USD)
    {
        return null;
    }
    // Through six fixed decimals rather than `usd * 1e18`: the direct multiply is
    // a float operation whose error lands in the low digits of the bigint, where
    // it is invisible and permanent.
    return BigInt(Math.round(usd * 1_000_000)) * (WAD / 1_000_000n);
}

export function parseBinance(body: unknown): number | null
{
    const price = (body as { price?: unknown } | null)?.price;
    return typeof price === 'string' ? Number(price) : null;
}

export function parseCoinGecko(body: unknown, id: string): number | null
{
    const usd = (body as Record<string, { usd?: unknown } | undefined> | null)?.[id]?.usd;
    return typeof usd === 'number' ? usd : null;
}

async function readJson(url: string): Promise<unknown>
{
    const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' }
    });
    if (!response.ok)
    {
        throw new Error(`${ response.status } ${ response.statusText }`);
    }
    return await response.json();
}

/** The primary, then the fallback. Null when neither could answer with a price. */
export async function fetchTokenPrice(token: FeedToken, log: Logger): Promise<bigint | null>
{
    const attempts: Array<readonly [string, () => Promise<number | null>]> = [
        ['binance', async () => parseBinance(await readJson(`${ BINANCE }?symbol=${ token.binance }`))],
        [
            'coingecko',
            async () => parseCoinGecko(
                await readJson(`${ COINGECKO }?ids=${ token.coingecko }&vs_currencies=usd`),
                token.coingecko
            )
        ]
    ];

    for (const [source, read] of attempts)
    {
        try
        {
            const price = toPriceWad(await read());
            if (price !== null)
            {
                return price;
            }
            log.warn('price source answered without a usable price', { source, symbol: token.symbol });
        }
        catch (error)
        {
            log.warn('price source unreachable', {
                source,
                symbol: token.symbol,
                error: String(error).split('\n')[0]
            });
        }
    }
    return null;
}

export interface PriceFeed
{
    /** SYMBOL (upper case) -> USD price, 1e18 fixed point. Empty until a read lands. */
    prices: () => ReadonlyMap<string, bigint>;
    stop: () => void;
}

export function startPriceFeed(options: {
    log: Logger;
    refreshMs: number;
    tokens?: readonly FeedToken[];
}): PriceFeed
{
    const tokens = options.tokens ?? FEED_TOKENS;
    const prices = new Map<string, bigint>();
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;

    async function refresh(): Promise<void>
    {
        for (const token of tokens)
        {
            const price = await fetchTokenPrice(token, options.log);
            const key = token.symbol.toUpperCase();
            if (price === null)
            {
                // Every source is down. The cached price stands; replacing it
                // with nothing would be choosing $0 over a slightly old number.
                if (!prices.has(key))
                {
                    options.log.warn('no price yet for a bridged token - its USD figures read zero', { symbol: key });
                }
                continue;
            }
            if (!prices.has(key))
            {
                options.log.info('external price feed live', { symbol: key, usd: Number(price / (WAD / 1_000_000n)) / 1e6 });
            }
            prices.set(key, price);
        }
    }

    async function loop(): Promise<void>
    {
        while (!stopped)
        {
            await refresh();
            if (!stopped)
            {
                await new Promise<void>((resolve) =>
                {
                    timer = setTimeout(resolve, options.refreshMs);
                });
            }
        }
    }

    void loop().catch((error: unknown) =>
    {
        options.log.error('price feed loop died - USD figures will hold their last values', { error });
    });

    return {
        prices: () => prices,
        stop: () =>
        {
            stopped = true;
            if (timer !== null)
            {
                clearTimeout(timer);
            }
        }
    };
}
