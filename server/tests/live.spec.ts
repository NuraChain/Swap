// The live indexer driven end to end against a scripted chain: real logs, real
// decoding, real SQLite - only the RPC transport is replaced. This is the module
// with the most states and the least visibility in production, and every one of
// its restart paths silently rewrites what the whole app believes about the
// market, so each is pinned here.
//
// Time is faked, so nothing sleeps: `settle` advances the clock a poll at a time
// until the indexer reaches the asserted state, or fails loudly after a bounded
// number of polls rather than hanging.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeChain } from './fake-chain.ts';
import { IndexerDb } from '../src/indexer/db.ts';
import { startIndexer } from '../src/indexer/live.ts';
import type { Deployment } from '@nuraswap/shared/deployments';
import type { Address } from '../src/indexer/db.ts';

const FACTORY = '0x00000000000000000000000000000000000000f0' as Address;
const PAIR = '0x00000000000000000000000000000000000000aa' as Address;
const PAIR_TWO = '0x00000000000000000000000000000000000000ab' as Address;
const NURA = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const ROUTER = '0x00000000000000000000000000000000000000f1' as Address;
const ALICE = '0x00000000000000000000000000000000000000c1' as Address;
const BOB = '0x00000000000000000000000000000000000000c2' as Address;

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
            factory: FACTORY,
            router: ROUTER,
            wnura: NURA,
            multicall3: '0x00000000000000000000000000000000000000f2'
        },
        tokens: DEPLOYMENT_TOKENS
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

const running: Array<{ stop: () => void }> = [];

function run(db: IndexerDb, log: never, overrides: { startBlock?: number; confirmations?: number } = {}): {
    status: () => { headBlock: number; indexedBlock: number };
    stop: () => void;
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
async function settle(ready: () => boolean, polls = 60): Promise<void>
{
    for (let step = 0; step < polls; step++)
    {
        if (ready())
        {
            return;
        }
        await vi.advanceTimersByTimeAsync(POLL_MS);
    }
    if (!ready())
    {
        throw new Error(`the indexer never reached the expected state within ${ polls } polls`);
    }
}

const dbs: IndexerDb[] = [];

function freshDb(): IndexerDb
{
    const db = new IndexerDb(':memory:');
    dbs.push(db);
    return db;
}

beforeEach(() =>
{
    vi.useFakeTimers();
    chain = new FakeChain(12);
    chain.addToken(NURA, { symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 });
    chain.addToken(USDT, { symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 });
});

afterEach(() =>
{
    while (running.length > 0)
    {
        running.pop()?.stop();
    }
    vi.useRealTimers();
    while (dbs.length > 0)
    {
        dbs.pop()?.close();
    }
});

/** A pool created at block 2 that syncs and trades at block 3. */
function scriptOnePool(): void
{
    chain.pairCreated({ factory: FACTORY, pair: PAIR, token0: NURA, token1: USDT, blockNumber: 2, logIndex: 0 });
    chain.sync({ pair: PAIR, reserve0: 40_000n * 10n ** 18n, reserve1: 100_000n * 10n ** 6n, blockNumber: 3, logIndex: 0 });
    chain.swap({
        pair: PAIR,
        sender: ROUTER,
        to: ALICE,
        amount0In: 100n * 10n ** 18n,
        amount1In: 0n,
        amount0Out: 0n,
        amount1Out: 248n * 10n ** 6n,
        blockNumber: 3,
        logIndex: 1
    });
}

describe('first run', () =>
{
    it('stamps identity, seeds the artifact tokens, and indexes to head', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        scriptOnePool();
        const indexer = run(db, log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(db.getMeta('identity')).toBe(`1020:${ FACTORY }:${ chain.blocks[0].hash }`);
        expect(db.getMeta('cursor')).toBe(String(chain.height));
        expect(db.getMeta('cursorHash')).toBe(chain.blocks[chain.height].hash);
        expect(indexer.status().headBlock).toBe(chain.height);
        // The artifact's tokens are seeded before the scan so a pool's first
        // candle has decimals to price with.
        expect(db.getToken(NURA)).not.toBeNull();
        expect(db.getToken(USDT)).not.toBeNull();
    });

    it('applies the pool, its reserves and its trade in chain order', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        scriptOnePool();
        run(db, log);

        await settle(() => db.recentEvents(10).length > 0);

        const pair = db.getPair(PAIR);
        expect(pair?.token0).toBe(NURA);
        expect(pair?.reserve0).toBe(40_000n * 10n ** 18n);
        expect(pair?.reserve1).toBe(100_000n * 10n ** 6n);

        const [trade] = db.recentEvents(10);
        expect(trade.kind).toBe('swap');
        expect(trade.account).toBe(ALICE);
        expect(trade.amount0In).toBe(100n * 10n ** 18n);

        // Sync lands before Swap inside the block, so the candle prices against
        // the reserves the trade actually left behind: 100k USDT / 40k NURA.
        const [candle] = db.candles(PAIR, 0);
        expect(candle.close).toBe(25n * 10n ** 17n);
    });

    it('reads metadata for tokens the artifact never listed', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        const NEW_TOKEN = '0x0000000000000000000000000000000000000009' as Address;
        chain.addToken(NEW_TOKEN, { symbol: 'mDAI', name: 'Mock Dai', decimals: 8 });
        chain.pairCreated({ factory: FACTORY, pair: PAIR, token0: NURA, token1: NEW_TOKEN, blockNumber: 2, logIndex: 0 });
        run(db, log);

        await settle(() => db.getToken(NEW_TOKEN) !== null);

        expect(db.getToken(NEW_TOKEN)).toEqual({
            address: NEW_TOKEN,
            symbol: 'mDAI',
            name: 'Mock Dai',
            decimals: 8
        });
    });

    it('keeps a token whose contract answers nothing, as the unknown placeholder', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        const SILENT = '0x000000000000000000000000000000000000000a' as Address;
        chain.unreadableTokens.add(SILENT);
        chain.pairCreated({ factory: FACTORY, pair: PAIR, token0: NURA, token1: SILENT, blockNumber: 2, logIndex: 0 });
        run(db, log);

        await settle(() => db.getToken(SILENT) !== null);

        // Registered rather than skipped: an unnamed token still has a pool, and
        // dropping it here would drop the pool from every list downstream.
        expect(db.getToken(SILENT)?.symbol).toBe('???');
        expect(db.getToken(SILENT)?.decimals).toBe(18);
    });

    it('ignores a foreign log sitting on a watched address', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        scriptOnePool();
        chain.foreignLog(PAIR, 4, 0);
        const indexer = run(db, log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(db.recentEvents(10)).toHaveLength(1);
    });

    it('sorts the node output before applying it', async () =>
    {
        // FakeChain hands logs back reversed on purpose. Applied in that order the
        // Swap would price against reserves the Sync had not written yet.
        const db = freshDb();
        const { log } = fakeLogger();
        scriptOnePool();
        run(db, log);

        await settle(() => db.candles(PAIR, 0).length > 0);

        expect(db.candles(PAIR, 0)[0].close).toBe(25n * 10n ** 17n);
    });
});

