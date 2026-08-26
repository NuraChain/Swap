// The trading pages against a V3-capable deployment - which is now the only
// shape an artifact can take. In its own file for a real reason: the deployment
// is fetched once per tab by design, so these journeys run against their own
// module registry rather than mixing with pages.spec's mocks.

import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

const TOKENS = [
    { address: '0x00000000000000000000000000000000000000b0', symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18, priceUsd: 850 },
    { address: '0x00000000000000000000000000000000000000c0', symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6, priceUsd: 1 }
];

const V3 = {
    factory: '0x0000000000000000000000000000000000000031',
    swapRouter: '0x0000000000000000000000000000000000000032',
    quoter: '0x0000000000000000000000000000000000000033',
    positionManager: '0x0000000000000000000000000000000000000034',
    tickLens: '0x0000000000000000000000000000000000000035'
};

const market = {
    stats: vi.fn().mockResolvedValue({
        chainId: 1020,
        poolCount: 1,
        tvlUsd: 0,
        volume24hUsd: 0,
        indexedBlock: 1,
        blocksBehind: 0
    }),
    pools: vi.fn().mockResolvedValue([]),
    pool: vi.fn().mockResolvedValue({ candles: [] }),
    traded: vi.fn().mockResolvedValue({ traded: false }),
    tokens: vi.fn().mockResolvedValue(TOKENS),
    txs: vi.fn().mockResolvedValue([]),
    deployment: vi.fn().mockResolvedValue({
        chainId: 1020,
        networkName: 'Nura Chain',
        rpcUrl: 'https://rpc.invalid',
        explorerUrl: null,
        faucet: false,
        contracts: {
            wnura: TOKENS[0].address,
            multicall3: '0x00000000000000000000000000000000000000f2'
        },
        v3: V3,
        tokens: TOKENS.map(({ priceUsd: _price, ...token }) => token)
    })
};

vi.mock('../src/api.ts', () => ({ client: { market } }));

// Offline: no DNS, no sockets, deterministic on any machine.
vi.mock('../src/lib/chain.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/lib/chain.ts')>();
    return {
        ...actual,
        publicClient: (): unknown => ({
            readContract: async (): Promise<never> =>
            {
                throw new Error('offline');
            },
            multicall: async (): Promise<unknown[]> => [],
            getBlock: async (): Promise<{ timestamp: bigint }> => ({ timestamp: 0n }),
            getBalance: async (): Promise<bigint> => 0n
        })
    };
});

const { default: App } = await import('../src/App.azeroth');
const { setLang } = await import('../src/lib/i18n.ts');

async function until(ready: () => boolean, budgetMs = 15_000): Promise<void>
{
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline)
    {
        if (ready())
        {
            return;
        }
        await new Promise((resolve) =>
        {
            setTimeout(resolve, 10);
        });
    }
    throw new Error('the page never reached the expected state');
}

afterEach(() =>
{
    cleanup();
    window.localStorage.clear();
    setLang('en');
});

describe('the trading pages on the one exchange', () =>
{
    // The regression this pins: there is exactly one exchange, so any switch
    // control left behind would be an offer of something that does not exist.
    it('mounts the swap card with no protocol switch anywhere on it', async () =>
    {
        const { container } = renderTest(() => App({ url: '/swap' }));
        await until(() => container.querySelector('[data-testid="amount-in"]') !== null);
        expect(container.querySelector('[data-testid="protocol-v2"]')).toBeNull();
        expect(container.querySelector('[data-testid="protocol-v3"]')).toBeNull();
        // Both sides of the trade survive the simplification.
        expect(container.querySelector('[data-testid="amount-out"]')).not.toBeNull();
    });

    // A stored 'protocol' key from before the removal must be inert: ignored on
    // read, and overwritten by the first settings save.
    it('ignores a stale persisted protocol setting', async () =>
    {
        window.localStorage.setItem('nuraswap.swap-settings', JSON.stringify({ slippageBps: 100, protocol: 'v2' }));
        const { container } = renderTest(() => App({ url: '/swap' }));
        await until(() => container.textContent?.includes('You pay') === true);
        expect(container.querySelector('[data-testid="protocol-v2"]')).toBeNull();
    });

    it('shows the liquidity page its V3 positions heading and its empty state', async () =>
    {
        const { container } = renderTest(() => App({ url: '/liquidity' }));
        await until(() => container.textContent?.includes('My V3 positions') === true);
        // The pool table is assembled from on-chain discovery; offline, the empty
        // state has to say so rather than spin forever.
        await until(() => container.textContent?.includes('No V3 pools yet.') === true);
        expect(container.querySelector('[data-testid="pool-search"]')).not.toBeNull();
    });

    it('keeps the add button working as a sheet trigger on the liquidity page', async () =>
    {
        const { container } = renderTest(() => App({ url: '/liquidity' }));
        await until(() => container.querySelector('[data-testid="open-add"]') !== null);
        fire(container.querySelector('[data-testid="open-add"]') as HTMLElement, 'click');
        // The sheet portals itself to the body, like every modal in the inventory.
        await until(() => document.body.querySelector('[role="dialog"]') !== null);
    });
});
