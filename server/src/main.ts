import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pipeline, requestId, securityHeaders, rateLimit, logRequests, loadConfig, num, oneOf, str, type WebHandler } from '@azerothjs/http';
import { serve, handleShutdownSignals } from '@azerothjs/http/node';
import type { PageRenderer, PageRoute } from '@azerothjs/kit';
import { createLogger, teeSink, terminalSink } from '@azerothjs/logger';
import { fileSink } from '@azerothjs/logger/node';
import { loadDeploymentIfPresent } from '@nuraswap/shared/deployments';
import { createPublicClient, http, parseAbi } from 'viem';

import { manifestOf } from '@azerothjs/http/api';

import { buildApp, createApi } from './app.ts';
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

// The swap fee lives in the factory (uint32 basis points, retunable by
// feeToSetter without redeploying anything), so it is read, never assumed - the
// fee APR on every pool and the fee printed on the swap card both come from this
// number. Read once at boot: retuning it is a governance action, not a market
// move, and a restart is a fair price for picking up the new one.
// A public RPC drops a call now and then, and one dropped call is no reason to
// refuse to boot - but a guessed fee is worse than no server, so it retries and
// then gives up loudly rather than inventing a number.
const factoryFee = parseAbi(['function swapFee() view returns (uint32)']);

async function readSwapFee(): Promise<number>
{
    for (let attempt = 1; attempt <= 3; attempt++)
    {
        try
        {
            return await reader.readContract({
                address: active.contracts.factory as `0x${ string }`,
                abi: factoryFee,
                functionName: 'swapFee'
            });
        }
        catch (error)
        {
            log.warn('factory swapFee unreadable - retrying', { attempt, error: String(error).split('\n')[0] });
            await new Promise<void>((resolve) => { setTimeout(resolve, attempt * 1000); });
        }
    }
    log.error('factory swapFee unreadable after 3 tries - refusing to serve a fee nobody charges', {
        factory: active.contracts.factory
    });
    process.exit(1);
}

const swapFeeBps = await readSwapFee();

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

// In dev, vite serves the client and proxies /api here; in production this server serves
// the whole app - one origin, no CORS between halves. The SSR bundle is ONE self-contained
// file, so importing it gives the kit both the route table and the page renderer.
const ssr = isProduction
    ? await import(pathToFileURL(config.ssrEntry).href) as { routes: PageRoute[]; renderPage: PageRenderer }
    : undefined;

const api = createApi({ db, deployment: active, swapFeeBps, status: indexer.status });

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