describe('pairs born mid-chunk', () =>
{
    // The first scan of a chunk watches the factory and the pairs already known.
    // A pool created inside that same chunk emitted its Sync and Swap from an
    // address nobody was watching yet - without the second fetch its opening
    // trades are lost forever, because the cursor moves past them.
    it('backfills the logs of a pair created inside the same chunk', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        chain.pairCreated({ factory: FACTORY, pair: PAIR, token0: NURA, token1: USDT, blockNumber: 2, logIndex: 0 });
        chain.sync({ pair: PAIR, reserve0: 1000n * 10n ** 18n, reserve1: 2000n * 10n ** 6n, blockNumber: 2, logIndex: 1 });
        chain.swap({
            pair: PAIR,
            sender: ROUTER,
            to: ALICE,
            amount0In: 10n ** 18n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 2n * 10n ** 6n,
            blockNumber: 2,
            logIndex: 2
        });
        const indexer = run(db, log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(db.getPair(PAIR)?.reserve0).toBe(1000n * 10n ** 18n);
        expect(db.recentEvents(10)).toHaveLength(1);
        expect(db.candles(PAIR, 0)).toHaveLength(1);
    });

    it('handles several pairs created in one chunk', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        chain.pairCreated({ factory: FACTORY, pair: PAIR, token0: NURA, token1: USDT, blockNumber: 2, logIndex: 0 });
        chain.pairCreated({ factory: FACTORY, pair: PAIR_TWO, token0: USDT, token1: NURA, blockNumber: 2, logIndex: 1 });
        chain.sync({ pair: PAIR_TWO, reserve0: 5n, reserve1: 6n, blockNumber: 3, logIndex: 0 });
        const indexer = run(db, log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(db.listPairs()).toHaveLength(2);
        expect(db.getPair(PAIR_TWO)?.reserve1).toBe(6n);
    });
});

