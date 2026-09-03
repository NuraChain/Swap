// Page-level journeys through the real router, against a stubbed market API.
// This is the closest thing this project has to a browser E2E: the whole app
// shell mounts, the route resolves its lazy chunk, the page runs its own mount
// effects, and the assertions are about what a person would see - including the
// states nobody demos, where the api half is down or the index is behind.

import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

const market = {
    stats: vi.fn(),
    pools: vi.fn(),
    pool: vi.fn(),
    traded: vi.fn().mockResolvedValue({ traded: false }),
    tokens: vi.fn(),
    txs: vi.fn(),
    deployment: vi.fn()
};

vi.mock('../src/api.ts', () => ({ client: { market } }));

// No sockets. The pages read the chain directly, and with a real transport this
// file would resolve DNS for the deployment's RPC on every mount - slow, and
// dependent on whatever the machine's resolver happens to answer. Everything
// else in chain.ts stays real, including the deployment fetch under test.
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

const TOKENS = [
    { address: '0x00000000000000000000000000000000000000b0', symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18, priceUsd: 850 },
    { address: '0x00000000000000000000000000000000000000c0', symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6, priceUsd: 1 }
];

const POOL = {
    address: '0x00000000000000000000000000000000000000aa',
    token0: TOKENS[0],
    token1: TOKENS[1],
    reserve0: '1000000000000000000000',
    reserve1: '850000000000',
    priceWad: '850000000000000000000',
    tvlUsd: 1_700_000,
    volume24hUsd: 250_000,
    feeAprBps: 912
};

const DEPLOYMENT = {
    chainId: 1020,
    networkName: 'Nura Chain',
    rpcUrl: 'https://rpc.invalid',
    explorerUrl: null,
    faucet: false,
    contracts: {
        wnura: TOKENS[0].address,
        multicall3: '0x00000000000000000000000000000000000000f2'
    },
    v3: {
        factory: '0x0000000000000000000000000000000000000031',
        swapRouter: '0x0000000000000000000000000000000000000032',
        quoter: '0x0000000000000000000000000000000000000033',
        positionManager: '0x0000000000000000000000000000000000000034',
        tickLens: '0x0000000000000000000000000000000000000035'
    },
    tokens: TOKENS.map(({ priceUsd: _price, ...token }) => token)
};

function healthy(overrides: Partial<{ blocksBehind: number }> = {}): void
{
    market.stats.mockResolvedValue({
        chainId: 1020,
        poolCount: 42,
        tvlUsd: 1_700_000,
        volume24hUsd: 250_000,
        indexedBlock: 100,
        blocksBehind: overrides.blocksBehind ?? 0
    });
    market.pools.mockResolvedValue([POOL]);
    market.pool.mockResolvedValue({ ...POOL, candles: [] });
    market.tokens.mockResolvedValue(TOKENS);
    market.txs.mockResolvedValue([]);
    market.deployment.mockResolvedValue(DEPLOYMENT);
}

/**
 * Polls the DOM until `ready`. The trading pages are lazy chunks, so the first
 * mount of each waits on a real dynamic import - seconds, the first time, while
 * the compiler transforms the page and its component graph. The budget is
 * generous for that reason; a passing test returns on its first satisfied poll.
 */
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

/** Reactive writes land on the next macrotask; assertions have to wait for them. */
function settled(): Promise<void>
{
    return new Promise((resolve) =>
    {
        setTimeout(resolve, 0);
    });
}

beforeEach(() =>
{
    for (const call of Object.values(market))
    {
        call.mockReset();
    }
    healthy();
    setLang('en');
});

afterEach(() =>
{
    cleanup();
    setLang('en');
});

