// The live indexer driven end to end against a scripted chain: real logs, real
// decoding, real PostgreSQL (PGlite) - only the RPC transport is replaced. This is the module
// with the most states and the least visibility in production, and every one of
// its restart paths silently rewrites what the whole app believes about the
// market, so each is pinned here.
//
// Time is faked, so nothing sleeps: `settle` advances the clock a poll at a time
// until the indexer reaches the asserted state, or fails loudly after a bounded
// number of polls rather than hanging.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeChain } from './fake-chain.ts';
import { freshDb } from './pg.ts';
import { startIndexer } from '../src/indexer/live.ts';
import type { Deployment } from '@nuraswap/shared/deployments';
import type { Address, IndexerDb } from '../src/indexer/db.ts';

const FACTORY = '0x00000000000000000000000000000000000000f3' as Address;
const POOL = '0x00000000000000000000000000000000000000b3' as Address;
const POOL_TWO = '0x00000000000000000000000000000000000000b4' as Address;
const NURA = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const ROUTER = '0x00000000000000000000000000000000000000f1' as Address;
const MANAGER = '0x00000000000000000000000000000000000000ee' as Address;
const ALICE = '0x00000000000000000000000000000000000000c1' as Address;
const BOB = '0x00000000000000000000000000000000000000c2' as Address;

// The Q64.96 encoding of a 1:1 raw rate.
const SQRT_ONE = 1n << 96n;

const POLL_MS = 50;

let chain: FakeChain;

// Only the transport is mocked. `decodeLog`, `applyEvent`, the price maths and
// the database are the real ones - a mock that replaced those would be a test of
// the mock.
vi.mock('viem', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('viem')>();
    return {
        ...actual,
        createPublicClient: (): unknown => chain.client()
    };
});

// Imported normally: vitest hoists vi.mock above the import graph, so the
// indexer already sees the fake transport by the time this binding resolves.
const DEPLOYMENT_TOKENS = [
    { address: NURA, symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 },
    { address: USDT, symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 }
];

function deploymentShape(startBlock: number): Deployment
{
    return {
        chainId: 1020,
        networkName: 'Nura Chain',
        rpcUrl: 'https://rpc.invalid',
        explorerUrl: null,
        faucet: false,
        startBlock,
        contracts:
        {
            wnura: NURA,
            multicall3: '0x00000000000000000000000000000000000000f2'
        },
        tokens: DEPLOYMENT_TOKENS,
        v3: {
            factory: FACTORY,
            swapRouter: '0x0000000000000000000000000000000000000032' as Address,
            quoter: '0x0000000000000000000000000000000000000033' as Address,
            positionManager: MANAGER,
            tickLens: '0x0000000000000000000000000000000000000035' as Address
        }
    };
}

interface LogLine
{
    level: string;
    message: string;
}

function fakeLogger(): { lines: LogLine[]; log: never }
{
    const lines: LogLine[] = [];
    const record = (level: string) => (message: string): void =>
    {
        lines.push({ level, message });
    };
    return {
        lines,
        log: {
            info: record('info'),
            warn: record('warn'),
            error: record('error'),
            debug: record('debug'),
            trace: record('trace'),
            child: (): unknown => fakeLogger().log
        } as never
    };
}

const running: Array<{ stop: () => Promise<void> }> = [];

function run(
    log: never,
    overrides: { startBlock?: number; confirmations?: number } = {}
): {
    status: () => { headBlock: number; indexedBlock: number };
    stop: () => Promise<void>;
}
{
    const indexer = startIndexer({
        db,
        deployment: deploymentShape(overrides.startBlock ?? 0),
        log,
        pollingIntervalMs: POLL_MS,
        confirmations: overrides.confirmations ?? 0
    });
    running.push(indexer);
    return indexer;
}

/** Advances fake time one poll at a time until `ready`, or fails after `polls`. */
async function settle(ready: () => boolean | Promise<boolean>, polls = 60): Promise<void>
{
    for (let step = 0; step < polls; step++)
    {
        if (await ready())
        {
            return;
        }
        await vi.advanceTimersByTimeAsync(POLL_MS);
    }
    if (!await ready())
    {
        throw new Error(`the indexer never reached the expected state within ${ polls } polls`);
    }
}

// One database per test, opened before the clock is faked: the file shares a
// single PGlite, so a second open would wipe the first.
let db: IndexerDb;

beforeEach(async () =>
{
    db = await freshDb();
    vi.useFakeTimers();
    chain = new FakeChain(12);
    chain.addToken(NURA, { symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 });
    chain.addToken(USDT, { symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 });
});

