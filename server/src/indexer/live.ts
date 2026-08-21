// The live indexer: one polling loop drives both historical catch-up and the live
// tail through the same chunked eth_getLogs scan. No filter-based watchers -
// public RPCs drop them; polling is the path that works everywhere.
//
// Restart safety, in order of severity:
// - identity mismatch (different chainId, V2 factory or V3 factory, or the
//   startBlock's hash changed - a re-genesised chain): wipe and re-index from
//   startBlock.
// - cursor beyond head (chain shorter than our cursor): same wipe.
// - cursor block hash mismatch (reorg): rewind REWIND_BLOCKS and rescan; event
//   inserts are idempotent so replay cannot double-count candles.

import type { Logger } from '@azerothjs/logger';
import type { Deployment } from '@nuraswap/shared/deployments';
import { createPublicClient, erc20Abi, http, parseAbi } from 'viem';

import { applyEvent } from './apply.ts';
import { decodeLog } from './decode.ts';
import { readTokenMetadata } from './erc20.ts';
import type { IndexerDb, Address } from './db.ts';
import type { DomainEvent, RawLog } from './decode.ts';

const REWIND_BLOCKS = 64;

// Only the first field is read, but the whole tuple has to be declared for the
// decode to line up.
const V3_POOL_STATE_ABI = parseAbi([
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
]);
// What a concentrated pool is worth, and what it prices at, are two separate
// reads and neither is derivable from the log stream. Its balances move on a
// plain transfer, which emits nothing here; its PRICE lives in slot0 and is not
// a ratio of those balances - where the liquidity sits decides what it holds.
// Both are read on their own beat rather than the log scan's: they move with
// trades, not blocks, and re-reading every 3s spends RPC calls to learn nothing.
const V3_STATE_MS = 15_000;

export interface IndexerOptions
{
    db: IndexerDb;
    deployment: Deployment;
    log: Logger;
    pollingIntervalMs: number;
    confirmations: number;
}

export interface RunningIndexer
{
    status: () => { headBlock: number; indexedBlock: number };
    stop: () => void;
}

