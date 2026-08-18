// The live indexer: one polling loop drives both historical catch-up and the live
// tail through the same chunked eth_getLogs scan. No filter-based watchers -
// public RPCs drop them; polling is the path that works everywhere.
//
// Restart safety, in order of severity:
// - identity mismatch (different chainId/factory, or the startBlock's hash
//   changed - a re-genesised chain): wipe and re-index from startBlock.
// - cursor beyond head (chain shorter than our cursor): same wipe.
// - cursor block hash mismatch (reorg): rewind REWIND_BLOCKS and rescan; event
//   inserts are idempotent so replay cannot double-count candles.

import type { Logger } from '@azerothjs/logger';
import type { Deployment } from '@nuraswap/shared/deployments';
import { createPublicClient, erc20Abi, http, parseAbi } from 'viem';

import { applyEvent } from './apply.ts';
import { decodeLog } from './decode.ts';
import type { IndexerDb, Address } from './db.ts';
import type { DomainEvent, RawLog } from './decode.ts';

const ERC20_BYTES32_ABI = parseAbi([
    'function symbol() view returns (bytes32)',
    'function name() view returns (bytes32)'
]);

const REWIND_BLOCKS = 64;

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

    let headBlock = 0;
    let indexedBlock = 0;
    let chunkSize = 2000;
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;

    function trimBytes(value: string): string
    {
        return value.replace(/\0+$/, '');
    }

    async function registerToken(address: Address): Promise<void>
    {
        if (db.getToken(address) !== null)
        {
            return;
        }
        let symbol = '???';
        let name = 'Unknown token';
        let decimals = 18;
        try
        {
            decimals = await client.readContract({ address, abi: erc20Abi, functionName: 'decimals' });
        }
        catch
        {
            // No decimals() - keep 18 and mark the token unknown-shaped.
        }
        try
        {
            symbol = await client.readContract({ address, abi: erc20Abi, functionName: 'symbol' });
            name = await client.readContract({ address, abi: erc20Abi, functionName: 'name' });
        }
        catch
        {
            try
            {
                const rawSymbol = await client.readContract({ address, abi: ERC20_BYTES32_ABI, functionName: 'symbol' });
                const rawName = await client.readContract({ address, abi: ERC20_BYTES32_ABI, functionName: 'name' });
                symbol = trimBytes(Buffer.from(rawSymbol.slice(2), 'hex').toString('utf8'));
                name = trimBytes(Buffer.from(rawName.slice(2), 'hex').toString('utf8'));
            }
            catch
            {
                // Neither string nor bytes32 metadata - placeholder stands.
            }
        }
        db.upsertToken({ address, symbol, name, decimals });
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
        const known = db.listPairs().map((pair) => pair.address);
        let logs = await fetchLogs(fromBlock, toBlock, [factory, ...known]);

        // Pairs born inside this chunk emitted their first events before we knew
        // their address - fetch those too, then apply everything in chain order.
        const newPairs: Address[] = [];
        for (const rawLog of logs)
        {
            const event = decodeLog(rawLog, factory);
            if (event?.kind === 'pairCreated')
            {
                newPairs.push(event.pair);
                await registerToken(event.token0);
                await registerToken(event.token1);
            }
        }
        if (newPairs.length > 0)
        {
            const extra = await fetchLogs(fromBlock, toBlock, newPairs);
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

        // UniswapV2's Mint event carries only `sender` - the ROUTER - so a decoded
        // mint never names the depositor. The truthful account is the transaction
        // sender; resolve it here, where the client lives, cached per tx hash.
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
            const event: DomainEvent | null = decodeLog(rawLog, factory);
            if (event === null)
            {
                continue;
            }
            if (event.kind === 'mint')
            {
                event.account = await senderOf(event.txHash);
            }
            applyEvent(db, event, {
                timestampOf: (blockNumber) => timestamps.get(blockNumber) ?? 0,
                decimalsOf: (address) => db.getToken(address)?.decimals ?? 18
            });
        }
    }

    async function ensureIdentity(): Promise<bigint>
    {
        const identity = `${ deployment.chainId }:${ factory }`;
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