// Every loop has left its last query before the next test wipes the database.
afterEach(async () =>
{
    while (running.length > 0)
    {
        await running.pop()?.stop();
    }
    vi.useRealTimers();
});

/** A pool created at block 2 that trades at block 3. */
function scriptOnePool(): void
{
    chain.poolCreated({ factory: FACTORY, pool: POOL, token0: NURA, token1: USDT, fee: 500, blockNumber: 2, logIndex: 0 });
    // What the pool holds - read on the indexer's own beat, no event says it.
    chain.setBalance(NURA, POOL, 40_000n * 10n ** 18n);
    chain.setBalance(USDT, POOL, 100_000n * 10n ** 6n);
    chain.setPoolPrice(POOL, SQRT_ONE);
    // The pool takes 100 NURA in and pays 248 mUSDT out.
    chain.swap({
        pool: POOL,
        sender: ROUTER,
        recipient: ALICE,
        amount0: 100n * 10n ** 18n,
        amount1: -248n * 10n ** 6n,
        sqrtPriceX96: SQRT_ONE,
        blockNumber: 3,
        logIndex: 1
    });
}

describe('pool indexing', () =>
{
    it('indexes a pool the factory created and reads what it holds', async () =>
    {
        const { log } = fakeLogger();
        scriptOnePool();

        const indexer = run(log);
        await settle(async () => (await db.getV3Pool(POOL))?.balance0 === 40_000n * 10n ** 18n);

        const pool = await db.getV3Pool(POOL);
        expect(pool?.token0).toBe(NURA);
        expect(pool?.token1).toBe(USDT);
        expect(pool?.fee).toBe(500);
        expect(pool?.balance1).toBe(100_000n * 10n ** 6n);
        // slot0, not a ratio of the balances - 2^96 is the Q64.96 encoding of 1:1.
        expect(pool?.sqrtPriceX96).toBe(SQRT_ONE);
        await indexer.stop();
    });

    it('holds the last readable balances when the RPC stops answering', async () =>
    {
        const { log, lines } = fakeLogger();
        scriptOnePool();

        const indexer = run(log);
        await settle(async () => (await db.getV3Pool(POOL))?.balance0 === 40_000n * 10n ** 18n);

        // Blanking a pool's TVL because one read timed out would be a worse
        // answer than the one from fifteen seconds ago.
        chain.unreadableTokens.add(NURA.toLowerCase());
        // Long enough to outlast the balance beat: balances are read on their own
        // slower timer, not once per log scan, and this waits for the NEXT one.
        await settle(() => lines.some((line) => line.message.includes('state unreadable')), 400);
        expect((await db.getV3Pool(POOL))?.balance0).toBe(40_000n * 10n ** 18n);
        await indexer.stop();
    });

    it('stamps identity, seeds the artifact tokens, and indexes to head', async () =>
    {
        const { log } = fakeLogger();
        scriptOnePool();
        const indexer = run(log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(await db.getMeta('identity')).toBe(`1020:${ FACTORY }:${ chain.blocks[0].hash }`);
        expect(await db.getMeta('cursor')).toBe(String(chain.height));
        expect(await db.getMeta('cursorHash')).toBe(chain.blocks[chain.height].hash);
        expect(indexer.status().headBlock).toBe(chain.height);
        // The artifact's tokens are seeded before the scan so a pool's first
        // candle has decimals to price with.
        expect(await db.getToken(NURA)).not.toBeNull();
        expect(await db.getToken(USDT)).not.toBeNull();
    });

    it('applies the pool and its trade in chain order', async () =>
    {
        const { log } = fakeLogger();
        scriptOnePool();
        run(log);

        await settle(async () => (await db.recentEvents(10)).length > 0);

        const [trade] = await db.recentEvents(10);
        expect(trade.kind).toBe('swap');
        expect(trade.account).toBe(ALICE);
        expect(trade.amount0In).toBe(100n * 10n ** 18n);

        // The swap states its own post-trade price: Q96 over 18dp/6dp decimals
        // is a raw 1:1, i.e. 10^30 in 1e18 fixed point.
        const [candle] = await db.candles(POOL, 0);
        expect(candle.close).toBe(10n ** 30n);
        expect(candle.volume0).toBe(100n * 10n ** 18n);
        expect(candle.volume1).toBe(248n * 10n ** 6n);
    });

    it('reads metadata for tokens the artifact never listed', async () =>
    {
        const { log } = fakeLogger();
        const NEW_TOKEN = '0x0000000000000000000000000000000000000009' as Address;
        chain.addToken(NEW_TOKEN, { symbol: 'mDAI', name: 'Mock Dai', decimals: 8 });
        chain.poolCreated({ factory: FACTORY, pool: POOL, token0: NURA, token1: NEW_TOKEN, fee: 500, blockNumber: 2, logIndex: 0 });
        run(log);

        await settle(async () => await db.getToken(NEW_TOKEN) !== null);

        expect(await db.getToken(NEW_TOKEN)).toEqual({
            address: NEW_TOKEN,
            symbol: 'mDAI',
            name: 'Mock Dai',
            decimals: 8
        });
    });

    it('keeps a token whose contract answers nothing, as the unknown placeholder', async () =>
    {
        const { log } = fakeLogger();
        const SILENT = '0x000000000000000000000000000000000000000a' as Address;
        chain.unreadableTokens.add(SILENT);
        chain.poolCreated({ factory: FACTORY, pool: POOL, token0: NURA, token1: SILENT, fee: 500, blockNumber: 2, logIndex: 0 });
        run(log);

        await settle(async () => await db.getToken(SILENT) !== null);

        // Registered rather than skipped: an unnamed token still has a pool, and
        // dropping it here would drop the pool from every list downstream.
        expect((await db.getToken(SILENT))?.symbol).toBe('???');
        expect((await db.getToken(SILENT))?.decimals).toBe(18);
    });

    it('ignores a foreign log sitting on a watched address', async () =>
    {
        const { log } = fakeLogger();
        scriptOnePool();
        chain.foreignLog(POOL, 4, 0);
        const indexer = run(log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(await db.recentEvents(10)).toHaveLength(1);
    });

    it('sorts the node output before applying it', async () =>
    {
        // FakeChain hands logs back reversed on purpose. The pool must exist and
        // its trade applied after it regardless of the order the node returned.
        const { log } = fakeLogger();
        scriptOnePool();
        run(log);

        await settle(async () => (await db.candles(POOL, 0)).length > 0);

        expect((await db.candles(POOL, 0))[0].close).toBe(10n ** 30n);
    });
});

describe('pools born mid-chunk', () =>
{
    // The first scan of a chunk watches the factory and the pools already known.
    // A pool created inside that same chunk emitted its first events from an
    // address nobody was watching yet - without the second fetch they are lost
    // forever, because the cursor moves past them.
    it('backfills the logs of a pool created inside the same chunk', async () =>
    {
        const { log } = fakeLogger();
        chain.setPoolPrice(POOL, SQRT_ONE);
        chain.poolCreated({ factory: FACTORY, pool: POOL, token0: NURA, token1: USDT, fee: 500, blockNumber: 2, logIndex: 0 });
        chain.swap({
            pool: POOL,
            sender: ROUTER,
            recipient: ALICE,
            amount0: 10n ** 18n,
            amount1: -2n * 10n ** 6n,
            sqrtPriceX96: SQRT_ONE,
            blockNumber: 2,
            logIndex: 1
        });
        const indexer = run(log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect((await db.getV3Pool(POOL))?.token0).toBe(NURA);
        expect(await db.recentEvents(10)).toHaveLength(1);
        expect(await db.candles(POOL, 0)).toHaveLength(1);
    });

    it('handles several pools created in one chunk', async () =>
    {
        const { log } = fakeLogger();
        chain.poolCreated({ factory: FACTORY, pool: POOL, token0: NURA, token1: USDT, fee: 500, blockNumber: 2, logIndex: 0 });
        chain.poolCreated({ factory: FACTORY, pool: POOL_TWO, token0: USDT, token1: NURA, fee: 3000, blockNumber: 2, logIndex: 1 });
        const indexer = run(log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(await db.listV3Pools()).toHaveLength(2);
        expect((await db.getV3Pool(POOL_TWO))?.fee).toBe(3000);
    });
});

describe('liquidity accounting', () =>
{
    // A V3 Mint names `owner`, which for anything custodied by the position
    // manager is the MANAGER. Storing that would file every deposit on the chain
    // under one address, and the portfolio's "your activity" would show a
    // stranger's liquidity as yours.
    it('files a mint under the transaction sender, not the position manager', async () =>
    {
        const { log } = fakeLogger();
        chain.poolCreated({ factory: FACTORY, pool: POOL, token0: NURA, token1: USDT, fee: 500, blockNumber: 2, logIndex: 0 });
        chain.txFrom.set('0xdep', BOB);
        chain.mint({
            pool: POOL,
            owner: MANAGER,
            amount0: 10n,
            amount1: 20n,
            blockNumber: 3,
            logIndex: 0,
            txHash: '0xdep'
        });
        run(log);

        await settle(async () => (await db.recentEvents(10)).length > 0);

        const [deposit] = await db.recentEvents(10);
        expect(deposit.kind).toBe('mint');
        expect(deposit.account).toBe(BOB);
        expect(deposit.account).not.toBe(MANAGER);
        expect(deposit.amount0In).toBe(10n);
        expect(deposit.amount1In).toBe(20n);
    });

    it('files a burn under the transaction sender too', async () =>
    {
        // Same override as the mint: the event's owner is the manager, while the
        // truthful account is whoever signed the withdrawal.
        const { log } = fakeLogger();
        chain.poolCreated({ factory: FACTORY, pool: POOL, token0: NURA, token1: USDT, fee: 500, blockNumber: 2, logIndex: 0 });
        chain.txFrom.set('0xwit', ALICE);
        chain.burn({
            pool: POOL,
            owner: MANAGER,
            amount0: 1n,
            amount1: 2n,
            blockNumber: 3,
            logIndex: 0,
            txHash: '0xwit'
        });
        run(log);

        await settle(async () => (await db.recentEvents(10)).length > 0);

        expect((await db.recentEvents(10))[0].account).toBe(ALICE);
        expect((await db.recentEvents(10))[0].kind).toBe('burn');
    });
});

describe('restart safety', () =>
{
    it('resumes from the stored cursor without wiping what is already indexed', async () =>
    {
        const { log } = fakeLogger();
        scriptOnePool();
        const first = run(log);
        await settle(() => first.status().indexedBlock >= chain.height);
        await first.stop();
        const cursorAfterFirst = await db.getMeta('cursor');

        // New trade appears, then the process restarts against the same database.
        chain.extendTo(chain.height + 2);
        chain.setPoolPrice(POOL, SQRT_ONE * 2n);
        chain.swap({
            pool: POOL,
            sender: ROUTER,
            recipient: BOB,
            amount0: -(10n ** 17n),
            amount1: 10n ** 6n,
            sqrtPriceX96: SQRT_ONE * 2n,
            blockNumber: chain.height,
            logIndex: 0
        });
        const second = run(log);
        await settle(async () => (await db.recentEvents(10)).length === 2);

        expect(await db.getMeta('identity')).not.toBeNull();
        expect(Number(await db.getMeta('cursor'))).toBeGreaterThan(Number(cursorAfterFirst));
        // Nothing was wiped: the first run's trade is still there.
        expect((await db.recentEvents(10)).map((row) => row.account).sort()).toEqual([ALICE, BOB].sort());
        await second.stop();
    });

    it('wipes and re-indexes when the chain identity changes', async () =>
    {
        const { log, lines } = fakeLogger();
        scriptOnePool();
        const first = run(log);
        await settle(() => first.status().indexedBlock >= chain.height);
        await first.stop();
        expect(await db.recentEvents(10)).toHaveLength(1);

        // The node was re-genesised: same heights, different hashes.
        chain.regenesis();
        const second = run(log);
        await settle(async () => await db.getMeta('identity') === `1020:${ FACTORY }:${ chain.blocks[0].hash }`);

        expect(lines.some((line) => line.message.includes('chain identity changed'))).toBe(true);
        // Re-indexed rather than merged: exactly one copy of the same trade.
        await settle(async () => (await db.recentEvents(10)).length === 1);
        await second.stop();
    });

    it('wipes when the cursor points past the head - a chain reset', async () =>
    {
        const { log, lines } = fakeLogger();
        scriptOnePool();
        // Identity matches, but the cursor claims a block the chain does not have.
        await db.setMeta('identity', `1020:${ FACTORY }:${ chain.blocks[0].hash }`);
        await db.setMeta('cursor', '9999');
        await db.upsertV3Pool({ address: POOL_TWO, token0: NURA, token1: USDT, fee: 500, createdBlock: 4242 });

        const indexer = run(log);
        await settle(() => lines.some((line) => line.message.includes('cursor beyond head')));
        await settle(() => indexer.status().indexedBlock >= chain.height);

        // The phantom pool from the old chain is gone; the real one is indexed.
        expect(await db.getV3Pool(POOL_TWO)).toBeNull();
        expect(await db.getV3Pool(POOL)).not.toBeNull();
    });

    it('rewinds and rescans when the cursor block hash no longer matches', async () =>
    {
        const { log, lines } = fakeLogger();
        scriptOnePool();
        const first = run(log);
        await settle(() => first.status().indexedBlock >= chain.height);
        await first.stop();

        // A reorg rewrote the block the cursor sits on.
        chain.rewriteBlock(chain.height);
        const before = chain.getLogsCalls.length;
        const second = run(log);
        await settle(() => lines.some((line) => line.message.includes('cursor hash mismatch')));
        await settle(() => chain.getLogsCalls.length > before);

        // The rescan replays the tail, and idempotent inserts keep it at one
        // trade and one candle rather than double-counting the volume.
        await settle(() => second.status().indexedBlock >= chain.height);
        expect(await db.recentEvents(10)).toHaveLength(1);
        expect((await db.candles(POOL, 0))[0].volume0).toBe(100n * 10n ** 18n);
        await second.stop();
    });

    it('rewinds no further back than the deployment start block', async () =>
    {
        const { log } = fakeLogger();
        scriptOnePool();
        const first = run(log, { startBlock: 1 });
        await settle(() => first.status().indexedBlock >= chain.height);
        await first.stop();

        chain.rewriteBlock(chain.height);
        chain.getLogsCalls.length = 0;
        const second = run(log, { startBlock: 1 });
        await settle(() => chain.getLogsCalls.length > 0);

        // The cursor is far below REWIND_BLOCKS, so the rewind clamps to the
        // start block instead of asking the node for a negative range.
        expect(chain.getLogsCalls[0].fromBlock).toBe(1n);
        await second.stop();
    });

    it('re-runs the identity check when the chain gets shorter mid-run', async () =>
    {
        const { log } = fakeLogger();
        scriptOnePool();
        const indexer = run(log);
        await settle(() => indexer.status().indexedBlock >= chain.height);

        // A fresh local node replaces the one we were following.
        chain.blocks = chain.blocks.slice(0, 4);
        chain.regenesis();
        await settle(() => indexer.status().indexedBlock <= chain.height);

        expect(await db.getMeta('identity')).toBe(`1020:${ FACTORY }:${ chain.blocks[0].hash }`);
    });
});

describe('resilience', () =>
{
    it('halves the chunk size on a failed scan and still finishes', async () =>
    {
        const { log, lines } = fakeLogger();
        scriptOnePool();
        chain.failGetLogs = 1;
        const indexer = run(log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(lines.some((line) => line.message.includes('halving chunk size'))).toBe(true);
        // The retry covered the same ground: the trade is indexed exactly once.
        expect(await db.recentEvents(10)).toHaveLength(1);
    });

    it('survives a poll whose head read fails and catches up on the next tick', async () =>
    {
        const { log, lines } = fakeLogger();
        scriptOnePool();
        chain.failHead = 1;
        const indexer = run(log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(lines.some((line) => line.message.includes('indexer poll failed'))).toBe(true);
        expect(await db.recentEvents(10)).toHaveLength(1);
    });

    it('honours the confirmation cushion', async () =>
    {
        const { log } = fakeLogger();
        scriptOnePool();
        const indexer = run(log, { confirmations: 3 });

        await settle(() => indexer.status().indexedBlock >= chain.height - 3);

        // Never past head - confirmations.
        expect(indexer.status().indexedBlock).toBeLessThanOrEqual(chain.height - 3);
    });

    it('stops scanning once stop() is called', async () =>
    {
        const { log } = fakeLogger();
        scriptOnePool();
        const indexer = run(log);
        await settle(() => indexer.status().indexedBlock >= chain.height);

        await indexer.stop();
        const callsAtStop = chain.getLogsCalls.length;
        chain.extendTo(chain.height + 5);
        chain.swap({
            pool: POOL,
            sender: ROUTER,
            recipient: BOB,
            amount0: 1n,
            amount1: -1n,
            sqrtPriceX96: SQRT_ONE,
            blockNumber: chain.height,
            logIndex: 0
        });
        await vi.advanceTimersByTimeAsync(POLL_MS * 10);

        expect(chain.getLogsCalls.length).toBe(callsAtStop);
        expect(await db.recentEvents(10)).toHaveLength(1);
    });

    it('reports head and indexed height so the API can say how far behind it is', async () =>
    {
        const { log } = fakeLogger();
        const indexer = run(log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        const status = indexer.status();
        expect(status.headBlock).toBe(chain.height);
        expect(status.headBlock - status.indexedBlock).toBe(0);
    });
});
