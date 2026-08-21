// The add-liquidity form across a refresh tick, and the ratio fill at dust
// scale. Neither regression here is visible in a static render: the first only
// appears on the SECOND run of an effect - which the wallet store's 5s poll
// triggers on its own by bumping txEpoch - and the second only when the quoted
// counterpart lands below the fraction cap the field is written with.

import { createSignal } from 'azerothjs';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TokenRef } from '../src/api.ts';

vi.setConfig({ testTimeout: 30_000 });

type Address = `0x${ string }`;

const ALICE = '0x00000000000000000000000000000000000000c1' as Address;
const BNB_ADDRESS = '0x00000000000000000000000000000000000000d0' as Address;
const WNURA_ADDRESS = '0x00000000000000000000000000000000000000b0' as Address;
const PAIR = '0x00000000000000000000000000000000000000aa' as Address;

const BNB: TokenRef = { address: BNB_ADDRESS, symbol: 'BNB', name: 'Bridge BNB', decimals: 18 };
const WNURA: TokenRef = { address: WNURA_ADDRESS, symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 };

const INFO = {
    chainId: 1020,
    networkName: 'Nura Chain',
    rpcUrl: 'https://rpc.invalid',
    explorerUrl: 'https://explorer.example',
    faucet: false,
    contracts: {
        factory: '0x00000000000000000000000000000000000000f0',
        router: '0x00000000000000000000000000000000000000f1',
        wnura: WNURA_ADDRESS,
        multicall3: '0x00000000000000000000000000000000000000f2'
    },
    v3: null,
    tokens: []
};

interface ChainScript
{
    reserveA: bigint;
    reserveB: bigint;
    allowance: bigint;
    /** How long a read takes to answer - the window a gate may not drop in. */
    allowanceDelayMs: number;
    reserveDelayMs: number;
}

let script: ChainScript;

const [accountSignal, setAccount] = createSignal<Address | null>(null);
const [balancesSignal, setBalances] = createSignal<Record<string, bigint>>({});
const [nativeSignal, setNative] = createSignal(0n);
const [epochSignal, setEpoch] = createSignal(0);

vi.mock('../src/lib/chain.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/lib/chain.ts')>();
    return {
        ...actual,
        deployment: (): unknown => INFO,
        publicClient: (): unknown => ({
            readContract: async ({ functionName }: { functionName: string }): Promise<unknown> =>
            {
                if (functionName === 'getPair')
                {
                    return PAIR;
                }
                if (functionName === 'getReserves')
                {
                    await new Promise((resolve) => setTimeout(resolve, script.reserveDelayMs));
                    return [script.reserveA, script.reserveB, 0];
                }
                if (functionName === 'token0')
                {
                    return BNB_ADDRESS;
                }
                if (functionName === 'allowance')
                {
                    await new Promise((resolve) => setTimeout(resolve, script.allowanceDelayMs));
                    return script.allowance;
                }
                throw new Error(`unscripted read: ${ functionName }`);
            },
            getBlock: async (): Promise<{ timestamp: bigint }> => ({ timestamp: 0n })
        })
    };
});

vi.mock('../src/lib/wallet/store.ts', () => ({
    account: accountSignal,
    balances: balancesSignal,
    nativeBalance: nativeSignal,
    txEpoch: epochSignal,
    requiredWallet: (): unknown => ({ writeContract: async (): Promise<string> => '0x' }),
    sendTx: async (): Promise<boolean> => true,
    startDiscovery: (): void => undefined,
    walletOptions: (): unknown[] => [],
    connectInjected: async (): Promise<void> => undefined
}));

const { default: AddLiquidity } = await import('../src/components/market/add-liquidity.component.azeroth');
const { setLang } = await import('../src/lib/i18n.ts');

/** Reactive writes land on the next macrotask; assertions have to wait for them. */
function settled(): Promise<void>
{
    return new Promise((resolve) =>
    {
        setTimeout(resolve, 0);
    });
}

function tick(ms: number): Promise<void>
{
    return new Promise((resolve) =>
    {
        setTimeout(resolve, ms);
    });
}

function byTestId(root: ParentNode, id: string): HTMLElement
{
    const element = root.querySelector<HTMLElement>(`[data-testid="${ id }"]`);
    if (element === null)
    {
        throw new Error(`no element with data-testid="${ id }"`);
    }
    return element;
}

/** The modal is portaled, so its content is in the document, not the container. */
function panel(): HTMLElement
{
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog === null)
    {
        throw new Error('no dialog rendered');
    }
    return dialog;
}

