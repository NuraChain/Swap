import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pipeline, requestId, securityHeaders, rateLimit, logRequests, loadConfig, flag, num, oneOf, str, withResponseHeaders, type WebHandler } from '@azerothjs/http';
import { serve, handleShutdownSignals } from '@azerothjs/http/node';
import type { PageRenderer, PageRoute } from '@azerothjs/kit';
import { createLogger, teeSink, terminalSink } from '@azerothjs/logger';
import { fileSink } from '@azerothjs/logger/node';
import { loadDeploymentIfPresent } from '@nuraswap/shared/deployments';
import { createPublicClient, http } from 'viem';

import { manifestOf } from '@azerothjs/http/api';
import { SUPPORTED_LOCALES } from '../../application/src/lib/langs.ts';

import { buildApp, createApi, registerApi } from './app.ts';
import { startPriceFeed } from './feed.ts';
import { buildCsp } from './csp.ts';
import { IndexerDb } from './indexer/db.ts';
import { UNKNOWN_TOKEN, readTokenMetadata } from './indexer/erc20.ts';
import { startIndexer } from './indexer/live.ts';

try
{
    process.loadEnvFile();
}
catch
{
    // No .env file - the ambient environment is the configuration.
}

const config = loadConfig({
    port: num('PORT', { default: 3000 }),
    env: oneOf('NODE_ENV', ['development', 'production', 'test'], { default: 'development' }),
    chainId: num('CHAIN_ID', { default: 1020 }),
    dataDir: str('DATA_DIR', { default: '../data' }),
    clientDir: str('CLIENT_DIR', { default: '../application/dist' }),
    ssrEntry: str('SSR_ENTRY', { default: '../application/dist-server/entry.server.js' }),
    // Whether a reverse proxy sits in front. It decides what the rate limiter
    // counts: off, the peer address is the bucket, and behind a proxy that is
    // the PROXY for every visitor - one shared budget an attacker exhausts for
    // everybody. On, the forwarded address is trusted, which is only safe when
    // something actually strips and rewrites it. Default off: a directly exposed
    // server must not believe a header the client can forge.
    trustProxy: flag('TRUST_PROXY', { default: false }),
    // The only outbound HTTP this process makes. A bridged asset is worth what
    // it bridges, and no pool on this chain states that - with the feed off,
    // every USD figure that depends on one reads $0. That is the correct
    // behaviour for an air-gapped box and the wrong one everywhere else, so it
    // is a switch rather than an assumption.
    priceFeed: flag('PRICE_FEED', { default: true }),
    priceFeedMs: num('PRICE_FEED_MS', { default: 60_000 })
});
const isProduction = config.env === 'production';

// Pretty lines on the terminal, clean NDJSON in server/logs/ - both, in every mode.
const log = createLogger({
    sink: teeSink(terminalSink(), fileSink(new URL('../logs/', import.meta.url))),
    fields: { service: 'nuraswap-server' }
});

const deployment = loadDeploymentIfPresent(config.chainId);
if (deployment === null)
{
    log.error('no deployment artifact for this chain - run the contracts deploy first', {
        chainId: config.chainId,
        expected: `shared/deployments/${ config.chainId }.json`
    });
    process.exit(1);
}

// The artifact says WHICH tokens this exchange serves; the CONTRACTS say what
// they are called. Reading symbol/name/decimals off the chain at boot is the
// difference between a registry and a rumour - a hand-edited or outdated
// artifact can no longer make the app call a token something it does not call
// itself. When a token has no metadata to give (or the RPC cannot answer right
// now), the artifact's line stands: a stale name beats "???" on screen.
const reader = createPublicClient({ transport: http(deployment.rpcUrl) });
const tokens = await Promise.all(deployment.tokens.map(async (listed) =>
{
    const address = listed.address.toLowerCase() as `0x${ string }`;
    const onChain = await readTokenMetadata(reader, address);
    if (onChain.symbol === UNKNOWN_TOKEN.symbol)
    {
        log.warn('token names unreadable on chain - keeping the artifact line', { address, symbol: listed.symbol });
        return { ...listed, address };
    }
    return { address, ...onChain };
}));
const active = { ...deployment, tokens };

const dataDir = fileURLToPath(new URL(`${ config.dataDir }/`, new URL('..', import.meta.url)));
mkdirSync(dataDir, { recursive: true });
const db = new IndexerDb(`${ dataDir }${ config.chainId }.db`);
for (const token of active.tokens)
{
    db.upsertToken(token);
}

// Nura Chain is CometBFT consensus under the EVM: a block that is committed is
// FINAL - there is no fork choice to wait out, so no confirmation cushion and no
// reorg to fear (the indexer keeps its rewind path anyway; it costs nothing and
// covers a node re-genesis). Blocks land every ~3s and the poll is paced to
// match - polling faster only re-reads the same head.
const indexer = startIndexer({
    db,
    deployment: active,
    log,
    pollingIntervalMs: 3000,
    confirmations: 0
});

