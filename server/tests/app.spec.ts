// The market API exercised the template way: pure app.handle(new Request(...)),
// no sockets, over a seeded in-memory database.

import type { Deployment } from '@nuraswap/shared/deployments';
import { describe, expect, it } from 'vitest';

import { buildApp, createApi } from '../src/app.ts';
import { applyEvent } from '../src/indexer/apply.ts';
import { buildPriceMap, feeAprBps } from '../src/indexer/pricing.ts';
import { IndexerDb } from '../src/indexer/db.ts';
import type { ApplyContext } from '../src/indexer/apply.ts';
import type { Address } from '../src/indexer/db.ts';

const WNURA = '0x000000000000000000000000000000000000b0b0' as Address;
const ALPHA = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const PAIR_AU = '0x00000000000000000000000000000000000000aa' as Address;
const PAIR_WU = '0x00000000000000000000000000000000000000bb' as Address;
const TRADER = '0x00000000000000000000000000000000000000cc' as Address;

const DEPLOYMENT: Deployment = {
    chainId: 1020,
    networkName: 'Nura Chain',
    rpcUrl: 'https://rpc.nurachain.net',
    explorerUrl: null,
    faucet: false,
    startBlock: 0,
    contracts:
    {
        factory: '0x00000000000000000000000000000000000000f0',
        router: '0x00000000000000000000000000000000000000f1',
        wnura: WNURA,
        multicall3: '0x00000000000000000000000000000000000000f2'
    },
    tokens: [
        { address: ALPHA, symbol: 'ALPHA', name: 'Nura', decimals: 18 },
        { address: WNURA, symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 },
        { address: USDT, symbol: 'USDT', name: 'Tether USD', decimals: 6 }
    ]
};

function seededDb(): IndexerDb
{
    const db = new IndexerDb(':memory:');
    for (const token of DEPLOYMENT.tokens)
    {
        db.upsertToken(token);
    }
    const context: ApplyContext = {
        timestampOf: () => Math.floor(Date.now() / 1000),
        decimalsOf: (address) => DEPLOYMENT.tokens.find((token) => token.address === address.toLowerCase())?.decimals ?? 18
    };
    // ALPHA/USDT at $2.50 and WNURA/USDT at $850.
    applyEvent(db, { kind: 'pairCreated', pair: PAIR_AU, token0: ALPHA, token1: USDT, blockNumber: 5 }, context);
    applyEvent(db, { kind: 'sync', pair: PAIR_AU, reserve0: 40_000n * 10n ** 18n, reserve1: 100_000n * 10n ** 6n }, context);
    applyEvent(db, { kind: 'pairCreated', pair: PAIR_WU, token0: WNURA, token1: USDT, blockNumber: 6 }, context);
    applyEvent(db, { kind: 'sync', pair: PAIR_WU, reserve0: 1000n * 10n ** 18n, reserve1: 850_000n * 10n ** 6n }, context);
    applyEvent(db, {
        kind: 'swap',
        pair: PAIR_AU,
        blockNumber: 7,
        logIndex: 1,
        txHash: '0xaaa',
        account: TRADER,
        amount0In: 100n * 10n ** 18n,
        amount1In: 0n,
        amount0Out: 0n,
        amount1Out: 248n * 10n ** 6n
    }, context);
    return db;
}

// A chain that also carries UniswapV3. The artifact above deliberately does
// NOT: the two together are what prove the v3 block is optional on the wire.
const V3_DEPLOYMENT: Deployment = {
    ...DEPLOYMENT,
    v3:
    {
        factory: '0x0000000000000000000000000000000000000031',
        swapRouter: '0x0000000000000000000000000000000000000032',
        quoter: '0x0000000000000000000000000000000000000033',
        positionManager: '0x0000000000000000000000000000000000000034',
        tickLens: '0x0000000000000000000000000000000000000035'
    }
};

function testApp(deployment: Deployment = DEPLOYMENT, status = { headBlock: 12, indexedBlock: 10 })
{
    const db = seededDb();
    // The fee the factory would report; the api never invents one.
    const api = createApi({ db, deployment, swapFeeBps: 25, status: () => status });
    const app = buildApp({ dev: false, api });
    return {
        db,
        get: (path: string): Promise<Response> => app.handle(new Request(`http://local${ path }`)),
        send: (path: string, init: RequestInit): Promise<Response> =>
            app.handle(new Request(`http://local${ path }`, init))
    };
}