describe('the app shell', () =>
{
    it('frames every route with the header, the nav and the footer', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        expect(container.querySelector('header')).not.toBeNull();
        expect(container.querySelector('footer')).not.toBeNull();
        expect(container.querySelector('main')).not.toBeNull();
        for (const label of ['Swap', 'Liquidity', 'Portfolio', 'Whitepaper'])
        {
            expect(container.textContent, label).toContain(label);
        }
    });

    it('links the nav at the paths the router actually serves', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        const hrefs = [...container.querySelectorAll('header a')].map((link) => link.getAttribute('href'));
        expect(hrefs).toEqual(expect.arrayContaining(['/', '/swap', '/liquidity', '/portfolio', '/whitepaper']));
    });

    it('answers an unknown path with the not-found copy, still inside the shell', () =>
    {
        const { container } = renderTest(() => App({ url: '/does-not-exist' }));
        expect(container.textContent).toContain('This page does not exist.');
        expect(container.querySelector('header')).not.toBeNull();
    });

    it('renders the whole shell in a right-to-left language', () =>
    {
        setLang('fa');
        const { container } = renderTest(() => App({ url: '/' }));
        expect(document.documentElement.dir).toBe('rtl');
        expect(container.textContent).toContain('مبادله');
    });

    it('tickers the native price in the header, read off the wrapped token', async () =>
    {
        // NURA is gas and cannot sit in a pool. WNURA is the same value in the
        // shape a pool can hold, so the wrapped row IS the native price - the
        // fixture prices it at $850.
        const { container } = renderTest(() => App({ url: '/' }));
        await until(() => container.querySelector('[data-testid="nura-price"]') !== null);
        const ticker = container.querySelector('[data-testid="nura-price"]');
        expect(ticker?.textContent).toContain('NURA');
        expect(ticker?.textContent).toContain('$850');
    });

    it('prices at the precision of a price, not of money', async () =>
    {
        // fmtUsd's two-decimal money rule would print this as $0.00. A native
        // token quoted against a bridged asset lands exactly here, and a header
        // that says a coin is worth nothing is worse than a header with no
        // ticker in it.
        market.tokens.mockResolvedValue([{ ...TOKENS[0], priceUsd: 0.00026146 }, TOKENS[1]]);
        const { container } = renderTest(() => App({ url: '/' }));
        await until(() => container.querySelector('[data-testid="nura-price"]') !== null);
        expect(container.querySelector('[data-testid="nura-price"]')?.textContent).toContain('$0.00026146');
    });

    it('localizes the ticker, digits and currency word alike', async () =>
    {
        setLang('fa');
        const { container } = renderTest(() => App({ url: '/' }));
        await until(() => container.querySelector('[data-testid="nura-price"]') !== null);
        const ticker = container.querySelector('[data-testid="nura-price"]');
        // Persian numerals and the currency word APPENDED rather than a leading
        // '$'. Deliberately NOT an LTR island: that would put 'دلار' on the wrong
        // side of the number, and every other USD figure in the app - the landing
        // stats, the portfolio total - prints in the paragraph's own direction.
        expect(ticker?.textContent).toContain('۸۵۰');
        expect(ticker?.textContent).toContain('دلار');
        expect(ticker?.querySelector('[data-ltr]')).toBeNull();
    });

    it('shows no ticker at all rather than a zero when the price is unknown', async () =>
    {
        for (const call of Object.values(market))
        {
            call.mockImplementation(() => Promise.reject(new Error('api unreachable')));
        }
        const { container } = renderTest(() => App({ url: '/' }));
        await until(() => container.querySelector('header') !== null);
        await settled();
        expect(container.querySelector('[data-testid="nura-price"]')).toBeNull();
    });
});

describe('the landing page', () =>
{
    it('shows the exchange its own live numbers', async () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        await until(() => container.textContent?.includes('1,700,000') === true);
        expect(container.textContent).toContain('Trade straight from your wallet.');
        expect(container.textContent).toContain('250,000');
        expect(container.textContent).toContain('42');
    });

    // The api half being down must not take the page with it: the landing copy
    // is static, and only the figures depend on the server.
    it('still renders when the market service is unreachable', async () =>
    {
        market.stats.mockImplementation(() => Promise.reject(new Error('api unreachable')));
        const { container } = renderTest(() => App({ url: '/' }));
        await until(() => container.textContent?.includes('Trade straight from your wallet.') === true);
        expect(container.querySelector('footer')).not.toBeNull();
    });
});

