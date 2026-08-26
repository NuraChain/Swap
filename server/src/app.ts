// The market API over the indexer's storage: pool list, pool detail with candles,
// chain stats, token registry, recent transactions, and the active deployment.
// Handlers read sqlite synchronously per request - the dataset is a DEX's hot
// state, not a warehouse - and every response is schema-validated at the boundary.

import { App, NotFoundError, json, type ErrorObserver, type RequestObserver } from '@azerothjs/http';
import { feature, manifestOf, register } from '@azerothjs/http/api';
import { mountPages, type KitOptions } from '@azerothjs/kit';
import { array, boolean, object, string } from '@azerothjs/schema';
import type { Deployment } from '@nuraswap/shared/deployments';

import { HOUR, fillCandles, hourStartOf } from './indexer/apply.ts';
import {
    anchorsOnly,
    buildPriceMap,
    feeAprBps,
    poolTvlUsd,
    toUsdNumber,
    toUsdPrice,
    volumeUsd
} from './indexer/pricing.ts';
import { deploymentInfo, pool, poolDetail, stats, tokenWithPrice, txItem } from './schemas.ts';
import type { EventRow, IndexerDb, V3PoolRow } from './indexer/db.ts';
import type { Pool, TokenRef, TxItem } from './schemas.ts';

export interface IndexerStatus
{
    headBlock: number;
    indexedBlock: number;
}

export interface ApiState
{
    db: IndexerDb;
    deployment: Deployment;
    /**
     * SYMBOL -> USD price in 1e18, from outside the chain. Bridged assets are
     * worth what they bridge, which no pool here knows; without this a chain
     * whose stable has no liquidity prices nothing at all.
     */
    externalPrices: () => ReadonlyMap<string, bigint>;
    status: () => IndexerStatus;
}

const UNKNOWN_TOKEN: Omit<TokenRef, 'address'> = { symbol: '???', name: 'Unknown token', decimals: 18 };