describe('mint accounting', () =>
{
    // UniswapV2's Mint event names only `sender`, which is the ROUTER. Storing
    // that would file every deposit on the chain under one address, and the
    // portfolio's "your activity" would show a stranger's liquidity as yours.
    it('files a mint under the transaction sender, not the router', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        chain.pairCreated({ factory: FACTORY, pair: PAIR, token0: NURA, token1: USDT, blockNumber: 2, logIndex: 0 });
        chain.txFrom.set('0xdep', BOB);
        chain.mint({
            pair: PAIR,
            sender: ROUTER,
            amount0: 10n,
            amount1: 20n,
            blockNumber: 3,
            logIndex: 0,
            txHash: '0xdep'
        });
        run(db, log);

        await settle(() => db.recentEvents(10).length > 0);

        const [deposit] = db.recentEvents(10);
        expect(deposit.kind).toBe('mint');
        expect(deposit.account).toBe(BOB);
        expect(deposit.account).not.toBe(ROUTER);
        expect(deposit.amount0In).toBe(10n);
        expect(deposit.amount1In).toBe(20n);
    });

    it('keeps a burn filed under its withdrawal recipient', async () =>
    {
        // Burn carries `to`, so the decoder already has the truth and the live
        // indexer must not override it with the transaction sender.
        const db = freshDb();
        const { log } = fakeLogger();
        chain.pairCreated({ factory: FACTORY, pair: PAIR, token0: NURA, token1: USDT, blockNumber: 2, logIndex: 0 });
        chain.burn({
            pair: PAIR,
            sender: ROUTER,
            to: ALICE,
            amount0: 1n,
            amount1: 2n,
            blockNumber: 3,
            logIndex: 0,
            txHash: '0xwit'
        });
        run(db, log);

        await settle(() => db.recentEvents(10).length > 0);

        expect(db.recentEvents(10)[0].account).toBe(ALICE);
    });
});

describe('restart safety', () =>
{
    it('resumes from the stored cursor without wiping what is already indexed', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        scriptOnePool();
        const first = run(db, log);
        await settle(() => first.status().indexedBlock >= chain.height);
        first.stop();
        const cursorAfterFirst = db.getMeta('cursor');

        // New trade appears, then the process restarts against the same database.
        chain.extendTo(chain.height + 2);
        chain.swap({
            pair: PAIR,
            sender: ROUTER,
            to: BOB,
            amount0In: 0n,
            amount1In: 10n ** 6n,
            amount0Out: 10n ** 17n,
            amount1Out: 0n,
            blockNumber: chain.height,
            logIndex: 0
        });
        const second = run(db, log);
        await settle(() => db.recentEvents(10).length === 2);

        expect(db.getMeta('identity')).not.toBeNull();
        expect(Number(db.getMeta('cursor'))).toBeGreaterThan(Number(cursorAfterFirst));
        // Nothing was wiped: the first run's trade is still there.
        expect(db.recentEvents(10).map((row) => row.account).sort()).toEqual([ALICE, BOB].sort());
        second.stop();
    });

    it('wipes and re-indexes when the chain identity changes', async () =>
    {
        const db = freshDb();
        const { log, lines } = fakeLogger();
        scriptOnePool();
        const first = run(db, log);
        await settle(() => first.status().indexedBlock >= chain.height);
        first.stop();
        expect(db.recentEvents(10)).toHaveLength(1);

        // The node was re-genesised: same heights, different hashes.
        chain.regenesis();
        const second = run(db, log);
        await settle(() => db.getMeta('identity') === `1020:${ FACTORY }:${ chain.blocks[0].hash }`);

        expect(lines.some((line) => line.message.includes('chain identity changed'))).toBe(true);
        // Re-indexed rather than merged: exactly one copy of the same trade.
        await settle(() => db.recentEvents(10).length === 1);
        second.stop();
    });

    it('wipes when the cursor points past the head - a chain reset', async () =>
    {
        const db = freshDb();
        const { log, lines } = fakeLogger();
        scriptOnePool();
        // Identity matches, but the cursor claims a block the chain does not have.
        db.setMeta('identity', `1020:${ FACTORY }:${ chain.blocks[0].hash }`);
        db.setMeta('cursor', '9999');
        db.upsertPair({ address: PAIR_TWO, token0: NURA, token1: USDT, createdBlock: 4242 });

        const indexer = run(db, log);
        await settle(() => lines.some((line) => line.message.includes('cursor beyond head')));
        await settle(() => indexer.status().indexedBlock >= chain.height);

        // The phantom pair from the old chain is gone; the real one is indexed.
        expect(db.getPair(PAIR_TWO)).toBeNull();
        expect(db.getPair(PAIR)).not.toBeNull();
    });

    it('rewinds and rescans when the cursor block hash no longer matches', async () =>
    {
        const db = freshDb();
        const { log, lines } = fakeLogger();
        scriptOnePool();
        const first = run(db, log);
        await settle(() => first.status().indexedBlock >= chain.height);
        first.stop();

        // A reorg rewrote the block the cursor sits on.
        chain.rewriteBlock(chain.height);
        const before = chain.getLogsCalls.length;
        const second = run(db, log);
        await settle(() => lines.some((line) => line.message.includes('cursor hash mismatch')));
        await settle(() => chain.getLogsCalls.length > before);

        // The rescan replays the tail, and idempotent inserts keep it at one
        // trade and one candle rather than double-counting the volume.
        await settle(() => second.status().indexedBlock >= chain.height);
        expect(db.recentEvents(10)).toHaveLength(1);
        expect(db.candles(PAIR, 0)[0].volume0).toBe(100n * 10n ** 18n);
        second.stop();
    });

    it('rewinds no further back than the deployment start block', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        scriptOnePool();
        const first = run(db, log, { startBlock: 1 });
        await settle(() => first.status().indexedBlock >= chain.height);
        first.stop();

        chain.rewriteBlock(chain.height);
        chain.getLogsCalls.length = 0;
        const second = run(db, log, { startBlock: 1 });
        await settle(() => chain.getLogsCalls.length > 0);

        // The cursor is far below REWIND_BLOCKS, so the rewind clamps to the
        // start block instead of asking the node for a negative range.
        expect(chain.getLogsCalls[0].fromBlock).toBe(1n);
        second.stop();
    });

    it('re-runs the identity check when the chain gets shorter mid-run', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        scriptOnePool();
        const indexer = run(db, log);
        await settle(() => indexer.status().indexedBlock >= chain.height);

        // A fresh local node replaces the one we were following.
        chain.blocks = chain.blocks.slice(0, 4);
        chain.regenesis();
        await settle(() => indexer.status().indexedBlock <= chain.height);

        expect(db.getMeta('identity')).toBe(`1020:${ FACTORY }:${ chain.blocks[0].hash }`);
    });
});