describe('the indexer lag banner', () =>
{
    // Silently stale prices are the failure a DEX cannot afford. Past a few
    // blocks the banner says so, and says what is still trustworthy.
    it('warns when served data has fallen behind the chain', async () =>
    {
        healthy({ blocksBehind: 40 });
        const { container } = renderTest(() => App({ url: '/' }));
        await until(() => container.querySelector('[data-testid="indexer-lag"]') !== null);
        expect(container.querySelector('[data-testid="indexer-lag"]')?.textContent)
            .toContain('Market data is catching up');
    });

    it('stays quiet while the index is keeping up', async () =>
    {
        healthy({ blocksBehind: 2 });
        const { container } = renderTest(() => App({ url: '/' }));
        await until(() => market.stats.mock.calls.length > 0);
        await new Promise((resolve) =>
        {
            setTimeout(resolve, 20);
        });
        expect(container.querySelector('[data-testid="indexer-lag"]')).toBeNull();
    });

    it('stays quiet when the stats call fails rather than crying wolf', async () =>
    {
        market.stats.mockImplementation(() => Promise.reject(new Error('api unreachable')));
        const { container } = renderTest(() => App({ url: '/' }));
        await until(() => market.stats.mock.calls.length > 0);
        await new Promise((resolve) =>
        {
            setTimeout(resolve, 20);
        });
        expect(container.querySelector('[data-testid="indexer-lag"]')).toBeNull();
    });
});

describe('the swap page', () =>
{
    it('mounts its trading card with both sides of the trade', async () =>
    {
        const { container } = renderTest(() => App({ url: '/swap' }));
        await until(() => container.querySelector('[data-testid="amount-in"]') !== null);
        expect(container.querySelector('[data-testid="amount-out"]')).not.toBeNull();
        expect(container.textContent).toContain('You pay');
        expect(container.textContent).toContain('You receive');
    });

    it('asks for a wallet before it asks for anything else', async () =>
    {
        const { container } = renderTest(() => App({ url: '/swap' }));
        await until(() => container.querySelector('[data-testid="connect"]') !== null);
        expect(container.querySelector('[data-testid="connect"]')?.textContent).toContain('Connect wallet');
    });

    it('offers the direction switch', async () =>
    {
        const { container } = renderTest(() => App({ url: '/swap' }));
        await until(() => container.querySelector('[data-testid="flip"]') !== null);
        expect(container.querySelector('[data-testid="flip"]')?.getAttribute('aria-label'))
            .toBe('Switch direction');
    });

    it('opens the settings sheet on demand', async () =>
    {
        const { container } = renderTest(() => App({ url: '/swap' }));
        await until(() => container.textContent?.includes('You pay') === true);
        const settings = [...container.querySelectorAll('button')]
            .find((button) => button.getAttribute('aria-label') === 'Settings');
        expect(settings).toBeDefined();
        expect(settings?.getAttribute('aria-expanded')).toBe('false');
        fire(settings as HTMLElement, 'click');
        await until(() => container.textContent?.includes('Slippage tolerance') === true);
        expect(container.textContent).toContain('Transaction deadline');
    });
});

describe('the liquidity page', () =>
{
    it('asks for a wallet before showing positions', async () =>
    {
        const { container } = renderTest(() => App({ url: '/liquidity' }));
        await until(() => container.textContent?.includes('Connect a wallet to see your positions.') === true);
        expect(container.textContent).toContain('My V3 positions');
    });

    // The pool table is assembled in the browser from on-chain discovery; with
    // the chain reads stubbed offline there is nothing to show, and the empty
    // state has to say so rather than spin forever.
    it('says so plainly when no pools can be discovered', async () =>
    {
        const { container } = renderTest(() => App({ url: '/liquidity' }));
        await until(() => container.textContent?.includes('No V3 pools yet.') === true);
    });

    it('filters the pool table as the search is typed', async () =>
    {
        const { container } = renderTest(() => App({ url: '/liquidity' }));
        await until(() => container.querySelector('[data-testid="pool-search"]') !== null);
        const search = container.querySelector<HTMLInputElement>('[data-testid="pool-search"]');
        search!.value = 'nothing-matches-this';
        fire(search as HTMLElement, 'input');
        await until(() => container.textContent?.includes('No V3 pools yet.') === true);
    });
});