// The return type is INFERRED on purpose and cannot be annotated: `Api` below is
// `ReturnType<typeof createApi>`, and the browser's typed client is derived from
// it, so writing the type here would be circular - and writing it by hand would
// let the client's surface drift from the routes actually registered.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createApi(state: ApiState)
{
    const { db, deployment } = state;
    const refs = {
        stable: deployment.tokens.find((token) => token.symbol === 'USDT')?.address.toLowerCase() ?? '',
        wrappedNative: deployment.contracts.wnura.toLowerCase()
    };

    function tokenRefOf(address: string): TokenRef
    {
        const row = db.getToken(address);
        return row ?? { address: address.toLowerCase(), ...UNKNOWN_TOKEN };
    }

    function decimalsOf(address: string): number
    {
        return db.getToken(address)?.decimals ?? 18;
    }

    // The feed knows symbols; the price map is keyed by address. The token
    // registry is the only thing that can join them, and it is read per request
    // rather than cached at boot so a token the indexer discovers later is
    // priced the moment it appears.
    function externalSeeds(): Map<string, bigint>
    {
        const feed = state.externalPrices();
        const seeds = new Map<string, bigint>();
        for (const token of feed.size === 0 ? [] : db.listTokens())
        {
            const price = feed.get(token.symbol.toUpperCase());
            if (price !== undefined)
            {
                seeds.set(token.address.toLowerCase(), price);
            }
        }
        return seeds;
    }

    // Two maps, deliberately. EVERY price is what the app quotes with - swap
    // rates, a position's worth, the token registry - because a pool-derived
    // price is the best answer available for those. ANCHORED prices are the
    // subset that came from outside the exchange, and they are what money
    // figures are summed over: a pool cannot be counted as valuable on the
    // strength of a rate it set itself.
    function priceView(): { prices: ReturnType<typeof buildPriceMap>; anchored: ReturnType<typeof buildPriceMap> }
    {
        const seeds = externalSeeds();
        const prices = buildPriceMap(db.listV3Pools(), db.listTokens(), refs, seeds);
        return { prices, anchored: anchorsOnly(prices, refs, seeds) };
    }

    // A concentrated pool has no reserves, so the token BALANCES the indexer
    // refreshes stand in as its holdings - the same figure the stats headline
    // already counts it by - and the price comes off the last candle, which is
    // the pool's own post-trade sqrtPriceX96 rather than a ratio of those
    // balances. The fee APR uses the pool's own tier fee: ppm on chain, bps here.
    function poolWire(
        pool: V3PoolRow,
        prices: ReturnType<typeof buildPriceMap>,
        anchored: ReturnType<typeof buildPriceMap>
    ): Pool
    {
        const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
        const dayVolume = db.volumeSince(pool.address, hourNow - 23 * HOUR);
        const volume24hUsd = volumeUsd(dayVolume.volume0, dayVolume.volume1, pool, anchored, decimalsOf);
        const tvlUsd = poolTvlUsd(pool, pool.balance0, pool.balance1, anchored, decimalsOf);
        return {
            address: pool.address,
            token0: tokenRefOf(pool.token0),
            token1: tokenRefOf(pool.token1),
            reserve0: pool.balance0.toString(),
            reserve1: pool.balance1.toString(),
            priceWad: (db.latestClose(pool.address) ?? 0n).toString(),
            tvlUsd: toUsdNumber(tvlUsd),
            volume24hUsd: toUsdNumber(volume24hUsd),
            feeAprBps: feeAprBps(volume24hUsd, tvlUsd, pool.fee / 100)
        };
    }

    // A transaction row only ever wants the two tokens traded, which the pool
    // table answers for any event it stored.
    function poolTokensOf(event: EventRow): { token0: string; token1: string }
    {
        const pool = db.getV3Pool(event.pair);
        return { token0: pool?.token0 ?? event.pair, token1: pool?.token1 ?? event.pair };
    }

    function txWire(event: EventRow): TxItem
    {
        const tokens = poolTokensOf(event);
        const token0 = tokenRefOf(tokens.token0);
        const token1 = tokenRefOf(tokens.token1);
        const base = {
            txHash: event.txHash,
            kind: event.kind,
            timestamp: event.timestamp,
            account: event.account,
            pairAddress: event.pair
        };
        if (event.kind === 'swap')
        {
            const zeroForOne = event.amount0In > 0n;
            return {
                ...base,
                tokenA: zeroForOne ? token0 : token1,
                amountA: (zeroForOne ? event.amount0In : event.amount1In).toString(),
                tokenB: zeroForOne ? token1 : token0,
                amountB: (zeroForOne ? event.amount1Out : event.amount0Out).toString()
            };
        }
        return {
            ...base,
            tokenA: token0,
            amountA: event.amount0In.toString(),
            tokenB: token1,
            amountB: event.amount1In.toString()
        };
    }

    return {
        market: feature('/market', (routes) => ({
            stats: routes.get('/stats', { output: stats }, () =>
            {
                const pools = db.listV3Pools();
                const { anchored } = priceView();
                const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
                const dayStart = hourNow - 23 * HOUR;
                let tvlUsd = 0n;
                let volume24hUsd = 0n;
                // One market, one set of totals. A pool's worth is what it HOLDS,
                // read onto the row by the indexer, and its volume is summed off
                // the hourly candles every swap feeds.
                for (const pool of pools)
                {
                    tvlUsd += poolTvlUsd(pool, pool.balance0, pool.balance1, anchored, decimalsOf);
                    const dayVolume = db.volumeSince(pool.address, dayStart);
                    volume24hUsd += volumeUsd(dayVolume.volume0, dayVolume.volume1, pool, anchored, decimalsOf);
                }
                const status = state.status();
                return {
                    chainId: deployment.chainId,
                    poolCount: pools.length,
                    tvlUsd: toUsdNumber(tvlUsd),
                    volume24hUsd: toUsdNumber(volume24hUsd),
                    indexedBlock: status.indexedBlock,
                    blocksBehind: Math.max(0, status.headBlock - status.indexedBlock)
                };
            }),
            pools: routes.get('/pools', { output: array(pool) }, () =>
            {
                const pools = db.listV3Pools();
                const { prices, anchored } = priceView();
                return pools.map((entry) => poolWire(entry, prices, anchored));
            }),
            pool: routes.get('/pools/:address', { output: poolDetail }, (context) =>
            {
                const v3Pool = db.getV3Pool(context.params.address);
                if (v3Pool === null)
                {
                    throw new NotFoundError('unknown pool');
                }
                const { prices, anchored } = priceView();
                const wire = poolWire(v3Pool, prices, anchored);
                const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
                const raw = db.candles(wire.address, hourNow - 72 * HOUR);
                // Chain time can run AHEAD of wall time (local chains walk their
                // clock forward); fill to whichever is later or the fill is empty.
                const toHour = Math.max(hourNow, raw.at(-1)?.hourStart ?? hourNow);
                return {
                    ...wire,
                    candles: fillCandles(raw, toHour).map((point) => ({
                        hourStart: point.hourStart,
                        open: point.open.toString(),
                        high: point.high.toString(),
                        low: point.low.toString(),
                        close: point.close.toString(),
                        volume0: point.volume0.toString(),
                        volume1: point.volume1.toString()
                    }))
                };
            }),
            // Whether the pool has traded recently - one boolean instead of the
            // whole candle detail, so a chart can skip a pool that would draw an
            // all-flat line. A deposit is deliberately not a trade.
            traded: routes.get('/pools/:address/traded', { output: object({ traded: boolean() }) }, (context) =>
            {
                const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
                const traded = db.candles(context.params.address, hourNow - 72 * HOUR)
                    .some((point) => point.volume0 > 0n || point.volume1 > 0n);
                return { traded };
            }),
            tokens: routes.get('/tokens', { output: array(tokenWithPrice) }, () =>
            {
                const { prices, anchored } = priceView();
                return db.listTokens().map((token) => ({
                    ...token,
                    priceUsd: toUsdPrice(prices.get(token.address) ?? 0n),
                    anchored: anchored.has(token.address)
                }));
            }),
            txs: routes.get(
                '/txs',
                { query: object({ account: string().optional() }), output: array(txItem) },
                (context) => db.recentEvents(30, { account: context.query.account }).map(txWire)
            ),
            deployment: routes.get('/deployment', { output: deploymentInfo }, () => ({
                chainId: deployment.chainId,
                networkName: deployment.networkName,
                rpcUrl: deployment.rpcUrl,
                explorerUrl: deployment.explorerUrl,
                faucet: deployment.faucet,
                contracts: deployment.contracts,
                v3: deployment.v3,
                tokens: deployment.tokens.map((token) => ({ ...token, address: token.address.toLowerCase() }))
            }))
        }))
    };
}

export type Api = ReturnType<typeof createApi>;

export interface AppOptions
{
    dev: boolean;
    api: Api;
    observe?: RequestObserver;
    onError?: ErrorObserver;

    /** The built client + SSR renderer (production); omit in dev - vite serves the client. */
    pages?: KitOptions;
}

// The api is created FIRST (createApi) and passed in: production wiring needs
// manifestOf(api) inside the pages option, which cannot reference a value being
// destructured out of this very call.
export function buildApp(options: AppOptions): App
{
    const app = new App({ dev: options.dev, observe: options.observe, onError: options.onError });

    app.get('/api/healthz', () => json({ ok: true, at: new Date().toISOString() }));

    register(app, options.api);

    // The typed client's runtime half, projected from the SAME declaration
    // register just installed. The browser fetches it once at boot.
    app.get('/api/_manifest', () => json(manifestOf(options.api)));

    // Mounted LAST so nothing shadows /api.
    if (options.pages !== undefined)
    {
        mountPages(app, options.pages);
    }

    return app;
}
