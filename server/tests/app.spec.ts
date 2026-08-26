// The market API exercised the template way: pure app.handle(new Request(...)),
// no sockets, over a seeded in-memory database.

import type { Deployment } from '@nuraswap/shared/deployments';
import { WAD } from '@nuraswap/shared/math';
import { priceWadFromSqrtX96, sqrtX96FromPriceWad } from '@nuraswap/shared/v3-math';
import { describe, expect, it } from 'vitest';

import { buildApp, createApi } from '../src/app.ts';
import { applyEvent } from '../src/indexer/apply.ts';
import { feeAprBps } from '../src/indexer/pricing.ts';
import { IndexerDb } from '../src/indexer/db.ts';
import type { ApplyContext } from '../src/indexer/apply.ts';
import type { Address } from '../src/indexer/db.ts';

const WNURA = '0x000000000000000000000000000000000000b0b0' as Address;
const ALPHA = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const POOL_AU = '0x00000000000000000000000000000000000000aa' as Address;
const POOL_WU = '0x00000000000000000000000000000000000000bb' as Address;
const TRADER = '0x00000000000000000000000000000000000000cc' as Address;

// Q64.96 encodings of the pools' rates: ALPHA/USDT at 2.50, WNURA/USDT at 850.
const SQRT_AU = sqrtX96FromPriceWad(25n * 10n ** 17n, 18, 6);
const SQRT_WU = sqrtX96FromPriceWad(850n * WAD, 18, 6);

const DEPLOYMENT: Deployment = {
    chainId: 1020,
    networkName: 'Nura Chain',
    rpcUrl: 'https://rpc.nurachain.net',
    explorerUrl: null,
    faucet: false,
    startBlock: 0,
    contracts:
    {
        wnura: WNURA,
        multicall3: '0x00000000000000000000000000000000000000f2'
    },
    tokens: [
        { address: ALPHA, symbol: 'ALPHA', name: 'Nura', decimals: 18 },
        { address: WNURA, symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 },
        { address: USDT, symbol: 'USDT', name: 'Tether USD', decimals: 6 }
    ],
    v3:
    {
        factory: '0x0000000000000000000000000000000000000031',
        swapRouter: '0x0000000000000000000000000000000000000032',
        quoter: '0x0000000000000000000000000000000000000033',
        positionManager: '0x0000000000000000000000000000000000000034',
        tickLens: '0x0000000000000000000000000000000000000035'
    }
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
    // ALPHA/USDT at $2.50 and WNURA/USDT at $850. What each pool HOLDS stands in
    // for its TVL - a concentrated pool has no reserves to derive one from - and
    // its slot0 price is what the price graph and candles are built from.
    applyEvent(db, { kind: 'poolCreated', pool: POOL_AU, token0: ALPHA, token1: USDT, fee: 500, blockNumber: 5 }, context);
    db.updateV3Balances(POOL_AU, 40_000n * 10n ** 18n, 100_000n * 10n ** 6n);
    db.updateV3Price(POOL_AU, SQRT_AU);
    applyEvent(db, { kind: 'poolCreated', pool: POOL_WU, token0: WNURA, token1: USDT, fee: 500, blockNumber: 6 }, context);
    db.updateV3Balances(POOL_WU, 1000n * 10n ** 18n, 850_000n * 10n ** 6n);
    db.updateV3Price(POOL_WU, SQRT_WU);
    applyEvent(db, {
        kind: 'swap',
        pair: POOL_AU,
        blockNumber: 7,
        logIndex: 1,
        txHash: '0xaaa',
        account: TRADER,
        amount0In: 100n * 10n ** 18n,
        amount1In: 0n,
        amount0Out: 0n,
        amount1Out: 248n * 10n ** 6n,
        sqrtPriceX96: SQRT_AU
    }, context);
    return db;
}

function testApp(
    status = { headBlock: 12, indexedBlock: 10 },
    externalPrices: ReadonlyMap<string, bigint> = new Map()
)
{
    const db = seededDb();
    const api = createApi({ db, deployment: DEPLOYMENT, externalPrices: () => externalPrices, status: () => status });
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
    `/api/market/pools/${ POOL_AU }`,
    '/api/market/tokens',
    '/api/market/txs',
    '/api/market/deployment',
    '/api/healthz',
    '/api/_manifest'
];