const feed = config.priceFeed
    ? startPriceFeed({ log, refreshMs: config.priceFeedMs })
    : { prices: (): ReadonlyMap<string, bigint> => new Map(), stop: (): void => undefined };

// In production this server serves the whole app - one origin, no CORS between halves -
// from the self-contained SSR bundle, which carries the route table and the page renderer.
const ssr = isProduction
    ? await import(pathToFileURL(config.ssrEntry).href) as { routes: PageRoute[]; renderPage: PageRenderer }
    : undefined;

const api = createApi({ db, deployment: active, externalPrices: feed.prices, status: indexer.status });

const observe = logRequests(log);
const onError = (error: unknown, mapped: { status: number }): void =>
{
    if (mapped.status >= 500)
    {
        log.error('unhandled error', { status: mapped.status, error });
    }
};

// Dev: the kit owns a vite session inside THIS process - one origin serves the
// pages, the api and the HMR socket, so there is no second port and no proxy
// (the session refuses one; it IS that seam). The pages mount reads the SAME
// source entry production compiles, and the locales option puts the framework's
// negotiation in front of every page in dev exactly as production runs it.
// The import is dynamic because vite is a dev dependency the production image
// never installs.
const dev = !isProduction;
const kitDev = dev ? await import('@azerothjs/kit/dev') : undefined;
const session = await kitDev?.devPages({
    root: fileURLToPath(new URL('../../application/', import.meta.url)),
    pages: { manifest: manifestOf(api), locales: { supported: SUPPORTED_LOCALES } },
    routes: (app) =>
    {
        registerApi(app, api);
    },
    app: { dev, observe, onError }
});

const app = session?.app ?? buildApp({
    dev,
    api,
    observe,
    onError,
    pages: ssr === undefined
        ? undefined
        : {
            routes: ssr.routes,
            clientDir: config.clientDir,
            renderer: ssr.renderPage,
            manifest: manifestOf(api),
            // The site's ten languages: every page is negotiated per request
            // (cookie, then Accept-Language) and served with its own <html
            // lang> and <html dir> - which is also what the prerendered
            // per-language files are served by.
            locales: { supported: SUPPORTED_LOCALES }
        }
});

// The swap page polls quotes, balances, candles, and recent txs from one origin;
// the template's 200/min default rate limit would 429 normal use.
// A CSP belongs on a page that asks people to sign transactions: injected
// script here rewrites a router address, not a headline. Production only - the
// dev server needs vite's inline HMR client.
const csp = buildCsp({
    rpcUrl: deployment.rpcUrl,
    explorerUrl: deployment.explorerUrl
});

const handler = pipeline(
    app,
    requestId(),
    securityHeaders(),
    // withResponseHeaders, NOT response.headers.set: the kernel answers with a
    // payload response whose headers view is a copy, so setting on it reads back
    // inside this function and reaches nobody. Every response left here without
    // a Content-Security-Policy - the one header this whole module exists for.
    ...(isProduction
        ? [(next: WebHandler): WebHandler => ({
            handle: async (request: Request): Promise<Response> =>
                withResponseHeaders(await next.handle(request), { 'content-security-policy': csp })
        })]
        : []),
    rateLimit({ limit: 2000, windowMs: 60_000, trustProxy: config.trustProxy })
);

// The dev session's vite seam rides `serve`'s `before` - a connect-level
// middleware, ahead of the whole pipeline, so vite answers its own module and
// HMR requests and nothing else reaches it. Dev binds the loopback explicitly:
// `localhost` resolves to ::1 first on some platforms, and the session's
// open-in-editor refuses non-loopback peers.
const served = await serve(handler, {
    port: config.port,
    before: session?.before,
    hostname: dev ? (process.env['HOST'] ?? '127.0.0.1') : undefined
});
// The HMR socket rides this server: vite was never given one of its own.
session?.attach(served.server);
handleShutdownSignals(served, { beforeExit: () => void session?.close() });
process.once('SIGINT', indexer.stop);
process.once('SIGTERM', indexer.stop);
process.once('SIGINT', feed.stop);
process.once('SIGTERM', feed.stop);

// The panel's Server tab connects here and mirrors the server's reactive graph. Dev only,
// token-gated; the token lives in `.env` so it survives restarts.
if (process.env.NODE_ENV === 'development')
{
    const token = process.env.DEVTOOLS_TOKEN;
    if (token === undefined || token.length < 16)
    {
        log.warn('devtools bridge off - set DEVTOOLS_TOKEN in .env (16+ chars) to enable it');
    }
    else
    {
        const { attachDevtools } = await import('@azerothjs/devtools/server');
        attachDevtools(served.server, { token });
        log.info('devtools bridge', { url: `ws://localhost:${ served.port }/__azeroth/devtools?token=${ token }` });
    }
}

log.info('Listening', { url: `http://localhost:${ served.port }`, env: process.env.NODE_ENV, chainId: config.chainId });
