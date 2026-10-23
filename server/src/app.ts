// The market API over the indexer's storage: pool list, pool detail with candles,
// chain stats, token registry, recent transactions, and the active deployment.
// Handlers read the database per request - the dataset is a DEX's hot state, not
// a warehouse - and every response is schema-validated at the boundary.

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
    volumeUsd,
    type PriceMap
} from './indexer/pricing.ts';
import { deploymentInfo, pool, poolDetail, stats, tokenWithPrice, txItem } from './schemas.ts';
import type { EventRow, IndexerDb, TokenRow, V3PoolRow } from './indexer/db.ts';
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

    // Everything one response reads about tokens and pools, loaded once per
    // request. The pricing helpers take synchronous lookups, and a query per
    // row costs a round trip each against a database server.
    interface View
    {
        tokens: TokenRow[];
        pools: V3PoolRow[];
        tokenBy: Map<string, TokenRow>;
        poolBy: Map<string, V3PoolRow>;
        decimalsOf: (address: string) => number;
        prices: PriceMap;
        anchored: PriceMap;
    }

    // The feed knows symbols; the price map is keyed by address. The token
    // registry is the only thing that can join them, and it is read per request
    // rather than cached at boot so a token the indexer discovers later is
    // priced the moment it appears.
    function externalSeeds(tokens: TokenRow[]): Map<string, bigint>
    {
        const feed = state.externalPrices();
        const seeds = new Map<string, bigint>();
        for (const token of feed.size === 0 ? [] : tokens)
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
    async function view(): Promise<View>
    {
        const [tokens, pools] = await Promise.all([db.listTokens(), db.listV3Pools()]);
        const tokenBy = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
        const seeds = externalSeeds(tokens);
        const prices = buildPriceMap(pools, tokens, refs, seeds);
        return {
            tokens,
            pools,
            tokenBy,
            poolBy: new Map(pools.map((entry) => [entry.address.toLowerCase(), entry])),
            decimalsOf: (address) => tokenBy.get(address.toLowerCase())?.decimals ?? 18,
            prices,
            anchored: anchorsOnly(prices, refs, seeds)
        };
    }

    function tokenRefOf(current: View, address: string): TokenRef
    {
        return current.tokenBy.get(address.toLowerCase()) ?? { address: address.toLowerCase(), ...UNKNOWN_TOKEN };
    }

    // A concentrated pool has no reserves, so the token BALANCES the indexer
    // refreshes stand in as its holdings - the same figure the stats headline
    // already counts it by - and the price comes off the last candle, which is
    // the pool's own post-trade sqrtPriceX96 rather than a ratio of those
    // balances. The fee APR uses the pool's own tier fee: ppm on chain, bps here.
    async function poolWire(current: View, pool: V3PoolRow): Promise<Pool>
    {
        const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
        const [dayVolume, close] = await Promise.all([
            db.volumeSince(pool.address, hourNow - 23 * HOUR),
            db.latestClose(pool.address)
        ]);
        const volume24hUsd = volumeUsd(dayVolume.volume0, dayVolume.volume1, pool, current.anchored, current.decimalsOf);
        const tvlUsd = poolTvlUsd(pool, pool.balance0, pool.balance1, current.anchored, current.decimalsOf);
        return {
            address: pool.address,
            token0: tokenRefOf(current, pool.token0),
            token1: tokenRefOf(current, pool.token1),
            reserve0: pool.balance0.toString(),
            reserve1: pool.balance1.toString(),
            priceWad: (close ?? 0n).toString(),
            tvlUsd: toUsdNumber(tvlUsd),
            volume24hUsd: toUsdNumber(volume24hUsd),
            feeAprBps: feeAprBps(volume24hUsd, tvlUsd, pool.fee / 100)
        };
    }

    // A transaction row only ever wants the two tokens traded, which the pool
    // table answers for any event it stored.
    function txWire(current: View, event: EventRow): TxItem
    {
        const pool = current.poolBy.get(event.pair.toLowerCase());
        const token0 = tokenRefOf(current, pool?.token0 ?? event.pair);
        const token1 = tokenRefOf(current, pool?.token1 ?? event.pair);
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
            stats: routes.get('/stats', { output: stats }, async () =>
            {
                const current = await view();
                const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
                const dayStart = hourNow - 23 * HOUR;
                let tvlUsd = 0n;
                let volume24hUsd = 0n;
                // One market, one set of totals. A pool's worth is what it HOLDS,
                // read onto the row by the indexer, and its volume is summed off
                // the hourly candles every swap feeds.
                const dayVolumes = await Promise.all(current.pools.map((pool) => db.volumeSince(pool.address, dayStart)));
                current.pools.forEach((pool, index) =>
                {
                    const dayVolume = dayVolumes[index];
                    tvlUsd += poolTvlUsd(pool, pool.balance0, pool.balance1, current.anchored, current.decimalsOf);
                    volume24hUsd += volumeUsd(dayVolume.volume0, dayVolume.volume1, pool, current.anchored, current.decimalsOf);
                });
                const status = state.status();
                return {
                    chainId: deployment.chainId,
                    poolCount: current.pools.length,
                    tvlUsd: toUsdNumber(tvlUsd),
                    volume24hUsd: toUsdNumber(volume24hUsd),
                    indexedBlock: status.indexedBlock,
                    blocksBehind: Math.max(0, status.headBlock - status.indexedBlock)
                };
            }),
            pools: routes.get('/pools', { output: array(pool) }, async () =>
            {
                const current = await view();
                return Promise.all(current.pools.map((entry) => poolWire(current, entry)));
            }),
            pool: routes.get('/pools/:address', { output: poolDetail }, async (context) =>
            {
                const current = await view();
                const v3Pool = current.poolBy.get(context.params.address.toLowerCase());
                if (v3Pool === undefined)
                {
                    throw new NotFoundError('unknown pool');
                }
                const wire = await poolWire(current, v3Pool);
                const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
                const raw = await db.candles(wire.address, hourNow - 72 * HOUR);
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
            traded: routes.get('/pools/:address/traded', { output: object({ traded: boolean() }) }, async (context) =>
            {
                const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
                const traded = (await db.candles(context.params.address, hourNow - 72 * HOUR))
                    .some((point) => point.volume0 > 0n || point.volume1 > 0n);
                return { traded };
            }),
            tokens: routes.get('/tokens', { output: array(tokenWithPrice) }, async () =>
            {
                const current = await view();
                return current.tokens.map((token) => ({
                    ...token,
                    priceUsd: toUsdPrice(current.prices.get(token.address) ?? 0n),
                    anchored: current.anchored.has(token.address)
                }));
            }),
            txs: routes.get(
                '/txs',
                { query: object({ account: string().optional() }), output: array(txItem) },
                async (context) =>
                {
                    const [current, events] = await Promise.all([view(), db.recentEvents(30, { account: context.query.account })]);
                    return events.map((event) => txWire(current, event));
                }
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

    /** The built client + SSR renderer (production); omit in dev - the kit's dev session owns the pages. */
    pages?: KitOptions;
}

/**
 * The api half, on any App: the health probe, the market routes, and the typed
 * client's runtime manifest. buildApp calls it for the production mount, and
 * the kit's dev session calls it through its `routes` callback - the SAME
 * registration, so dev and production cannot drift.
 */
export function registerApi(app: App, api: Api): void
{
    app.get('/api/healthz', () => json({ ok: true, at: new Date().toISOString() }));

    register(app, api);

    // The typed client's runtime half, projected from the SAME declaration
    // register just installed. The browser fetches it once at boot.
    app.get('/api/_manifest', () => json(manifestOf(api)));
}

// The api is created FIRST (createApi) and passed in: production wiring needs
// manifestOf(api) inside the pages option, which cannot reference a value being
// destructured out of this very call.
export function buildApp(options: AppOptions): App
{
    const app = new App({ dev: options.dev, observe: options.observe, onError: options.onError });

    registerApi(app, options.api);

    // Mounted LAST so nothing shadows /api.
    if (options.pages !== undefined)
    {
        mountPages(app, options.pages);
    }

    return app;
}