describe('market api', () =>
{
    it('GET /api/market/stats aggregates TVL, volume, and indexer lag', async () =>
    {
        const response = await testApp().get('/api/market/stats');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.chainId).toBe(1020);
        expect(body.poolCount).toBe(2);
        // TVL counts the ANCHORED side only: the USDT in each pool, 100k + 850k.
        // The ALPHA and WNURA halves are priced BY these pools, and a pool that
        // vouches for its own contents doubles every figure it appears in.
        expect(body.tvlUsd).toBeCloseTo(950_000, 0);
        expect(body.volume24hUsd).toBeGreaterThan(0);
        expect(body.blocksBehind).toBe(2);
    });

    it('lets the external feed price a bridged token, but never the stable', async () =>
    {
        const app = testApp({ headBlock: 12, indexedBlock: 10 }, new Map([
            // A bridged asset is worth what it bridges, so the feed OUTRANKS what a
            // local pool implies about it - that pool is the thin one, not the feed.
            ['ALPHA', 999n * WAD],
            // The stable is $1 by definition here. A feed quoting it otherwise
            // would silently relabel every other price on the site.
            ['USDT', 2n * WAD]
        ]));

        const tokens = await (await app.get('/api/market/tokens')).json();
        const bySymbol = Object.fromEntries(
            tokens.map((token: { symbol: string; priceUsd: number }) => [token.symbol, token.priceUsd])
        );
        expect(bySymbol.USDT).toBe(1);
        expect(bySymbol.ALPHA).toBe(999);
    });

    it('GET /api/market/pools lists both pools with prices and APR fields', async () =>
    {
        const response = await testApp().get('/api/market/pools');
        const pools = await response.json();
        expect(pools).toHaveLength(2);
        const alphaPool = pools.find((entry: { address: string }) => entry.address === POOL_AU);
        expect(alphaPool.token0.symbol).toBe('ALPHA');
        // The wire price is the pool's own post-trade price, off its last candle.
        expect(alphaPool.priceWad).toBe(priceWadFromSqrtX96(SQRT_AU, 18, 6).toString());
        // The 100k of USDT it holds. ALPHA is priced by this very pool, so counting
        // that side too would report the pool as twice the size of its real half.
        expect(alphaPool.tvlUsd).toBeCloseTo(100_000, 0);
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
        const detail = await app.get(`/api/market/pools/${ POOL_AU }`);
        expect(detail.status).toBe(200);
        const body = await detail.json();
        expect(body.candles.length).toBeGreaterThan(0);

        const missing = await app.get('/api/market/pools/0x00000000000000000000000000000000000000ee');
        expect(missing.status).toBe(404);
    });

    it('GET /api/market/pools/:address/traded answers the boolean without the candle detail', async () =>
    {
        const app = testApp();
        // The seeded pool has a swap in its history: it has traded.
        const traded = await (await app.get(`/api/market/pools/${ POOL_AU }/traded`)).json();
        expect(traded).toEqual({ traded: true });

        // "Never traded" and "no such pool" are the same answer to the chart
        // that asked - the detail route 404s here, this one says false.
        const quiet = await app.get('/api/market/pools/0x00000000000000000000000000000000000000ee/traded');
        expect(quiet.status).toBe(200);
        expect(await quiet.json()).toEqual({ traded: false });
    });

    it('charts a pool off the sqrtPriceX96 its own swap reported', async () =>
    {
        // A concentrated pool has no reserves, so its balances stand in and its
        // price comes off the sqrtPriceX96 the swap reported - here the encoding
        // of ALPHA/USDT at 2.50 over 18 and 6 decimals.
        const app = testApp();

        const detail = await app.get(`/api/market/pools/${ POOL_AU }`);
        expect(detail.status).toBe(200);
        const body = await detail.json();
        expect(body.token0.symbol).toBe('ALPHA');
        expect(body.token1.symbol).toBe('USDT');
        // Balances where a pair would have put reserves.
        expect(body.reserve0).toBe((40_000n * 10n ** 18n).toString());
        expect(body.reserve1).toBe((100_000n * 10n ** 6n).toString());
        const traded = body.candles.filter((point: { volume0: string }) => point.volume0 !== '0');
        expect(traded).toHaveLength(1);
        expect(traded[0].close).toBe(priceWadFromSqrtX96(SQRT_AU, 18, 6).toString());
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
        // Pool-derived prices round-trip an integer square root, so they land a
        // fraction of a cent off the round rate - asserted to the cent, not the wei.
        expect(bySymbol.WNURA).toBeCloseTo(850, 6);
        expect(bySymbol.ALPHA).toBeCloseTo(2.5, 6);
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
        expect(deployment.contracts.wnura).toBe(DEPLOYMENT.contracts.wnura);
        expect(deployment.v3).toEqual(DEPLOYMENT.v3);
        expect(deployment.explorerUrl).toBeNull();
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
            pools: app.db.listV3Pools().length,
            tokens: app.db.listTokens().length,
            events: app.db.recentEvents(100).length,
            balances: app.db.getV3Pool(POOL_AU)?.balance0
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
            pools: app.db.listV3Pools().length,
            tokens: app.db.listTokens().length,
            events: app.db.recentEvents(100).length,
            balances: app.db.getV3Pool(POOL_AU)?.balance0
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
            const path = entry.path.replace(':address', POOL_AU);
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
        const detail = await (await app.get(`/api/market/pools/${ POOL_AU }`)).json();
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
        expect(Number.isInteger(stats.poolCount)).toBe(true);
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
        expect(Object.keys(deployment.contracts).sort()).toEqual(['multicall3', 'wnura']);
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
        const lower = await app.get(`/api/market/pools/${ POOL_AU }`);
        const upper = await app.get(`/api/market/pools/${ POOL_AU.toUpperCase() }`);
        expect(lower.status).toBe(200);
        expect(upper.status).toBe(200);
        expect((await upper.json()).address).toBe(POOL_AU);
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
        expect((await app.get(`/api/market/pools/${ POOL_AU }`)).status).toBe(200);
    });

    it('returns candles in ascending, gapless hours', async () =>
    {
        const detail = await (await testApp().get(`/api/market/pools/${ POOL_AU }`)).json();
        const hours = detail.candles.map((candle: { hourStart: number }) => candle.hourStart);
        expect(hours.length).toBeGreaterThan(0);
        for (let index = 1; index < hours.length; index++)
        {
            expect(hours[index] - hours[index - 1]).toBe(3600);
        }
    });

    it('carries the pool row alongside the candles', async () =>
    {
        const detail = await (await testApp().get(`/api/market/pools/${ POOL_AU }`)).json();
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
        const stats = await (await testApp({ headBlock: 100, indexedBlock: 60 }).get('/api/market/stats')).json();
        expect(stats.blocksBehind).toBe(40);
        expect(stats.indexedBlock).toBe(60);
    });

    // The indexer can read a block the head query has not caught up to yet.
    // A negative lag would render as a banner claiming the future.
    it('never reports a negative lag', async () =>
    {
        const stats = await (await testApp({ headBlock: 10, indexedBlock: 42 }).get('/api/market/stats')).json();
        expect(stats.blocksBehind).toBe(0);
    });
});