/** The one control at the bottom of the form: approve, review, or connect. */
function action(): HTMLButtonElement
{
    const buttons = [...panel().querySelectorAll('button')];
    return buttons[buttons.length - 1] as HTMLButtonElement;
}

async function typeAmountA(value: string): Promise<void>
{
    const input = byTestId(panel(), 'liq-a') as HTMLInputElement;
    input.value = value;
    fire(input, 'input');
    await settled();
}

function mountForm(): void
{
    renderTest(() => AddLiquidity({
        tokens: [BNB, WNURA],
        initialA: BNB,
        initialB: WNURA,
        onClose: () => undefined
    }));
}

beforeEach(() =>
{
    setLang('en');
    script = { reserveA: 10n ** 18n, reserveB: 2n * 10n ** 18n, allowance: 0n, allowanceDelayMs: 30, reserveDelayMs: 30 };
    setAccount(ALICE);
    setBalances({ [BNB_ADDRESS.toLowerCase()]: 10n ** 24n, [WNURA_ADDRESS.toLowerCase()]: 10n ** 24n });
    setNative(10n ** 24n);
    setEpoch(0);
});

afterEach(() =>
{
    // Vitest globals are off in this project, so the helper's auto-registration
    // never happens - without this, a portaled modal survives into the next test.
    cleanup();
    setAccount(null);
    setBalances({});
    setEpoch(0);
    setLang('en');
});

describe('AddLiquidity across a refresh tick', () =>
{
    // The regression: the allowance effect blanked both sides to "approved" on
    // every run, and it runs on every txEpoch bump - which the wallet store does
    // every five seconds. For the length of the allowance read the approve gate
    // was down, so the action button offered the deposit on an unapproved token
    // and the router reverted on whoever clicked in that window.
    it('keeps the approve gate up while a refresh re-reads the allowance', async () =>
    {
        mountForm();
        await tick(80);
        await typeAmountA('1');
        await tick(80);
        expect(action().textContent).toContain('Approve');

        setEpoch(1);
        await settled();
        expect(action().textContent).toContain('Approve');
        expect(byTestId(panel(), 'liq-a')).toBeDefined();
        expect(panel().querySelector('[data-testid="add-review"]')).toBeNull();

        // And it is still up once the refreshed read has landed.
        await tick(80);
        expect(action().textContent).toContain('Approve');
    });

    it('offers the deposit once the allowance covers the amount', async () =>
    {
        script.allowance = 10n ** 30n;
        mountForm();
        await tick(80);
        await typeAmountA('1');
        await tick(80);
        expect(panel().querySelector('[data-testid="add-review"]')).not.toBeNull();
        expect(action().disabled).toBe(false);

        setEpoch(1);
        await settled();
        await tick(80);
        expect(panel().querySelector('[data-testid="add-review"]')).not.toBeNull();
    });

    // The reserve effect blanked `reserves` on every run too, which flipped
    // `firstProvider` false for the length of the read - the pool-creation
    // warning strobed once every five seconds on an empty pool.
    it('holds the first-provider notice through a refresh', async () =>
    {
        script.reserveA = 0n;
        script.reserveB = 0n;
        script.allowance = 10n ** 30n;
        mountForm();
        await tick(80);
        expect(panel().textContent).toContain('This pool is empty');

        setEpoch(1);
        await settled();
        expect(panel().textContent).toContain('This pool is empty');
    });
});

describe('AddLiquidity ratio fill', () =>
{
    it('fills the counterpart side from the live reserves', async () =>
    {
        script.allowance = 10n ** 30n;
        mountForm();
        await tick(80);
        await typeAmountA('1');
        await tick(80);
        expect((byTestId(panel(), 'liq-b') as HTMLInputElement).value).toBe('2');
    });

    // The regression: the counterpart was written with an 8-digit fraction cap,
    // so a quote below 1e-8 arrived in the field as "0". It then parsed back as
    // zero, the deposit button stayed disabled, and the form gave no reason - a
    // dead end with a number already on screen.
    it('never writes a non-zero quote into the field as zero', async () =>
    {
        script.reserveA = 1n;
        script.reserveB = 10_000_000n;
        script.allowance = 10n ** 30n;
        mountForm();
        await tick(80);
        await typeAmountA('0.000000000000000001');
        await tick(80);

        const counterpart = (byTestId(panel(), 'liq-b') as HTMLInputElement).value;
        expect(counterpart).not.toBe('0');
        expect(counterpart).toBe('0.00000000001');
        expect(action().disabled).toBe(false);
    });
});
