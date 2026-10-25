// The add-liquidity sheet's action button with a wallet connected. A disabled
// button that only ever read "Add liquidity" looked like a dead one: it has to
// name the first thing the form is still missing.

import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const USDT = { address: '0x00000000000000000000000000000000000000c0', symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 };

vi.mock('../src/api.ts', () => ({
    client: { market: { deployment: vi.fn().mockResolvedValue(null), tokens: vi.fn().mockResolvedValue([]) } }
}));

// Offline: every pool read misses, so each pair is a first deposit.
vi.mock('../src/lib/chain.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/lib/chain.ts')>();
    return {
        ...actual,
        v3Addresses: () => null,
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

vi.mock('../src/lib/wallet/store.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/lib/wallet/store.ts')>();
    return { ...actual, account: () => '0x00000000000000000000000000000000000000aa' };
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

afterEach(cleanup);

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