/** Every route the market API publishes, for the surface-wide checks below. */
const ROUTES = [
    '/api/market/stats',
    '/api/market/pools',
    `/api/market/pools/${ PAIR_AU }`,
    '/api/market/tokens',
    '/api/market/txs',
    '/api/market/deployment',
    '/api/healthz',
    '/api/_manifest'
];

describe('buildPriceMap', () =>
{
    it('prices the stable at $1, WNURA through its pool, ALPHA through its pool', () =>
    {
        const db = seededDb();
        const prices = buildPriceMap(db.listPairs(), db.listTokens(), { stable: USDT, wrappedNative: WNURA });
        expect(prices.get(USDT)).toBe(10n ** 18n);
        expect(prices.get(WNURA)).toBe(850n * 10n ** 18n);
        expect(prices.get(ALPHA)).toBe(25n * 10n ** 17n);
    });
});

describe('market api', () =>
{
    it('GET /api/market/stats aggregates TVL, volume, and indexer lag', async () =>
    {
        const response = await testApp().get('/api/market/stats');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.chainId).toBe(1020);
        expect(body.pairCount).toBe(2);
        // TVL: ALPHA pool 100k + 100k, WNURA pool 850k + 850k = 1.9M.
        expect(body.tvlUsd).toBeCloseTo(1_900_000, 0);
        expect(body.volume24hUsd).toBeGreaterThan(0);
        expect(body.blocksBehind).toBe(2);
        // The chain's fee travels on the wire, so no client has to assume one.
        expect(body.swapFeeBps).toBe(25);
    });

    it('GET /api/market/pools lists both pools with prices and APR fields', async () =>
    {
        const response = await testApp().get('/api/market/pools');
        const pools = await response.json();
        expect(pools).toHaveLength(2);
        const alphaPool = pools.find((entry: { address: string }) => entry.address === PAIR_AU);
        expect(alphaPool.token0.symbol).toBe('ALPHA');
        expect(alphaPool.priceWad).toBe((25n * 10n ** 17n).toString());
        expect(alphaPool.tvlUsd).toBeCloseTo(200_000, 0);
        expect(typeof alphaPool.feeAprBps).toBe('number');
        // APR follows the fee it is given: a tenth of TVL traded daily at 25 bps
        // annualises to 9.12%, and the same volume at 100 bps to 36.5%. A pool
        // nobody trades earns nothing at any fee.
        expect(feeAprBps(1_000n, 10_000n, 25)).toBe(912);
        expect(feeAprBps(1_000n, 10_000n, 100)).toBe(3650);
        expect(feeAprBps(0n, 10_000n, 25)).toBe(0);
    });

    it('GET /api/market/pools/:address returns candles, 404s unknown pools', async () =>
    {
        const app = testApp();
        const detail = await app.get(`/api/market/pools/${ PAIR_AU }`);
        expect(detail.status).toBe(200);
        const body = await detail.json();
        expect(body.candles.length).toBeGreaterThan(0);

        const missing = await app.get('/api/market/pools/0x00000000000000000000000000000000000000ee');
        expect(missing.status).toBe(404);
    });

    it('GET /api/market/txs renders the swap with in/out direction', async () =>
    {
        const response = await testApp().get('/api/market/txs');
        const txs = await response.json();
        expect(txs).toHaveLength(1);
        expect(txs[0].kind).toBe('swap');
        expect(txs[0].tokenA.symbol).toBe('ALPHA');
        expect(txs[0].amountA).toBe((100n * 10n ** 18n).toString());
        expect(txs[0].tokenB.symbol).toBe('USDT');
        expect(txs[0].amountB).toBe((248n * 10n ** 6n).toString());
    });

    it('GET /api/market/tokens serves the registry with USD prices', async () =>
    {
        const tokens = await (await testApp().get('/api/market/tokens')).json();
        expect(tokens.map((token: { symbol: string }) => token.symbol).sort()).toEqual(['ALPHA', 'USDT', 'WNURA']);
        const bySymbol = Object.fromEntries(tokens.map((token: { symbol: string; priceUsd: number }) => [token.symbol, token.priceUsd]));
        expect(bySymbol.USDT).toBe(1);
        expect(bySymbol.WNURA).toBe(850);
        expect(bySymbol.ALPHA).toBe(2.5);
    });

    it('GET /api/market/txs?account= filters to the caller', async () =>
    {
        const app = testApp();
        const mine = await (await app.get(`/api/market/txs?account=${ TRADER }`)).json();
        expect(mine).toHaveLength(1);
        const nobody = await (await app.get('/api/market/txs?account=0x00000000000000000000000000000000000000dd')).json();
        expect(nobody).toHaveLength(0);
    });

    it('GET /api/market/deployment serves the active deployment', async () =>
    {
        const deployment = await (await testApp().get('/api/market/deployment')).json();
        expect(deployment.chainId).toBe(1020);
        expect(deployment.contracts.router).toBe(DEPLOYMENT.contracts.router);
        expect(deployment.explorerUrl).toBeNull();
    });

    // An artifact written before V3 existed has no `v3` key at all. The route has
    // to answer null there rather than omitting the field: the app decides
    // whether to render its V3 half from this one value, and an absent key would
    // fail the wire schema instead of reading as "this chain has no V3".
    it('serves v3 as null on a chain that has none', async () =>
    {
        const deployment = await (await testApp().get('/api/market/deployment')).json();
        expect(deployment.v3).toBeNull();
    });

    it('serves the v3 addresses when the artifact carries them', async () =>
    {
        const deployment = await (await testApp(V3_DEPLOYMENT).get('/api/market/deployment')).json();
        expect(deployment.v3).toEqual(V3_DEPLOYMENT.v3);
    });

    it('GET /api/healthz still answers', async () =>
    {
        const response = await testApp().get('/api/healthz');
        expect((await response.json()).ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The surface itself. These are the checks that hold for EVERY route, and the
// ones that keep a public read-only API read-only.

describe('api surface', () =>
{
    it('answers JSON on every route', async () =>
    {
        const app = testApp();
        for (const route of ROUTES)
        {
            const response = await app.get(route);
            expect(response.status, route).toBe(200);
            expect(response.headers.get('content-type'), route).toContain('application/json');
            // Parses as JSON - no bigint or undefined leaked into the body.
            await expect(response.json(), route).resolves.toBeDefined();
        }
    });

    it('refuses every method except reads, and says which are allowed', async () =>
    {
        const app = testApp();
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
        {
            const response = await app.send('/api/market/stats', { method });
            expect(response.status, method).toBe(405);
            const body = await response.json();
            expect(body.error.code).toBe('method-not-allowed');
            expect(body.error.details.allowed).toContain('GET');
        }
    });

    it('serves HEAD alongside GET', async () =>
    {
        const response = await testApp().send('/api/market/stats', { method: 'HEAD' });
        expect(response.status).toBe(200);
    });

    it('404s an unknown route with a typed error body', async () =>
    {
        const app = testApp();
        for (const path of ['/api/market/nope', '/api/nope', '/nope'])
        {
            const response = await app.get(path);
            expect(response.status, path).toBe(404);
            const body = await response.json();
            expect(body.error.code).toBe('not-found');
        }
    });

    // Nothing here writes. If a mutating route is ever added, this fails and the
    // author has to decide deliberately rather than by accident.
    it('leaves the database untouched no matter what is called', async () =>
    {
        const app = testApp();
        const before = {
            pairs: app.db.listPairs().length,
            tokens: app.db.listTokens().length,
            events: app.db.recentEvents(100).length,
            reserves: app.db.getPair(PAIR_AU)?.reserve0
        };
        for (const route of ROUTES)
        {
            await app.get(route);
        }
        for (const method of ['POST', 'PUT', 'DELETE'])
        {
            await app.send('/api/market/pools', { method, body: '{"reserve0":"0"}' });
        }
        expect({
            pairs: app.db.listPairs().length,
            tokens: app.db.listTokens().length,
            events: app.db.recentEvents(100).length,
            reserves: app.db.getPair(PAIR_AU)?.reserve0
        }).toEqual(before);
    });

    it('publishes a manifest whose routes match the ones it serves', async () =>
    {
        const manifest = await (await testApp().get('/api/_manifest')).json();
        expect(manifest.market.stats).toEqual({ method: 'GET', path: '/market/stats' });
        expect(manifest.market.pool.path).toBe('/market/pools/:address');
        // Every declared route resolves - the browser's typed client is built
        // from exactly this, so a drift here is a dead call site there.
        const app = testApp();
        for (const entry of Object.values(manifest.market) as Array<{ path: string }>)
        {
            const path = entry.path.replace(':address', PAIR_AU);
            expect((await app.get(`/api${ path }`)).status, path).toBe(200);
        }
    });
});

describe('response shapes', () =>
{
    it('sends every on-chain amount as a decimal string, never a JSON number', async () =>
    {
        const app = testApp();
        const [pool] = await (await app.get('/api/market/pools')).json();
        for (const field of ['reserve0', 'reserve1', 'priceWad'])
        {
            expect(typeof pool[field], field).toBe('string');
            expect(pool[field]).toMatch(/^\d+$/);
        }
        const [tx] = await (await app.get('/api/market/txs')).json();
        expect(typeof tx.amountA).toBe('string');
        expect(typeof tx.amountB).toBe('string');
        const detail = await (await app.get(`/api/market/pools/${ PAIR_AU }`)).json();
        for (const candle of detail.candles)
        {
            expect(typeof candle.close).toBe('string');
            expect(typeof candle.volume0).toBe('string');
        }
    });

    it('sends USD figures as numbers at display precision', async () =>
    {
        const stats = await (await testApp().get('/api/market/stats')).json();
        expect(typeof stats.tvlUsd).toBe('number');
        expect(typeof stats.volume24hUsd).toBe('number');
        expect(Number.isInteger(stats.pairCount)).toBe(true);
        expect(Number.isInteger(stats.indexedBlock)).toBe(true);
    });

    it('gives every pool the full row the table renders', async () =>
    {
        const pools = await (await testApp().get('/api/market/pools')).json();
        for (const pool of pools)
        {
            expect(Object.keys(pool).sort()).toEqual([
                'address', 'feeAprBps', 'priceWad', 'reserve0', 'reserve1', 'token0', 'token1', 'tvlUsd', 'volume24hUsd'
            ]);
            expect(Object.keys(pool.token0).sort()).toEqual(['address', 'decimals', 'name', 'symbol']);
        }
    });

    it('gives the deployment exactly the fields the app reads', async () =>
    {
        const deployment = await (await testApp().get('/api/market/deployment')).json();
        expect(Object.keys(deployment).sort()).toEqual([
            'chainId', 'contracts', 'explorerUrl', 'faucet', 'networkName', 'rpcUrl', 'tokens', 'v3'
        ]);
        // Addresses cross lowercased, so the app can compare them literally.
        for (const token of deployment.tokens as Array<{ address: string }>)
        {
            expect(token.address).toBe(token.address.toLowerCase());
        }
    });
});

describe('pool detail', () =>
{
    it('finds a pool whichever case the address is asked for in', async () =>
    {
        const app = testApp();
        const lower = await app.get(`/api/market/pools/${ PAIR_AU }`);
        const upper = await app.get(`/api/market/pools/${ PAIR_AU.toUpperCase() }`);
        expect(lower.status).toBe(200);
        expect(upper.status).toBe(200);
        expect((await upper.json()).address).toBe(PAIR_AU);
    });

    it('404s an unknown pool with the reason, not a blank body', async () =>
    {
        const response = await testApp().get('/api/market/pools/0x00000000000000000000000000000000000000ee');
        expect(response.status).toBe(404);
        expect((await response.json()).error.message).toBe('unknown pool');
    });

    it('404s a malformed address rather than searching for it', async () =>
    {
        const app = testApp();
        for (const bad of ['0x', 'not-an-address', '0x' + 'f'.repeat(200), '%20', '..%2F..%2Fetc'])
        {
            const response = await app.get(`/api/market/pools/${ encodeURIComponent(bad) }`);
            expect(response.status, bad).toBe(404);
        }
    });

    // The path parameter reaches a prepared statement. A payload that closes a
    // quote has to come back as "no such pool", not as a different pool.
    it('treats an injection payload in the path as an address that does not exist', async () =>
    {
        const app = testApp();
        const hostile = encodeURIComponent("' OR '1'='1");
        const response = await app.get(`/api/market/pools/${ hostile }`);
        expect(response.status).toBe(404);
        // And the pool it might have matched is still there afterwards.
        expect((await app.get(`/api/market/pools/${ PAIR_AU }`)).status).toBe(200);
    });

    it('returns candles in ascending, gapless hours', async () =>
    {
        const detail = await (await testApp().get(`/api/market/pools/${ PAIR_AU }`)).json();
        const hours = detail.candles.map((candle: { hourStart: number }) => candle.hourStart);
        expect(hours.length).toBeGreaterThan(0);
        for (let index = 1; index < hours.length; index++)
        {
            expect(hours[index] - hours[index - 1]).toBe(3600);
        }
    });

    it('carries the pool row alongside the candles', async () =>
    {
        const detail = await (await testApp().get(`/api/market/pools/${ PAIR_AU }`)).json();
        expect(detail.token0.symbol).toBe('ALPHA');
        expect(detail.reserve0).toBe((40_000n * 10n ** 18n).toString());
        expect(Array.isArray(detail.candles)).toBe(true);
    });
});

describe('transaction feed', () =>
{
    it('filters by account and answers empty for a stranger', async () =>
    {
        const app = testApp();
        expect(await (await app.get(`/api/market/txs?account=${ TRADER }`)).json()).toHaveLength(1);
        const stranger = await app.get('/api/market/txs?account=0x00000000000000000000000000000000000000dd');
        expect(stranger.status).toBe(200);
        expect(await stranger.json()).toEqual([]);
    });

    it('matches an account whatever case it is asked for in', async () =>
    {
        const response = await testApp().get(`/api/market/txs?account=${ TRADER.toUpperCase() }`);
        expect(await response.json()).toHaveLength(1);
    });

    it('answers an empty list, not an error, for hostile filter values', async () =>
    {
        const app = testApp();
        const payloads = ["' OR 1=1 --", '"; DROP TABLE events; --', '../../etc/passwd', '<script>alert(1)</script>', '\u0000'];
        for (const payload of payloads)
        {
            const response = await app.get(`/api/market/txs?account=${ encodeURIComponent(payload) }`);
            expect(response.status, payload).toBe(200);
            expect(await response.json(), payload).toEqual([]);
        }
        // The feed still works afterwards: nothing was dropped.
        expect(await (await app.get('/api/market/txs')).json()).toHaveLength(1);
    });

    it('ignores query parameters it does not declare', async () =>
    {
        const response = await testApp().get('/api/market/txs?limit=999&order=drop&account=');
        expect(response.status).toBe(200);
        // An empty account is a filter for the empty address, not "no filter".
        expect(await response.json()).toEqual([]);
    });

    it('escapes nothing into the body - the feed is data, not markup', async () =>
    {
        // Symbols come from the chain and can contain anything; the API is JSON,
        // so the guarantee is that they arrive as data and stay strings.
        const app = testApp();
        const body = await (await app.get('/api/market/txs')).json();
        expect(typeof body[0].tokenA.symbol).toBe('string');
        expect(typeof body[0].txHash).toBe('string');
    });
});

describe('indexer lag reporting', () =>
{
    it('reports how far behind the head the index is', async () =>
    {
        const stats = await (await testApp(DEPLOYMENT, { headBlock: 100, indexedBlock: 60 }).get('/api/market/stats')).json();
        expect(stats.blocksBehind).toBe(40);
        expect(stats.indexedBlock).toBe(60);
    });

    // The indexer can read a block the head query has not caught up to yet.
    // A negative lag would render as a banner claiming the future.
    it('never reports a negative lag', async () =>
    {
        const stats = await (await testApp(DEPLOYMENT, { headBlock: 10, indexedBlock: 42 }).get('/api/market/stats')).json();
        expect(stats.blocksBehind).toBe(0);
    });
});

describe('unpriceable and unknown data', () =>
{
    it('names a token the registry has never seen without failing the request', async () =>
    {
        const db = seededDb();
        const GHOST = '0x00000000000000000000000000000000000000e1' as Address;
        db.upsertPair({
            address: '0x00000000000000000000000000000000000000e2' as Address,
            token0: GHOST,
            token1: USDT,
            createdBlock: 9
        });
        const api = createApi({ db, deployment: DEPLOYMENT, swapFeeBps: 25, status: () => ({ headBlock: 1, indexedBlock: 1 }) });
        const app = buildApp({ dev: false, api });
        const response = await app.handle(new Request('http://local/api/market/pools'));
        expect(response.status).toBe(200);
        const pools = await response.json();
        const ghostPool = pools.find((entry: { token0: { address: string } }) => entry.token0.address === GHOST);
        expect(ghostPool.token0.symbol).toBe('???');
        expect(ghostPool.token0.decimals).toBe(18);
        db.close();
    });

    it('serves an empty exchange without inventing numbers', async () =>
    {
        const db = new IndexerDb(':memory:');
        const api = createApi({ db, deployment: DEPLOYMENT, swapFeeBps: 25, status: () => ({ headBlock: 0, indexedBlock: 0 }) });
        const app = buildApp({ dev: false, api });
        const stats = await (await app.handle(new Request('http://local/api/market/stats'))).json();
        expect(stats.pairCount).toBe(0);
        expect(stats.tvlUsd).toBe(0);
        expect(stats.volume24hUsd).toBe(0);
        expect(await (await app.handle(new Request('http://local/api/market/pools'))).json()).toEqual([]);
        expect(await (await app.handle(new Request('http://local/api/market/tokens'))).json()).toEqual([]);
        expect(await (await app.handle(new Request('http://local/api/market/txs'))).json()).toEqual([]);
        db.close();
    });
});
