import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pipeline, requestId, securityHeaders, rateLimit, logRequests, loadConfig, num, oneOf, str, type WebHandler } from '@azerothjs/http';
import { serve, handleShutdownSignals } from '@azerothjs/http/node';
import type { PageRenderer, PageRoute } from '@azerothjs/kit';
import { createLogger, teeSink, terminalSink } from '@azerothjs/logger';
import { fileSink } from '@azerothjs/logger/node';
import { loadDeploymentIfPresent } from '@nuraswap/shared/deployments';

import { manifestOf } from '@azerothjs/http/api';

import { buildApp, createApi } from './app.ts';
import { buildCsp } from './csp.ts';
import { IndexerDb } from './indexer/db.ts';
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
    ssrEntry: str('SSR_ENTRY', { default: '../application/dist-server/entry.server.js' })
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

const dataDir = fileURLToPath(new URL(`${ config.dataDir }/`, new URL('..', import.meta.url)));
mkdirSync(dataDir, { recursive: true });
const db = new IndexerDb(`${ dataDir }${ config.chainId }.db`);
for (const token of deployment.tokens)
{
    db.upsertToken({ ...token, address: token.address.toLowerCase() as `0x${ string }` });
}

// Local chain: instant finality, tight polling. Testnet: public RPC pacing and a
// two-block reorg cushion.
const local = config.chainId === 31337;
const indexer = startIndexer({
    db,
    deployment,
    log,
    pollingIntervalMs: local ? 1000 : 4000,
    confirmations: local ? 0 : 2
});

// In dev, vite serves the client and proxies /api here; in production this server serves
// the whole app - one origin, no CORS between halves. The SSR bundle is ONE self-contained
// file, so importing it gives the kit both the route table and the page renderer.
const ssr = isProduction
    ? await import(pathToFileURL(config.ssrEntry).href) as { routes: PageRoute[]; renderPage: PageRenderer }
    : undefined;

const api = createApi({ db, deployment, status: indexer.status });

const app = buildApp({
    dev: !isProduction,
    api,
    observe: logRequests(log),
    onError: (error, mapped) =>
    {
        if (mapped.status >= 500)
        {
            log.error('unhandled error', { status: mapped.status, error });
        }
    },
    pages: ssr === undefined ? undefined : { routes: ssr.routes, clientDir: config.clientDir, renderer: ssr.renderPage, manifest: manifestOf(api) }
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
    ...(isProduction
        ? [(next: WebHandler): WebHandler => ({
            handle: async (request: Request): Promise<Response> =>
            {
                const response = await next.handle(request);
                response.headers.set('content-security-policy', csp);
                return response;
            }
        })]
        : []),
    rateLimit({ limit: 2000, windowMs: 60_000 })
);

const served = await serve(handler, { port: config.port });
handleShutdownSignals(served);
process.once('SIGINT', indexer.stop);
process.once('SIGTERM', indexer.stop);

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

log.info('Listening', { url: `http://localhost:${ served.port }`, env: config.env, chainId: config.chainId });
