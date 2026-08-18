// The market API over the indexer's storage: pool list, pool detail with candles,
// chain stats, token registry, recent transactions, and the active deployment.
// Handlers read sqlite synchronously per request - the dataset is a DEX's hot
// state, not a warehouse - and every response is schema-validated at the boundary.

import { App, NotFoundError, json, type ErrorObserver, type RequestObserver } from '@azerothjs/http';
import { feature, manifestOf, register } from '@azerothjs/http/api';
import { mountPages, type KitOptions } from '@azerothjs/kit';
import { array, object, string } from '@azerothjs/schema';
import type { Deployment } from '@nuraswap/shared/deployments';

import { priceFromReserves } from '@nuraswap/shared/math';

import { HOUR, fillCandles, hourStartOf } from './indexer/apply.ts';
import { buildPriceMap, feeAprBps, pairTvlUsd, toUsdNumber, volumeUsd } from './indexer/pricing.ts';
import { deploymentInfo, pool, poolDetail, stats, tokenWithPrice, txItem } from './schemas.ts';
import type { EventRow, IndexerDb, PairRow } from './indexer/db.ts';
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

    function poolWire(pair: PairRow, prices: ReturnType<typeof buildPriceMap>): Pool
    {
        const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
        const dayVolume = db.volumeSince(pair.address, hourNow - 23 * HOUR);
        const volume24hUsd = volumeUsd(dayVolume.volume0, dayVolume.volume1, pair, prices, decimalsOf);
        const tvlUsd = pairTvlUsd(pair, prices, decimalsOf);
        return {
            address: pair.address,
            token0: tokenRefOf(pair.token0),
            token1: tokenRefOf(pair.token1),
            reserve0: pair.reserve0.toString(),
            reserve1: pair.reserve1.toString(),
            priceWad: priceFromReserves(
                pair.reserve0,
                decimalsOf(pair.token0),
                pair.reserve1,
                decimalsOf(pair.token1)
            ).toString(),
            tvlUsd: toUsdNumber(tvlUsd),
            volume24hUsd: toUsdNumber(volume24hUsd),
            feeAprBps: feeAprBps(volume24hUsd, tvlUsd)
        };
    }

    function txWire(event: EventRow): TxItem
    {
        const pair = db.getPair(event.pair);
        const token0 = tokenRefOf(pair?.token0 ?? event.pair);
        const token1 = tokenRefOf(pair?.token1 ?? event.pair);
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
                const pairs = db.listPairs();
                const prices = buildPriceMap(pairs, db.listTokens(), refs);
                const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
                let tvlUsd = 0n;
                let volume24hUsd = 0n;
                for (const pair of pairs)
                {
                    tvlUsd += pairTvlUsd(pair, prices, decimalsOf);
                    const dayVolume = db.volumeSince(pair.address, hourNow - 23 * HOUR);
                    volume24hUsd += volumeUsd(dayVolume.volume0, dayVolume.volume1, pair, prices, decimalsOf);
                }
                const status = state.status();
                return {
                    chainId: deployment.chainId,
                    pairCount: pairs.length,
                    tvlUsd: toUsdNumber(tvlUsd),
                    volume24hUsd: toUsdNumber(volume24hUsd),
                    indexedBlock: status.indexedBlock,
                    blocksBehind: Math.max(0, status.headBlock - status.indexedBlock)
                };
            }),
            pools: routes.get('/pools', { output: array(pool) }, () =>
            {
                const pairs = db.listPairs();
                const prices = buildPriceMap(pairs, db.listTokens(), refs);
                return pairs.map((pair) => poolWire(pair, prices));
            }),
            pool: routes.get('/pools/:address', { output: poolDetail }, (context) =>
            {
                const pair = db.getPair(context.params.address);
                if (pair === null)
                {
                    throw new NotFoundError('unknown pool');
                }
                const prices = buildPriceMap(db.listPairs(), db.listTokens(), refs);
                const hourNow = hourStartOf(Math.floor(Date.now() / 1000));
                const raw = db.candles(pair.address, hourNow - 72 * HOUR);
                // Chain time can run AHEAD of wall time (local chains walk their
                // clock forward); fill to whichever is later or the fill is empty.
                const toHour = Math.max(hourNow, raw.at(-1)?.hourStart ?? hourNow);
                return {
                    ...poolWire(pair, prices),
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
            tokens: routes.get('/tokens', { output: array(tokenWithPrice) }, () =>
            {
                const prices = buildPriceMap(db.listPairs(), db.listTokens(), refs);
                return db.listTokens().map((token) => ({
                    ...token,
                    priceUsd: toUsdNumber(prices.get(token.address) ?? 0n)
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
