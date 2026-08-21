// The swap page on a chain that carries UniswapV3, in its own file for a real
// reason: the deployment is fetched once per tab by design, so "this chain has
// V3" and "this chain does not" are two different tabs. Resetting the module
// registry mid-file would give the page a different reactive runtime than the
// test helper mounted it with.

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
        pairCount: 1,
        poolCount: 1,
        swapFeeBps: 25,
        tvlUsd: 0,
        volume24hUsd: 0,
        indexedBlock: 1,
        blocksBehind: 0
    }),
    pools: vi.fn().mockResolvedValue([]),
    pool: vi.fn().mockResolvedValue({ candles: [] }),
    tokens: vi.fn().mockResolvedValue(TOKENS),
    txs: vi.fn().mockResolvedValue([]),
    deployment: vi.fn().mockResolvedValue({
        chainId: 1020,
        networkName: 'Nura Chain',
        rpcUrl: 'https://rpc.invalid',
        explorerUrl: null,
        faucet: false,
        contracts: {
            factory: '0x00000000000000000000000000000000000000f0',
            router: '0x00000000000000000000000000000000000000f1',
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

describe('the swap page where the chain carries V3', () =>
{
    it('offers the protocol switch and starts on V2', async () =>
    {
        const { container } = renderTest(() => App({ url: '/swap' }));
        await until(() => container.querySelector('[data-testid="protocol-v3"]') !== null);
        expect(container.querySelector('[data-testid="protocol-v2"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('[data-testid="protocol-v3"]')?.getAttribute('aria-pressed')).toBe('false');
    });

    it('moves the card onto V3 when the switch is used', async () =>
    {
        const { container } = renderTest(() => App({ url: '/swap' }));
        await until(() => container.querySelector('[data-testid="protocol-v3"]') !== null);
        fire(container.querySelector('[data-testid="protocol-v3"]') as HTMLElement, 'click');
        await until(() => container.querySelector('[data-testid="protocol-v3"]')?.getAttribute('aria-pressed') === 'true');
        expect(container.querySelector('[data-testid="protocol-v2"]')?.getAttribute('aria-pressed')).toBe('false');
        // Still one trading card, both sides intact - the switch changes which
        // exchange answers, not what the page is.
        expect(container.querySelector('[data-testid="amount-in"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="amount-out"]')).not.toBeNull();
    });

    // The choice rides with the other swap settings so a V3 trader is not put
    // back on V2 by a page reload.
    it('remembers the protocol across a reload', async () =>
    {
        const first = renderTest(() => App({ url: '/swap' }));
        await until(() => first.container.querySelector('[data-testid="protocol-v3"]') !== null);
        fire(first.container.querySelector('[data-testid="protocol-v3"]') as HTMLElement, 'click');
        await until(() =>
            (window.localStorage.getItem('nuraswap.swap-settings') ?? '').includes('"protocol":"v3"'));
        first.unmount();

        const second = renderTest(() => App({ url: '/swap' }));
        await until(() =>
            second.container.querySelector('[data-testid="protocol-v3"]')?.getAttribute('aria-pressed') === 'true');
        expect(second.container.querySelector('[data-testid="protocol-v2"]')?.getAttribute('aria-pressed')).toBe('false');
    });

    it('shows the liquidity page its own protocol switch', async () =>
    {
        const { container } = renderTest(() => App({ url: '/liquidity' }));
        await until(() => container.querySelector('[data-testid="protocol-v3"]') !== null);
        fire(container.querySelector('[data-testid="protocol-v3"]') as HTMLElement, 'click');
        await until(() => container.textContent?.includes('My V3 positions') === true);
        // The V3 half is read from the chain, and says so where a V2 pool would
        // show indexed volume.
        expect(container.textContent).toContain('read straight from the chain');
    });
});