export function startIndexer(options: IndexerOptions): RunningIndexer
{
    const { db, deployment, log } = options;
    const client = createPublicClient({ transport: http(deployment.rpcUrl) });
    const factory = deployment.contracts.factory.toLowerCase() as Address;
    // V3 is optional all the way down: a deployment artifact without a `v3` block
    // means this chain carries the V2 factory alone, and every V3 branch below
    // simply never runs. No zero address, no empty scan.
    const v3Factory = (deployment.v3?.factory.toLowerCase() ?? null) as Address | null;

    let headBlock = 0;
    let indexedBlock = 0;
    let v3StateAt = 0;
    let chunkSize = 2000;
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;

    async function registerToken(address: Address): Promise<void>
    {
        if (db.getToken(address) !== null)
        {
            return;
        }
        db.upsertToken({ address, ...await readTokenMetadata(client, address) });
    }

    async function fetchLogs(fromBlock: bigint, toBlock: bigint, addresses: Address[]): Promise<RawLog[]>
    {
        const logs = await client.getLogs({ fromBlock, toBlock, address: addresses });
        return (logs as unknown as RawLog[])
            .slice()
            .sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
    }

    async function applyChunk(fromBlock: bigint, toBlock: bigint): Promise<void>
    {
        const known = [
            ...db.listPairs().map((pair) => pair.address),
            ...db.listV3Pools().map((pool) => pool.address)
        ];
        const factories = v3Factory === null ? [factory] : [factory, v3Factory];
        let logs = await fetchLogs(fromBlock, toBlock, [...factories, ...known]);

        // Pools born inside this chunk emitted their first events before we knew
        // their address - fetch those too, then apply everything in chain order.
        const born: Address[] = [];
        for (const rawLog of logs)
        {
            const event = decodeLog(rawLog, factory, v3Factory);
            if (event?.kind === 'pairCreated' || event?.kind === 'poolCreated')
            {
                born.push(event.kind === 'pairCreated' ? event.pair : event.pool);
                await registerToken(event.token0);
                await registerToken(event.token1);
            }
        }
        if (born.length > 0)
        {
            const extra = await fetchLogs(fromBlock, toBlock, born);
            logs = [...logs, ...extra].sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
        }

        const timestamps = new Map<number, number>();
        for (const rawLog of logs)
        {
            const blockNumber = Number(rawLog.blockNumber);
            if (!timestamps.has(blockNumber))
            {
                const block = await client.getBlock({ blockNumber: rawLog.blockNumber });
                timestamps.set(blockNumber, Number(block.timestamp));
            }
        }

        // Neither protocol names the depositor in its liquidity events. V2's Mint
        // carries only `sender`, the ROUTER; V3's Mint and Burn both carry `owner`,
        // which is the POSITION MANAGER for every position it custodies. The
        // truthful account is the transaction sender; resolve it here, where the
        // client lives, cached per tx hash. A V2 Burn is left alone - it names its
        // withdrawal recipient in `to`.
        const txSenders = new Map<string, Address>();
        const senderOf = async (txHash: `0x${ string }`): Promise<Address> =>
        {
            const cached = txSenders.get(txHash);
            if (cached !== undefined)
            {
                return cached;
            }
            const from = (await client.getTransaction({ hash: txHash })).from.toLowerCase() as Address;
            txSenders.set(txHash, from);
            return from;
        };

        for (const rawLog of logs)
        {
            const event: DomainEvent | null = decodeLog(rawLog, factory, v3Factory);
            if (event === null)
            {
                continue;
            }
            if (event.kind === 'mint' || (event.kind === 'burn' && event.protocol === 'v3'))
            {
                event.account = await senderOf(event.txHash);
            }
            applyEvent(db, event, {
                timestampOf: (blockNumber) => timestamps.get(blockNumber) ?? 0,
                decimalsOf: (address) => db.getToken(address)?.decimals ?? 18
            });
        }
    }

    // Reads every V3 pool's balances and its slot0 price into storage, so the API
    // can answer TVL and pricing questions out of sqlite synchronously like every
    // other figure it serves. A pool that cannot be read keeps the last state
    // that could be: a momentary RPC failure should not blank its TVL.
    async function refreshV3Pools(now: number): Promise<void>
    {
        const pools = db.listV3Pools();
        if (pools.length === 0 || now - v3StateAt < V3_STATE_MS)
        {
            return;
        }
        v3StateAt = now;
        for (const pool of pools)
        {
            try
            {
                const [balance0, balance1, slot0] = await Promise.all([
                    client.readContract({
                        address: pool.token0,
                        abi: erc20Abi,
                        functionName: 'balanceOf',
                        args: [pool.address]
                    }),
                    client.readContract({
                        address: pool.token1,
                        abi: erc20Abi,
                        functionName: 'balanceOf',
                        args: [pool.address]
                    }),
                    client.readContract({
                        address: pool.address,
                        abi: V3_POOL_STATE_ABI,
                        functionName: 'slot0'
                    })
                ]);
                db.updateV3Balances(pool.address, balance0, balance1);
                db.updateV3Price(pool.address, slot0[0]);
            }
            catch (error)
            {
                log.warn('v3 pool state unreadable - keeping the last one', {
                    pool: pool.address,
                    error: String(error).split('\n')[0]
                });
            }
        }
    }

    async function ensureIdentity(): Promise<bigint>
    {
        // The V3 factory belongs in the identity, not beside it. A database
        // filled before this chain carried V3 holds a COMPLETE V2 history and an
        // empty V3 one, and a resumed cursor only ever moves forward - nothing
        // would fill that gap, and the portfolio would show half a story with no
        // sign that the other half is missing. One reindex buys a whole feed.
        //
        // A V2-only chain keeps its old stamp, so it does not reindex for a
        // feature it does not have.
        const identity = v3Factory === null
            ? `${ deployment.chainId }:${ factory }`
            : `${ deployment.chainId }:${ factory }:${ v3Factory }`;
        const startBlock = await client.getBlock({ blockNumber: BigInt(deployment.startBlock) });
        const stamp = `${ identity }:${ startBlock.hash }`;
        if (db.getMeta('identity') !== stamp)
        {
            log.info('chain identity changed - reindexing from scratch', { stamp });
            db.wipe();
            db.setMeta('identity', stamp);
            for (const token of deployment.tokens)
            {
                db.upsertToken({ ...token, address: token.address.toLowerCase() as Address });
            }
            return BigInt(deployment.startBlock);
        }

        const cursorRaw = db.getMeta('cursor');
        if (cursorRaw === null)
        {
            return BigInt(deployment.startBlock);
        }
        const cursor = BigInt(cursorRaw);
        const head = await client.getBlockNumber();
        if (cursor > head)
        {
            log.warn('cursor beyond head - chain reset without identity change, reindexing', {
                cursor: Number(cursor),
                head: Number(head)
            });
            db.wipe();
            db.setMeta('identity', stamp);
            for (const token of deployment.tokens)
            {
                db.upsertToken({ ...token, address: token.address.toLowerCase() as Address });
            }
            return BigInt(deployment.startBlock);
        }
        const cursorHash = db.getMeta('cursorHash');
        if (cursorHash !== null)
        {
            const block = await client.getBlock({ blockNumber: cursor });
            if (block.hash !== cursorHash)
            {
                const rewound = cursor > BigInt(REWIND_BLOCKS) ? cursor - BigInt(REWIND_BLOCKS) : BigInt(deployment.startBlock);
                log.warn('cursor hash mismatch (reorg) - rewinding', { cursor: Number(cursor), rewound: Number(rewound) });
                return rewound;
            }
        }
        return cursor + 1n;
    }

    async function scanTo(target: bigint, from: bigint): Promise<bigint>
    {
        let cursor = from;
        while (cursor <= target && !stopped)
        {
            const end = cursor + BigInt(chunkSize) - 1n > target ? target : cursor + BigInt(chunkSize) - 1n;
            try
            {
                await applyChunk(cursor, end);
                const endBlock = await client.getBlock({ blockNumber: end });
                db.setMeta('cursor', end.toString());
                db.setMeta('cursorHash', endBlock.hash ?? '');
                indexedBlock = Number(end);
                cursor = end + 1n;
                chunkSize = Math.min(5000, Math.ceil(chunkSize * 3 / 2));
            }
            catch (error)
            {
                if (chunkSize <= 50)
                {
                    throw error;
                }
                chunkSize = Math.max(50, Math.floor(chunkSize / 2));
                log.warn('log scan chunk failed - halving chunk size', { chunkSize, error: String(error) });
            }
        }
        return cursor;
    }

    async function loop(): Promise<void>
    {
        let from = await ensureIdentity();
        indexedBlock = Number(from) - 1;
        while (!stopped)
        {
            try
            {
                const head = await client.getBlockNumber();
                headBlock = Number(head);
                if (head < BigInt(indexedBlock))
                {
                    // The chain got SHORTER under us - a fresh local node. Re-run
                    // the identity check; it wipes and restarts the scan.
                    from = await ensureIdentity();
                    indexedBlock = Number(from) - 1;
                    continue;
                }
                const target = head - BigInt(options.confirmations);
                if (target >= from)
                {
                    from = await scanTo(target, from);
                }
                await refreshV3Pools(Date.now());
            }
            catch (error)
            {
                log.warn('indexer poll failed - retrying next tick', { error: String(error) });
            }
            if (!stopped)
            {
                await new Promise<void>((resolve) =>
                {
                    timer = setTimeout(resolve, options.pollingIntervalMs);
                });
            }
        }
    }

    void loop().catch((error) =>
    {
        log.error('indexer loop died', { error });
    });

    return {
        status: () => ({ headBlock, indexedBlock }),
        stop: () =>
        {
            stopped = true;
            if (timer !== null)
            {
                clearTimeout(timer);
            }
        }
    };
}
