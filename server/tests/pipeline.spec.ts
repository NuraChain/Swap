// The production edge, assembled the way main.ts assembles it. These middlewares
// are the only thing between the open internet and a money application, and none
// of them is exercised by the route tests: `app.handle` alone skips the whole
// pipeline. What is pinned here is the composition, not the library.

import { MemoryRateStore, pipeline, rateLimit, requestId, securityHeaders, withResponseHeaders, type WebHandler } from '@azerothjs/http';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, createApi } from '../src/app.ts';
import { buildCsp } from '../src/csp.ts';
import { IndexerDb } from '../src/indexer/db.ts';
import type { Address } from '../src/indexer/db.ts';
import type { Deployment } from '@nuraswap/shared/deployments';

const DEPLOYMENT: Deployment = {
    chainId: 1020,
    networkName: 'Nura Chain',
    rpcUrl: 'https://rpc.nurachain.net',
    explorerUrl: 'https://explorer.nurachain.net',
    faucet: false,
    startBlock: 0,
    contracts:
    {
        factory: '0x00000000000000000000000000000000000000f0' as Address,
        router: '0x00000000000000000000000000000000000000f1' as Address,
        wnura: '0x00000000000000000000000000000000000000b0' as Address,
        multicall3: '0x00000000000000000000000000000000000000f2' as Address
    },
    tokens: []
};

const open: IndexerDb[] = [];

afterEach(() =>
{
    while (open.length > 0)
    {
        open.pop()?.close();
    }
});

interface EdgeOptions
{
    production?: boolean;
    limit?: number;
    trustProxy?: boolean;
    /** Model a reverse proxy: every request appears to come from one address. */
    sharedPeer?: boolean;
}

/** The same shape main.ts builds, with the knobs the tests need to move. */
function edge(options: EdgeOptions = {}): { handler: WebHandler; csp: string }
{
    const db = new IndexerDb(':memory:');
    open.push(db);
    const api = createApi({
        db,
        deployment: DEPLOYMENT,
        swapFeeBps: 25,
        status: () => ({ headBlock: 1, indexedBlock: 1 })
    });
    const app = buildApp({ dev: !(options.production ?? true), api });
    const csp = buildCsp({ rpcUrl: DEPLOYMENT.rpcUrl, explorerUrl: DEPLOYMENT.explorerUrl });
    const handler = pipeline(
        app,
        requestId(),
        securityHeaders(),
        ...((options.production ?? true)
            ? [(next: WebHandler): WebHandler => ({
                handle: async (request: Request): Promise<Response> =>
                    withResponseHeaders(await next.handle(request), { 'content-security-policy': csp })
            })]
            : []),
        rateLimit({
            limit: options.limit ?? 2000,
            windowMs: 60_000,
            trustProxy: options.trustProxy ?? false,
            store: new MemoryRateStore(),
            // The default key is the socket peer, and there is no socket in
            // process, so tests name their own client. `sharedPeer` models what
            // the limiter actually sees behind a reverse proxy: one address for
            // everybody. `trustProxy` tests leave the key alone and let the
            // library read the forwarded header.
            key: options.trustProxy === true
                ? undefined
                : options.sharedPeer === true
                    ? (): string => '127.0.0.1'
                    : (request): string => request.headers.get('x-test-client') ?? 'anonymous'
        })
    );
    return { handler, csp };
}

function get(handler: WebHandler, path: string, headers: Record<string, string> = {}): Promise<Response>
{
    return handler.handle(new Request(`https://nuraswap.example${ path }`, { headers }));
}

