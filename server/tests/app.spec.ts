// The market API exercised the template way: pure app.handle(new Request(...)),
// no sockets, over a seeded in-memory database.

import type { Deployment } from '@nuraswap/shared/deployments';
import { describe, expect, it } from 'vitest';

import { buildApp, createApi } from '../src/app.ts';
import { applyEvent } from '../src/indexer/apply.ts';
import { buildPriceMap } from '../src/indexer/pricing.ts';
import { IndexerDb } from '../src/indexer/db.ts';
import type { ApplyContext } from '../src/indexer/apply.ts';
import type { Address } from '../src/indexer/db.ts';

const WBNB = '0x000000000000000000000000000000000000b0b0' as Address;
const NURA = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const PAIR_NU = '0x00000000000000000000000000000000000000aa' as Address;
const PAIR_WU = '0x00000000000000000000000000000000000000bb' as Address;
const TRADER = '0x00000000000000000000000000000000000000cc' as Address;

const DEPLOYMENT: Deployment = {
    chainId: 31337,
    networkName: 'localhost',
    rpcUrl: 'http://127.0.0.1:8545',
    explorerUrl: null,
    faucet: true,
    startBlock: 0,
    contracts:
    {
        factory: '0x00000000000000000000000000000000000000f0',
        router: '0x00000000000000000000000000000000000000f1',
        wbnb: WBNB,
        multicall3: '0x00000000000000000000000000000000000000f2'
    },
    tokens: [
        { address: NURA, symbol: 'NURA', name: 'Nura', decimals: 18 },
        { address: WBNB, symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18 },
        { address: USDT, symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 }
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
    // NURA/mUSDT at $2.50 and WBNB/mUSDT at $850.
    applyEvent(db, { kind: 'pairCreated', pair: PAIR_NU, token0: NURA, token1: USDT, blockNumber: 5 }, context);
    applyEvent(db, { kind: 'sync', pair: PAIR_NU, reserve0: 40_000n * 10n ** 18n, reserve1: 100_000n * 10n ** 6n }, context);
    applyEvent(db, { kind: 'pairCreated', pair: PAIR_WU, token0: WBNB, token1: USDT, blockNumber: 6 }, context);
    applyEvent(db, { kind: 'sync', pair: PAIR_WU, reserve0: 1000n * 10n ** 18n, reserve1: 850_000n * 10n ** 6n }, context);
    applyEvent(db, {
        kind: 'swap',
        pair: PAIR_NU,
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

function testApp()
{
    const db = seededDb();
    const api = createApi({ db, deployment: DEPLOYMENT, status: () => ({ headBlock: 12, indexedBlock: 10 }) });
    const app = buildApp({ dev: false, api });
    return {
        get: (path: string): Promise<Response> => app.handle(new Request(`http://local${ path }`))
    };
}

describe('buildPriceMap', () =>
{
    it('prices the stable at $1, WBNB through its pool, NURA through its pool', () =>
    {
        const db = seededDb();
        const prices = buildPriceMap(db.listPairs(), db.listTokens(), { stable: USDT, wrappedNative: WBNB });
        expect(prices.get(USDT)).toBe(10n ** 18n);
        expect(prices.get(WBNB)).toBe(850n * 10n ** 18n);
        expect(prices.get(NURA)).toBe(25n * 10n ** 17n);
    });
});

describe('market api', () =>
{
    it('GET /api/market/stats aggregates TVL, volume, and indexer lag', async () =>
    {
        const response = await testApp().get('/api/market/stats');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.chainId).toBe(31337);
        expect(body.pairCount).toBe(2);
        // TVL: NURA pool 100k + 100k, WBNB pool 850k + 850k = 1.9M.
        expect(body.tvlUsd).toBeCloseTo(1_900_000, 0);
        expect(body.volume24hUsd).toBeGreaterThan(0);
        expect(body.blocksBehind).toBe(2);
    });

    it('GET /api/market/pools lists both pools with prices and APR fields', async () =>
    {
        const response = await testApp().get('/api/market/pools');
        const pools = await response.json();
        expect(pools).toHaveLength(2);
        const nuraPool = pools.find((entry: { address: string }) => entry.address === PAIR_NU);
        expect(nuraPool.token0.symbol).toBe('NURA');
        expect(nuraPool.priceWad).toBe((25n * 10n ** 17n).toString());
        expect(nuraPool.tvlUsd).toBeCloseTo(200_000, 0);
        expect(typeof nuraPool.feeAprBps).toBe('number');
    });

    it('GET /api/market/pools/:address returns candles, 404s unknown pools', async () =>
    {
        const app = testApp();
        const detail = await app.get(`/api/market/pools/${ PAIR_NU }`);
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
        expect(txs[0].tokenA.symbol).toBe('NURA');
        expect(txs[0].amountA).toBe((100n * 10n ** 18n).toString());
        expect(txs[0].tokenB.symbol).toBe('mUSDT');
        expect(txs[0].amountB).toBe((248n * 10n ** 6n).toString());
    });

    it('GET /api/market/tokens serves the registry with USD prices', async () =>
    {
        const tokens = await (await testApp().get('/api/market/tokens')).json();
        expect(tokens.map((token: { symbol: string }) => token.symbol).sort()).toEqual(['NURA', 'WBNB', 'mUSDT']);
        const bySymbol = Object.fromEntries(tokens.map((token: { symbol: string; priceUsd: number }) => [token.symbol, token.priceUsd]));
        expect(bySymbol.mUSDT).toBe(1);
        expect(bySymbol.WBNB).toBe(850);
        expect(bySymbol.NURA).toBe(2.5);
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
        expect(deployment.chainId).toBe(31337);
        expect(deployment.contracts.router).toBe(DEPLOYMENT.contracts.router);
        expect(deployment.explorerUrl).toBeNull();
    });

    it('GET /api/healthz still answers', async () =>
    {
        const response = await testApp().get('/api/healthz');
        expect((await response.json()).ok).toBe(true);
    });
});