describe('resilience', () =>
{
    it('halves the chunk size on a failed scan and still finishes', async () =>
    {
        const db = freshDb();
        const { log, lines } = fakeLogger();
        scriptOnePool();
        chain.failGetLogs = 1;
        const indexer = run(db, log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(lines.some((line) => line.message.includes('halving chunk size'))).toBe(true);
        // The retry covered the same ground: the trade is indexed exactly once.
        expect(db.recentEvents(10)).toHaveLength(1);
    });

    it('survives a poll whose head read fails and catches up on the next tick', async () =>
    {
        const db = freshDb();
        const { log, lines } = fakeLogger();
        scriptOnePool();
        chain.failHead = 1;
        const indexer = run(db, log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        expect(lines.some((line) => line.message.includes('indexer poll failed'))).toBe(true);
        expect(db.recentEvents(10)).toHaveLength(1);
    });

    it('honours the confirmation cushion', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        scriptOnePool();
        const indexer = run(db, log, { confirmations: 3 });

        await settle(() => indexer.status().indexedBlock >= chain.height - 3);

        // Never past head - confirmations.
        expect(indexer.status().indexedBlock).toBeLessThanOrEqual(chain.height - 3);
    });

    it('stops scanning once stop() is called', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        scriptOnePool();
        const indexer = run(db, log);
        await settle(() => indexer.status().indexedBlock >= chain.height);

        indexer.stop();
        const callsAtStop = chain.getLogsCalls.length;
        chain.extendTo(chain.height + 5);
        chain.swap({
            pair: PAIR,
            sender: ROUTER,
            to: BOB,
            amount0In: 1n,
            amount1In: 0n,
            amount0Out: 0n,
            amount1Out: 1n,
            blockNumber: chain.height,
            logIndex: 0
        });
        await vi.advanceTimersByTimeAsync(POLL_MS * 10);

        expect(chain.getLogsCalls.length).toBe(callsAtStop);
        expect(db.recentEvents(10)).toHaveLength(1);
    });

    it('reports head and indexed height so the API can say how far behind it is', async () =>
    {
        const db = freshDb();
        const { log } = fakeLogger();
        const indexer = run(db, log);

        await settle(() => indexer.status().indexedBlock >= chain.height);

        const status = indexer.status();
        expect(status.headBlock).toBe(chain.height);
        expect(status.headBlock - status.indexedBlock).toBe(0);
    });
});