describe('unpriceable and unknown data', () =>
{
    it('names a token the registry has never seen without failing the request', async () =>
    {
        const db = seededDb();
        const GHOST = '0x00000000000000000000000000000000000000e1' as Address;
        db.upsertV3Pool({
            address: '0x00000000000000000000000000000000000000e2' as Address,
            token0: GHOST,
            token1: USDT,
            fee: 3000,
            createdBlock: 9
        });
        const api = createApi({
            db,
            deployment: DEPLOYMENT,
            externalPrices: () => new Map(),
            status: () => ({ headBlock: 1, indexedBlock: 1 })
        });
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
        const api = createApi({
            db,
            deployment: DEPLOYMENT,
            externalPrices: () => new Map(),
            status: () => ({ headBlock: 0, indexedBlock: 0 })
        });
        const app = buildApp({ dev: false, api });
        const stats = await (await app.handle(new Request('http://local/api/market/stats'))).json();
        expect(stats.poolCount).toBe(0);
        expect(stats.tvlUsd).toBe(0);
        expect(stats.volume24hUsd).toBe(0);
        expect(await (await app.handle(new Request('http://local/api/market/pools'))).json()).toEqual([]);
        expect(await (await app.handle(new Request('http://local/api/market/tokens'))).json()).toEqual([]);
        expect(await (await app.handle(new Request('http://local/api/market/txs'))).json()).toEqual([]);
        db.close();
    });
});