describe('security headers', () =>
{
    it('marks every response nosniff, same-origin and referrer-free', async () =>
    {
        const { handler } = edge();
        const response = await get(handler, '/api/market/stats');
        expect(response.status).toBe(200);
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
        expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    });

    it('carries them on error responses too - a 404 is still a response', async () =>
    {
        const { handler } = edge();
        const response = await get(handler, '/api/nope');
        expect(response.status).toBe(404);
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('assigns a correlation id to every request', async () =>
    {
        const { handler } = edge();
        const first = await get(handler, '/api/healthz');
        const second = await get(handler, '/api/healthz');
        const idOf = (response: Response): string | null => response.headers.get('x-request-id');
        expect(idOf(first)).toBeTruthy();
        expect(idOf(second)).toBeTruthy();
        expect(idOf(first)).not.toBe(idOf(second));
    });
});

describe('content security policy', () =>
{
    // Injected script on a DEX front-end does not deface a page, it rewrites the
    // address an approval is signed for. The policy has to be ON in production.
    it('is applied to production responses, exactly as buildCsp composed it', async () =>
    {
        const { handler, csp } = edge({ production: true });
        const response = await get(handler, '/api/market/stats');
        expect(response.headers.get('content-security-policy')).toBe(csp);
        expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
        expect(response.headers.get('content-security-policy')).toContain('https://rpc.nurachain.net');
    });

    it('is absent in dev, where vite needs its inline HMR client', async () =>
    {
        const { handler } = edge({ production: false });
        const response = await get(handler, '/api/market/stats');
        expect(response.headers.get('content-security-policy')).toBeNull();
    });

    it('covers error responses as well as successful ones', async () =>
    {
        const { handler, csp } = edge({ production: true });
        const response = await get(handler, '/api/nope');
        expect(response.headers.get('content-security-policy')).toBe(csp);
    });
});

describe('rate limiting', () =>
{
    it('serves up to the budget, then refuses with 429 and a Retry-After', async () =>
    {
        const { handler } = edge({ limit: 3 });
        const client = { 'x-test-client': 'a' };
        for (let request = 0; request < 3; request++)
        {
            expect((await get(handler, '/api/healthz', client)).status).toBe(200);
        }
        const refused = await get(handler, '/api/healthz', client);
        expect(refused.status).toBe(429);
        expect(refused.headers.get('retry-after')).toBeTruthy();
    });

    it('publishes the remaining budget on every response', async () =>
    {
        const { handler } = edge({ limit: 5 });
        const response = await get(handler, '/api/healthz', { 'x-test-client': 'b' });
        expect(response.headers.get('ratelimit-limit')).toBe('5');
        expect(response.headers.get('ratelimit-remaining')).toBe('4');
    });

    it('gives each client its own budget', async () =>
    {
        const { handler } = edge({ limit: 1 });
        expect((await get(handler, '/api/healthz', { 'x-test-client': 'c' })).status).toBe(200);
        expect((await get(handler, '/api/healthz', { 'x-test-client': 'c' })).status).toBe(429);
        // A different client is unaffected by the first one's exhaustion.
        expect((await get(handler, '/api/healthz', { 'x-test-client': 'd' })).status).toBe(200);
    });

    // The regression this file exists for. Production runs behind Caddy, so every
    // request arrives from 127.0.0.1. With the forwarded address distrusted, the
    // limiter sees ONE client and the whole exchange shares a single budget that
    // any visitor can exhaust for everybody. TRUST_PROXY is what separates them.
    it('separates clients behind a proxy only when the forwarded address is trusted', async () =>
    {
        const trusting = edge({ limit: 1, trustProxy: true });
        expect((await get(trusting.handler, '/api/healthz', { 'x-forwarded-for': '203.0.113.1' })).status).toBe(200);
        expect((await get(trusting.handler, '/api/healthz', { 'x-forwarded-for': '203.0.113.1' })).status).toBe(429);
        // A second visitor still gets served: the first one only exhausted its own.
        expect((await get(trusting.handler, '/api/healthz', { 'x-forwarded-for': '198.51.100.7' })).status).toBe(200);

        // The other half: with the forwarded address distrusted, the limiter sees
        // the proxy's own address for everyone. Two different visitors, one
        // bucket - the first exhausts the budget and the second is refused.
        const distrusting = edge({ limit: 1, sharedPeer: true });
        expect((await get(distrusting.handler, '/api/healthz', { 'x-forwarded-for': '203.0.113.1' })).status).toBe(200);
        expect((await get(distrusting.handler, '/api/healthz', { 'x-forwarded-for': '198.51.100.7' })).status).toBe(429);
    });

    it('still refuses cleanly rather than crashing when the budget is spent', async () =>
    {
        const { handler } = edge({ limit: 1 });
        const client = { 'x-test-client': 'e' };
        await get(handler, '/api/healthz', client);
        const refused = await get(handler, '/api/market/stats', client);
        expect(refused.status).toBe(429);
        // Still a well-formed response with the security headers on it.
        expect(refused.headers.get('x-content-type-options')).toBe('nosniff');
    });
});

describe('runtime smoke', () =>
{
    it('answers the health probe an orchestrator polls', async () =>
    {
        const { handler } = edge();
        const response = await get(handler, '/api/healthz');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.ok).toBe(true);
        expect(Number.isNaN(Date.parse(body.at))).toBe(false);
    });

    it('serves the whole read surface through the full edge', async () =>
    {
        const { handler } = edge();
        for (const path of ['/api/market/stats', '/api/market/pools', '/api/market/tokens', '/api/market/txs', '/api/market/deployment'])
        {
            const response = await get(handler, path);
            expect(response.status, path).toBe(200);
            expect(response.headers.get('content-security-policy'), path).toBeTruthy();
        }
    });
});
