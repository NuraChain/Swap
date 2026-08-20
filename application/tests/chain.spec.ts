// Chain access for the browser. Everything the app does on-chain hangs off the
// one deployment fetch here, so the interesting behaviour is not the happy path
// but what happens when that fetch fails - and whether the failure is allowed to
// poison the tab for the rest of the session.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deploymentCall = vi.fn();

vi.mock('../src/api.ts', () => ({
    client: { market: { deployment: deploymentCall } }
}));

type Chain = typeof import('../src/lib/chain.ts');

// Each isolated module instance re-transforms the viem graph, which is slow but
// is the only way to exercise state that lives for the life of a tab.
vi.setConfig({ testTimeout: 30_000 });

const INFO = {
    chainId: 1020,
    networkName: 'Nura Chain',
    rpcUrl: 'https://rpc.nurachain.net',
    explorerUrl: 'https://explorer.nurachain.net',
    faucet: false,
    contracts: {
        factory: '0x00000000000000000000000000000000000000f0',
        router: '0x00000000000000000000000000000000000000f1',
        wnura: '0x00000000000000000000000000000000000000b0',
        multicall3: '0x00000000000000000000000000000000000000f2'
    },
    v3: {
        factory: '0x0000000000000000000000000000000000000031',
        swapRouter: '0x0000000000000000000000000000000000000032',
        quoter: '0x0000000000000000000000000000000000000033',
        positionManager: '0x0000000000000000000000000000000000000034',
        tickLens: '0x0000000000000000000000000000000000000035'
    },
    tokens: [{ address: '0x00000000000000000000000000000000000000b0', symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 }]
};

/** A fresh module: the deployment promise and the client caches are module state. */
async function loadChain(): Promise<Chain>
{
    vi.resetModules();
    return await import('../src/lib/chain.ts');
}

beforeEach(() =>
{
    deploymentCall.mockReset();
});