// An api half that is down is a state every page already renders - empty tables,
// no token list, no quote. What must NOT happen is the failure escaping as an
// unhandled rejection: App swallows its own warm-up for exactly that reason, and
// the pages have to hold the same line or an outage fills every visitor's console.
describe('an outage of the market service', () =>
{
    // `process` without node types on this half - the runtime has it either way.
    const runtime = globalThis as unknown as {
        process?: {
            on: (event: string, handler: (reason: unknown) => void) => void;
            off: (event: string, handler: (reason: unknown) => void) => void;
        };
    };

    it.each(['/', '/swap', '/liquidity', '/portfolio'])('leaks no unhandled rejection from %s', async (url) =>
    {
        for (const call of Object.values(market))
        {
            call.mockImplementation(() => Promise.reject(new Error('api unreachable')));
        }
        const leaked: unknown[] = [];
        const capture = (reason: unknown): void =>
        {
            leaked.push(reason);
        };
        runtime.process?.on('unhandledRejection', capture);
        try
        {
            const { container } = renderTest(() => App({ url }));
            await until(() => container.querySelector('footer') !== null);
            // Long enough for the mount chain to reject and settle.
            await new Promise((resolve) =>
            {
                setTimeout(resolve, 100);
            });
            expect(leaked, `${ url } leaked ${ leaked.length } rejection(s)`).toEqual([]);
        }
        finally
        {
            runtime.process?.off('unhandledRejection', capture);
        }
    });
});

describe('the portfolio page', () =>
{
    it('shows nothing but the invitation to connect until a wallet is there', async () =>
    {
        const { container } = renderTest(() => App({ url: '/portfolio' }));
        await until(() => container.textContent?.includes('Connect a wallet to see your positions.') === true);
        expect(container.textContent).toContain('Portfolio');
        // Balances belong to an account; with none connected there is nothing
        // truthful to put under a Holdings heading, so it is not rendered.
        expect(container.textContent).not.toContain('Holdings');
    });

    it('survives an unreachable market service', async () =>
    {
        // mockImplementation, not mockRejectedValue: the latter builds the
        // rejected promise up front, so a mock the page never calls still
        // reports an unhandled rejection that belongs to nothing.
        for (const call of Object.values(market))
        {
            call.mockImplementation(() => Promise.reject(new Error('api unreachable')));
        }
        const { container } = renderTest(() => App({ url: '/portfolio' }));
        await until(() => container.textContent?.includes('Portfolio') === true);
        expect(container.querySelector('header')).not.toBeNull();
    });
});

describe('the whitepaper page', () =>
{
    it('renders the paper with its contents and a PDF to download', async () =>
    {
        const { container } = renderTest(() => App({ url: '/whitepaper' }));
        await until(() => container.querySelector('[data-testid="whitepaper-download"]') !== null);
        expect(container.querySelector('h1')?.textContent).toContain('Nura Swap');
        expect(container.textContent).toContain('In short');
        expect(container.textContent).toContain('The plan');
        // Anchors are the contents list's targets and the PDF's section ids alike.
        expect(container.querySelector('#roadmap')).not.toBeNull();
        expect(container.querySelector('nav a[href="#roadmap"]')).not.toBeNull();
        const link = container.querySelector('[data-testid="whitepaper-download"]');
        expect(link?.getAttribute('href')).toBe('/whitepaper/nura-swap-whitepaper-en.pdf');
        expect(link?.hasAttribute('download')).toBe(true);
    });

    it('reads in Persian, with the Persian PDF first and the English one a click away', async () =>
    {
        setLang('fa');
        const { container } = renderTest(() => App({ url: '/whitepaper' }));
        await until(() => container.querySelector('[data-testid="whitepaper-download"]') !== null);
        expect(container.textContent).toContain('خلاصه‌اش این است');
        expect(container.querySelector('[data-testid="whitepaper-download"]')?.getAttribute('href'))
            .toBe('/whitepaper/nura-swap-whitepaper-fa.pdf');
        expect(container.querySelector('a[href="/whitepaper/nura-swap-whitepaper-en.pdf"]')).not.toBeNull();
    });

    it('reads every other language in its own words, never in English', async () =>
    {
        setLang('fr');
        const { container } = renderTest(() => App({ url: '/whitepaper' }));
        await until(() => container.querySelector('[data-testid="whitepaper-download"]') !== null);
        expect(container.textContent).toContain('En bref');
        expect(container.textContent).not.toContain('In short');
        expect(container.querySelector('[data-testid="whitepaper-download"]')?.getAttribute('href'))
            .toBe('/whitepaper/nura-swap-whitepaper-fr.pdf');
    });
});
