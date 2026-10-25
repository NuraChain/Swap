// The add-liquidity sheet's action button with a wallet connected. A disabled
// button that only ever read "Add liquidity" looked like a dead one: it has to
// name the first thing the form is still missing.

import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const USDT = { address: '0x00000000000000000000000000000000000000c0', symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 };
const WNURA = '0x00000000000000000000000000000000000000b0';
const V3 = {
    factory: '0x0000000000000000000000000000000000000031',
    swapRouter: '0x0000000000000000000000000000000000000032',
    quoter: '0x0000000000000000000000000000000000000033',
    positionManager: '0x0000000000000000000000000000000000000034',
    tickLens: '0x0000000000000000000000000000000000000035'
};

// Per test: whether a deployment is loaded, whether its manager can wrap NURA,
// and what the wallet holds.
const scene = vi.hoisted(() => ({ v3: false, wraps: true, native: 0n, wnura: 0n }));

vi.mock('../src/api.ts', () => ({
    client: { market: { deployment: vi.fn().mockResolvedValue(null), tokens: vi.fn().mockResolvedValue([]) } }
}));

// Offline: every pool read misses, so each pair is a first deposit, and every
// allowance reads zero.
vi.mock('../src/lib/chain.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/lib/chain.ts')>();
    return {
        ...actual,
        v3Addresses: () => (scene.v3 ? V3 : null),
        deployment: () => (scene.v3 ? { contracts: { wnura: WNURA }, tokens: [] } : null),
        wnuraToken: () => ({ address: WNURA, symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 }),
        refreshAllowances: (_owner: string, entries: ReadonlyArray<{ token: { address: string } | null; onValue: (value: bigint) => void }>) =>
        {
            for (const entry of entries)
            {
                if (entry.token !== null && !actual.isNativeToken(entry.token as never))
                {
                    entry.onValue(0n);
                }
            }
        },
        publicClient: (): unknown => ({
            readContract: async (): Promise<bigint> => 0n,
            multicall: async (): Promise<unknown[]> => [],
            getBlock: async (): Promise<{ timestamp: bigint }> => ({ timestamp: 0n }),
            getBalance: async (): Promise<bigint> => 0n
        })
    };
});

vi.mock('../src/lib/v3.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/lib/v3.ts')>();
    return {
        ...actual,
        wrapsNative: async (): Promise<boolean> => scene.wraps,
        poolsForPair: async (): Promise<never[]> => [],
        enabledFeeTiers: async () => [{ fee: 3000, tickSpacing: 60 }]
    };
});

vi.mock('../src/lib/wallet/store.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/lib/wallet/store.ts')>();
    return {
        ...actual,
        account: () => '0x00000000000000000000000000000000000000aa',
        nativeBalance: () => scene.native,
        balances: () => ({ [WNURA]: scene.wnura, [USDT.address]: 10n ** 30n })
    };
});

const { default: AddV3Liquidity } = await import('../src/components/market/add-v3-liquidity.component.azeroth');

const tick = (): Promise<void> => new Promise((resolve) =>
{
    setTimeout(resolve, 0);
});

function type(selector: string, value: string): void
{
    const input = document.body.querySelector(selector) as HTMLInputElement;
    input.value = value;
    fire(input, 'input');
}

const label = (): string => document.body.querySelector('[data-testid="v3-add-review"]')?.textContent?.trim() ?? '';

afterEach(() =>
{
    cleanup();
    Object.assign(scene, { v3: false, wraps: true, native: 0n, wnura: 0n });
});

/** A first deposit of 1 NURA against mUSDT, filled in up to the action button. */
async function fillNativeDeposit(): Promise<void>
{
    renderTest(() => AddV3Liquidity({ tokens: [USDT], initialB: USDT, onClose: () => undefined }));
    await tick();
    type('[data-testid="v3-opening"]', '2');
    type('[data-testid="v3-min"]', '1');
    type('[data-testid="v3-max"]', '4');
    await tick();
    type('[data-testid="v3-liq-a"]', '1');
    await tick();
}

const text = (testId: string): string | null =>
    document.body.querySelector(`[data-testid="${ testId }"]`)?.textContent?.trim() ?? null;

// The periphery on a chain can be deployed against a different wrapper than
// the pools use. Then NURA sent as value reverts with STF, so the sheet has to
// ask for WNURA instead: wrap what is missing, approve it, then deposit.
describe('a manager that cannot wrap NURA', () =>
{
    it('asks to wrap the NURA the wallet has not wrapped yet', async () =>
    {
        Object.assign(scene, { v3: true, wraps: false, native: 5n * 10n ** 18n, wnura: 0n });
        await fillNativeDeposit();
        expect(text('v3-wrap')).toBe('Wrap NURA');
        expect(document.body.textContent).toContain('The exchange takes WNURA here, not NURA.');
    });

    it('asks to approve WNURA, not NURA, once it is wrapped', async () =>
    {
        Object.assign(scene, { v3: true, wraps: false, native: 0n, wnura: 5n * 10n ** 18n });
        await fillNativeDeposit();
        expect(text('v3-wrap')).toBeNull();
        expect(text('v3-approve-a')).toBe('Approve WNURA');
    });

    it('keeps native NURA when the manager wraps it itself', async () =>
    {
        Object.assign(scene, { v3: true, wraps: true, native: 5n * 10n ** 18n, wnura: 0n });
        await fillNativeDeposit();
        expect(text('v3-wrap')).toBeNull();
        expect(text('v3-approve-a')).toBeNull();
    });
});

describe('the add-liquidity action button', () =>
{
    it('asks for the second token before anything else', async () =>
    {
        renderTest(() => AddV3Liquidity({ tokens: [USDT], onClose: () => undefined }));
        await tick();
        expect(label()).toBe('Select a token');
    });

    it('walks a first deposit through opening price, range, amount and balance', async () =>
    {
        renderTest(() => AddV3Liquidity({ tokens: [USDT], initialB: USDT, onClose: () => undefined }));
        await tick();
        expect(label()).toBe('Enter an opening price');

        type('[data-testid="v3-opening"]', '2');
        await tick();
        expect(label()).toBe('Set a price range');

        type('[data-testid="v3-min"]', '1');
        type('[data-testid="v3-max"]', '4');
        await tick();
        expect(label()).toBe('Enter an amount');

        type('[data-testid="v3-liq-a"]', '1');
        await tick();
        expect(label()).toBe('Insufficient balance');
    });
});