describe('loading the deployment', () =>
{
    it('reports nothing until the fetch lands, then the served deployment', async () =>
    {
        deploymentCall.mockResolvedValue(INFO);
        const chain = await loadChain();
        expect(chain.deployment()).toBeNull();
        await chain.ensureDeployment();
        expect(chain.deployment()?.chainId).toBe(1020);
    });

    it('costs one request however many callers ask', async () =>
    {
        deploymentCall.mockResolvedValue(INFO);
        const chain = await loadChain();
        await Promise.all([chain.ensureDeployment(), chain.ensureDeployment(), chain.ensureDeployment()]);
        await chain.ensureDeployment();
        expect(deploymentCall).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight request between concurrent callers', async () =>
    {
        let release: ((value: unknown) => void) | undefined;
        deploymentCall.mockReturnValue(new Promise((resolve) =>
        {
            release = resolve;
        }));
        const chain = await loadChain();
        const first = chain.ensureDeployment();
        const second = chain.ensureDeployment();
        expect(deploymentCall).toHaveBeenCalledTimes(1);
        release?.(INFO);
        expect(await first).toBe(await second);
    });

    // The regression the memoization comment in chain.ts describes: caching a
    // REJECTED promise meant one bad first load - the api half still booting, a
    // blip, a page opened before the server - poisoned every later call for the
    // life of the tab, and only a full reload could clear it.
    it('does not memoize a failure - the next caller retries', async () =>
    {
        deploymentCall.mockRejectedValueOnce(new Error('api down')).mockResolvedValue(INFO);
        const chain = await loadChain();
        await expect(chain.ensureDeployment()).rejects.toThrow('api down');
        await expect(chain.ensureDeployment()).resolves.toMatchObject({ chainId: 1020 });
        expect(deploymentCall).toHaveBeenCalledTimes(2);
    });

    it('retries after repeated failures rather than giving up', async () =>
    {
        deploymentCall
            .mockRejectedValueOnce(new Error('down'))
            .mockRejectedValueOnce(new Error('still down'))
            .mockResolvedValue(INFO);
        const chain = await loadChain();
        await expect(chain.ensureDeployment()).rejects.toThrow();
        await expect(chain.ensureDeployment()).rejects.toThrow();
        await expect(chain.ensureDeployment()).resolves.toBeDefined();
        expect(deploymentCall).toHaveBeenCalledTimes(3);
    });

    it('leaves the deployment unset while the fetch keeps failing', async () =>
    {
        deploymentCall.mockRejectedValue(new Error('api down'));
        const chain = await loadChain();
        await expect(chain.ensureDeployment()).rejects.toThrow();
        expect(chain.deployment()).toBeNull();
    });
});

describe('the chain definition', () =>
{
    let pure: Chain;

    beforeAll(async () =>
    {
        pure = await loadChain();
    });

    it('describes the network viem needs, multicall included', () =>
    {
        const definition = pure.chainOf(INFO as never);
        expect(definition.id).toBe(1020);
        expect(definition.name).toBe('Nura Chain');
        expect(definition.rpcUrls.default.http).toEqual(['https://rpc.nurachain.net']);
        expect(definition.nativeCurrency.symbol).toBe('NURA');
        // Without this every multicall in the app falls back to N round trips.
        expect(definition.contracts?.multicall3?.address).toBe(INFO.contracts.multicall3);
    });

    it('omits the explorer when the deployment names none', async () =>
    {
        // Its own instance: chainOf memoizes the first definition it builds.
        const chain = await loadChain();
        const definition = chain.chainOf({ ...INFO, explorerUrl: null } as never);
        expect(definition.blockExplorers).toBeUndefined();
    });

    it('refuses to hand out a client before the deployment is known', async () =>
    {
        const chain = await loadChain();
        expect(() => chain.publicClient()).toThrow(/deployment/i);
    });

    it('builds a reader once the deployment has landed', async () =>
    {
        deploymentCall.mockResolvedValue(INFO);
        const chain = await loadChain();
        await chain.ensureDeployment();
        const client = chain.publicClient();
        expect(client.chain?.id).toBe(1020);
        // Cached: two callers share one transport rather than opening two.
        expect(chain.publicClient()).toBe(client);
    });
});

describe('explorer links', () =>
{
    it('links a transaction and an address once the deployment is loaded', async () =>
    {
        deploymentCall.mockResolvedValue(INFO);
        const chain = await loadChain();
        await chain.ensureDeployment();
        expect(chain.explorerTxUrl('0xabc')).toBe('https://explorer.nurachain.net/tx/0xabc');
        expect(chain.explorerAddressUrl('0xdef')).toBe('https://explorer.nurachain.net/address/0xdef');
    });

    it('answers null rather than a broken link before anything is loaded', async () =>
    {
        const chain = await loadChain();
        expect(chain.explorerTxUrl('0xabc')).toBeNull();
        expect(chain.explorerAddressUrl('0xdef')).toBeNull();
    });

    it('answers null on a chain with no explorer', async () =>
    {
        deploymentCall.mockResolvedValue({ ...INFO, explorerUrl: null });
        const chain = await loadChain();
        await chain.ensureDeployment();
        expect(chain.explorerTxUrl('0xabc')).toBeNull();
    });
});

describe('the V3 half', () =>
{
    it('reports the addresses when the chain carries them', async () =>
    {
        deploymentCall.mockResolvedValue(INFO);
        const chain = await loadChain();
        await chain.ensureDeployment();
        expect(chain.v3Addresses()).toEqual(INFO.v3);
    });

    it('reports null before anything has loaded', async () =>
    {
        const chain = await loadChain();
        expect(chain.v3Addresses()).toBeNull();
    });

    // Both shapes an artifact can take: the key absent entirely (written before
    // V3 existed) and the key present as null (a chain with only V2 deployed).
    it('reports null for a chain with no V3, however the artifact says so', async () =>
    {
        deploymentCall.mockResolvedValue({ ...INFO, v3: null });
        const withNull = await loadChain();
        await withNull.ensureDeployment();
        expect(withNull.v3Addresses()).toBeNull();

        const { v3: _omitted, ...withoutKey } = INFO;
        deploymentCall.mockResolvedValue(withoutKey);
        const missing = await loadChain();
        await missing.ensureDeployment();
        expect(missing.v3Addresses()).toBeNull();
    });
});

describe('the ABI fragments', () =>
{
    // Constants, so these share one module instance rather than paying for a
    // fresh transform of the viem graph each time.
    let chain: Chain;

    beforeAll(async () =>
    {
        chain = await loadChain();
    });

    it('declares every function the app calls on a V2 pair and router', () =>
    {
        const named = (abi: readonly unknown[]): string[] =>
            (abi as Array<{ type: string; name?: string }>)
                .filter((entry) => entry.type === 'function')
                .map((entry) => entry.name as string);
        expect(named(chain.ROUTER_ABI)).toContain('swapExactTokensForTokens');
        expect(named(chain.ROUTER_ABI)).toContain('addLiquidityETH');
        expect(named(chain.PAIR_ABI)).toContain('getReserves');
        expect(named(chain.FACTORY_ABI)).toContain('swapFee');
        expect(named(chain.ERC20_ABI)).toContain('allowance');
        expect(named(chain.WNURA_ABI)).toEqual(expect.arrayContaining(['deposit', 'withdraw']));
    });

    it('declares the V3 surface the swap and liquidity flows sign against', () =>
    {
        const named = (abi: readonly unknown[]): string[] =>
            (abi as Array<{ type: string; name?: string }>)
                .filter((entry) => entry.type === 'function')
                .map((entry) => entry.name as string);
        expect(named(chain.V3_FACTORY_ABI)).toEqual(expect.arrayContaining(['getPool', 'feeAmountTickSpacing']));
        expect(named(chain.V3_POOL_ABI)).toEqual(expect.arrayContaining(['slot0', 'liquidity']));
        expect(named(chain.QUOTER_V2_ABI)).toContain('quoteExactInputSingle');
        expect(named(chain.QUOTER_V1_ABI)).toContain('quoteExactInputSingle');
        expect(named(chain.SWAP_ROUTER_ABI)).toEqual(expect.arrayContaining(['exactInputSingle', 'multicall', 'unwrapWETH9', 'positionManager']));
        expect(named(chain.SWAP_ROUTER_02_ABI)).toEqual(expect.arrayContaining(['exactInputSingle', 'multicall', 'unwrapWETH9']));
        expect(named(chain.POSITION_MANAGER_ABI)).toEqual(expect.arrayContaining([
            'mint', 'increaseLiquidity', 'decreaseLiquidity', 'collect', 'createAndInitializePoolIfNecessary', 'positions'
        ]));
    });

    // The two Quoters differ in arity, and that difference is what the runtime
    // probe keys on. If both fragments ever agreed, the probe would be blind.
    it('keeps the two Quoter shapes distinguishable', () =>
    {
        const quote = (abi: readonly unknown[]): { inputs: unknown[]; outputs: unknown[] } =>
            (abi as Array<{ name?: string; inputs: unknown[]; outputs: unknown[] }>)
                .find((entry) => entry.name === 'quoteExactInputSingle') as { inputs: unknown[]; outputs: unknown[] };
        expect(quote(chain.QUOTER_V2_ABI).inputs).toHaveLength(1);
        expect(quote(chain.QUOTER_V2_ABI).outputs).toHaveLength(4);
        expect(quote(chain.QUOTER_V1_ABI).inputs).toHaveLength(5);
        expect(quote(chain.QUOTER_V1_ABI).outputs).toHaveLength(1);
    });

    // eth_call ignores mutability, and readContract's types demand view - so the
    // fragments the app READS through must all say view, including the ones whose
    // deployed functions are not.
    it('declares every read fragment as view so readContract accepts it', () =>
    {
        const readable = [chain.QUOTER_V1_ABI, chain.QUOTER_V2_ABI, chain.V3_POOL_ABI, chain.V3_FACTORY_ABI, chain.POSITION_COLLECT_STATIC_ABI];
        for (const abi of readable)
        {
            for (const entry of abi as unknown as Array<{ type: string; stateMutability?: string }>)
            {
                if (entry.type === 'function')
                {
                    expect(['view', 'pure']).toContain(entry.stateMutability);
                }
            }
        }
    });
});
