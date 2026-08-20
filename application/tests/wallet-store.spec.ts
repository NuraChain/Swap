// The wallet store: discovery, connection, and the wrapper every transaction in
// this app goes through. Two things here are security-relevant rather than
// merely functional - the chain guard that refuses to send on the wrong network,
// and the rule that the wallet prompt goes out before anything is awaited - and
// both are invisible in the UI until they are wrong.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

type Store = typeof import('../src/lib/wallet/store.ts');
type Address = `0x${ string }`;

const ALICE = '0x00000000000000000000000000000000000000c1' as Address;
const WNURA = '0x00000000000000000000000000000000000000b0' as Address;
const USDT = '0x00000000000000000000000000000000000000c0' as Address;

const INFO = {
    chainId: 1020,
    networkName: 'Nura Chain',
    rpcUrl: 'https://rpc.invalid',
    explorerUrl: 'https://explorer.example',
    faucet: false,
    contracts: {
        factory: '0x00000000000000000000000000000000000000f0',
        router: '0x00000000000000000000000000000000000000f1',
        wnura: WNURA,
        multicall3: '0x00000000000000000000000000000000000000f2'
    },
    v3: null,
    tokens: []
};

interface ChainScript
{
    deployment: unknown;
    ensureFails: boolean;
    receiptStatus: 'success' | 'reverted';
    receiptThrows: boolean;
    multicallResults: Array<{ status: string; result?: unknown }>;
    multicallThrows: boolean;
    nativeBalance: bigint;
    explorerUrl: string | null;
}

let chainScript: ChainScript;

function freshChainScript(): ChainScript
{
    return {
        deployment: INFO,
        ensureFails: false,
        receiptStatus: 'success',
        receiptThrows: false,
        multicallResults: [],
        multicallThrows: false,
        nativeBalance: 0n,
        explorerUrl: 'https://explorer.example'
    };
}

vi.mock('../src/lib/chain.ts', () => ({
    ERC20_ABI: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [], outputs: [] }],
    deployment: (): unknown => chainScript.deployment,
    ensureDeployment: async (): Promise<unknown> =>
    {
        if (chainScript.ensureFails)
        {
            throw new Error('api unreachable');
        }
        return chainScript.deployment;
    },
    chainOf: (): unknown => ({ id: 1020, name: 'Nura Chain', nativeCurrency: { name: 'NURA', symbol: 'NURA', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.invalid'] } } }),
    explorerTxUrl: (hash: string): string | null =>
        (chainScript.explorerUrl === null ? null : `${ chainScript.explorerUrl }/tx/${ hash }`),
    publicClient: (): unknown => ({
        multicall: async (): Promise<unknown> =>
        {
            if (chainScript.multicallThrows)
            {
                throw new Error('rpc unavailable');
            }
            return chainScript.multicallResults;
        },
        getBalance: async (): Promise<bigint> => chainScript.nativeBalance,
        waitForTransactionReceipt: async (): Promise<{ status: string }> =>
        {
            if (chainScript.receiptThrows)
            {
                throw new Error('receipt never arrived');
            }
            return { status: chainScript.receiptStatus };
        }
    })
}));

async function loadStore(): Promise<{ store: Store; toast: typeof import('../src/lib/toast.ts') }>
{
    vi.resetModules();
    return {
        store: await import('../src/lib/wallet/store.ts'),
        toast: await import('../src/lib/toast.ts')
    };
}

interface FakeProvider
{
    request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
    on: (event: string, handler: (payload: never) => void) => void;
    removeListener: (event: string, handler: (payload: never) => void) => void;
    calls: string[];
    handlers: Map<string, (payload: never) => void>;
}

interface ProviderScript
{
    accounts?: string[];
    requestAccounts?: string[] | { code: number };
    chainId?: string;
    switchFails?: boolean;
    addFails?: boolean;
}

function fakeProvider(script: ProviderScript = {}): FakeProvider
{
    const calls: string[] = [];
    const handlers = new Map<string, (payload: never) => void>();
    return {
        calls,
        handlers,
        request: async ({ method }): Promise<unknown> =>
        {
            calls.push(method);
            switch (method)
            {
                case 'eth_accounts':
                    return script.accounts ?? [];
                case 'eth_requestAccounts':
                {
                    const answer = script.requestAccounts ?? [ALICE];
                    if (!Array.isArray(answer))
                    {
                        throw answer;
                    }
                    return answer;
                }
                case 'eth_chainId':
                    return script.chainId ?? '0x3fc';
                case 'wallet_switchEthereumChain':
                    if (script.switchFails === true)
                    {
                        throw new Error('unrecognized chain');
                    }
                    return null;
                case 'wallet_addEthereumChain':
                    if (script.addFails === true)
                    {
                        throw new Error('user rejected');
                    }
                    return null;
                default:
                    throw new Error(`unexpected method ${ method }`);
            }
        },
        on: (event, handler): void =>
        {
            handlers.set(event, handler);
        },
        removeListener: (event): void =>
        {
            handlers.delete(event);
        }
    };
}

function announce(provider: FakeProvider, rdns = 'io.example.wallet'): void
{
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: { uuid: 'uuid', name: 'Example Wallet', icon: 'data:,', rdns }, provider }
    }));
}

/** Lets the store's awaited chain settle without leaning on a timer. */
async function settled(): Promise<void>
{
    for (let turn = 0; turn < 20; turn++)
    {
        await Promise.resolve();
    }
}

beforeEach(() =>
{
    chainScript = freshChainScript();
    window.localStorage.clear();
});

afterEach(() =>
{
    window.localStorage.clear();
});

describe('connecting', () =>
{
    // The regression the comment in connectInjected describes: awaiting anything
    // before the prompt spends the click's user activation, and a wallet that has
    // lost it may queue its approval window behind its toolbar icon. To the
    // person clicking, that is a dead button.
    it('asks the wallet before it awaits anything else', async () =>
    {
        const { store } = await loadStore();
        const provider = fakeProvider();
        await store.connectInjected({ id: 'io.example.wallet', name: 'Example', icon: null, provider });
        expect(provider.calls[0]).toBe('eth_requestAccounts');
        expect(store.account()).toBe(ALICE);
        expect(store.connectedVia()).toBe('Example');
    });

    it('remembers the wallet for a silent restore next time', async () =>
    {
        const { store } = await loadStore();
        await store.connectInjected({ id: 'io.example.wallet', name: 'Example', icon: null, provider: fakeProvider() });
        expect(window.localStorage.getItem('nuraswap.wallet')).toBe('io.example.wallet');
    });

    it('does nothing at all for an option with no provider', async () =>
    {
        const { store } = await loadStore();
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider: null });
        expect(store.account()).toBeNull();
    });

    // A user who declined already saw their own wallet say so.
    it('stays quiet when the user declines', async () =>
    {
        const { store, toast } = await loadStore();
        const provider = fakeProvider({ requestAccounts: { code: 4001 } });
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        expect(store.account()).toBeNull();
        expect(toast.toasts()).toEqual([]);
    });

    // -32002 is the one case where clicking again genuinely looks like nothing
    // happening, so it is the one that has to be spelled out.
    it('explains a request already waiting in the wallet', async () =>
    {
        const { store, toast } = await loadStore();
        const provider = fakeProvider({ requestAccounts: { code: -32002 } });
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        expect(toast.toasts()).toHaveLength(1);
        expect(toast.toasts()[0].kind).toBe('error');
        expect(toast.toasts()[0].text).toContain('already has a connection request');
        expect(store.account()).toBeNull();
    });

    it('reports any other failure as a connection failure', async () =>
    {
        const { store, toast } = await loadStore();
        const provider = fakeProvider({ requestAccounts: { code: -1 } });
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        expect(toast.toasts()[0].text).toContain('Could not connect');
        expect(store.account()).toBeNull();
    });

    // A locked wallet answers an empty list rather than rejecting.
    it('treats an empty account list as a failure to connect', async () =>
    {
        const { store, toast } = await loadStore();
        const provider = fakeProvider({ requestAccounts: [] });
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        expect(store.account()).toBeNull();
        expect(toast.toasts()[0].text).toContain('Could not connect');
    });

    it('says the market service is unreachable when the deployment will not load', async () =>
    {
        chainScript.ensureFails = true;
        const { store, toast } = await loadStore();
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider: fakeProvider() });
        expect(store.account()).toBeNull();
        expect(toast.toasts()[0].text).toContain('Cannot reach the market service');
    });
});

describe('discovery and session restore', () =>
{
    it('admits every announced wallet, keyed by rdns', async () =>
    {
        const { store } = await loadStore();
        store.startDiscovery();
        announce(fakeProvider(), 'io.one');
        announce(fakeProvider(), 'io.two');
        expect(store.walletOptions().map((option) => option.id)).toEqual(['io.one', 'io.two']);
    });

    it('does not list the same wallet twice when it announces twice', async () =>
    {
        const { store } = await loadStore();
        store.startDiscovery();
        announce(fakeProvider(), 'io.one');
        announce(fakeProvider(), 'io.one');
        expect(store.walletOptions()).toHaveLength(1);
    });

    // The remembered wallet restores through eth_accounts, which never prompts.
    // eth_requestAccounts here would open a wallet window on every page load.
    it('restores a remembered wallet without prompting', async () =>
    {
        window.localStorage.setItem('nuraswap.wallet', 'io.one');
        const { store } = await loadStore();
        const provider = fakeProvider({ accounts: [ALICE] });
        store.startDiscovery();
        announce(provider, 'io.one');
        await settled();
        expect(store.account()).toBe(ALICE);
        expect(provider.calls).toContain('eth_accounts');
        expect(provider.calls).not.toContain('eth_requestAccounts');
    });

    it('leaves a remembered wallet alone when it reports no accounts', async () =>
    {
        window.localStorage.setItem('nuraswap.wallet', 'io.one');
        const { store } = await loadStore();
        store.startDiscovery();
        announce(fakeProvider({ accounts: [] }), 'io.one');
        await settled();
        expect(store.account()).toBeNull();
    });

    it('does not restore a wallet that was not the remembered one', async () =>
    {
        window.localStorage.setItem('nuraswap.wallet', 'io.one');
        const { store } = await loadStore();
        store.startDiscovery();
        announce(fakeProvider({ accounts: [ALICE] }), 'io.two');
        await settled();
        expect(store.account()).toBeNull();
    });

    it('forgets a remembered wallet whose restore fails', async () =>
    {
        window.localStorage.setItem('nuraswap.wallet', 'io.one');
        chainScript.ensureFails = true;
        const { store } = await loadStore();
        store.startDiscovery();
        announce(fakeProvider({ accounts: [ALICE] }), 'io.one');
        await settled();
        expect(window.localStorage.getItem('nuraswap.wallet')).toBeNull();
        expect(store.account()).toBeNull();
    });
});

describe('account and chain events', () =>
{
    it('follows the wallet when the user switches account', async () =>
    {
        const { store } = await loadStore();
        const provider = fakeProvider();
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        provider.handlers.get('accountsChanged')?.(['0x00000000000000000000000000000000000000c2'] as never);
        expect(store.account()).toBe('0x00000000000000000000000000000000000000c2');
    });

    it('disconnects when the wallet reports no accounts left', async () =>
    {
        const { store } = await loadStore();
        const provider = fakeProvider();
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        provider.handlers.get('accountsChanged')?.([] as never);
        expect(store.account()).toBeNull();
        expect(window.localStorage.getItem('nuraswap.wallet')).toBeNull();
    });

    it('follows the wallet onto another chain', async () =>
    {
        const { store } = await loadStore();
        const provider = fakeProvider();
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        expect(store.onRightChain()).toBe(true);
        provider.handlers.get('chainChanged')?.('0x1' as never);
        expect(store.walletChainId()).toBe(1);
        expect(store.onRightChain()).toBe(false);
    });

    it('clears everything on an explicit disconnect', async () =>
    {
        const { store } = await loadStore();
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider: fakeProvider() });
        store.disconnect();
        expect(store.account()).toBeNull();
        expect(store.walletChainId()).toBeNull();
        expect(store.connectedVia()).toBeNull();
        expect(store.balances()).toEqual({});
        expect(store.nativeBalance()).toBe(0n);
    });

    it('is on no chain at all before anything connects', async () =>
    {
        const { store } = await loadStore();
        expect(store.onRightChain()).toBe(false);
    });
});

describe('switching and adding the chain', () =>
{
    it('asks the wallet to switch, and falls back to adding when it cannot', async () =>
    {
        const { store } = await loadStore();
        const provider = fakeProvider({ chainId: '0x1', switchFails: true });
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        await store.switchChain();
        expect(provider.calls).toContain('wallet_switchEthereumChain');
        expect(provider.calls).toContain('wallet_addEthereumChain');
        expect(store.onRightChain()).toBe(true);
    });

    it('does not add the chain when the switch already worked', async () =>
    {
        const { store } = await loadStore();
        const provider = fakeProvider({ chainId: '0x1' });
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        await store.switchChain();
        expect(provider.calls).not.toContain('wallet_addEthereumChain');
    });

    it('tells the user to connect before adding the chain', async () =>
    {
        const { store, toast } = await loadStore();
        await store.addChainToWallet();
        expect(toast.toasts()[0].text).toContain('Connect a wallet first');
    });

    it('confirms when the chain is registered', async () =>
    {
        const { store, toast } = await loadStore();
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider: fakeProvider() });
        await store.addChainToWallet();
        expect(toast.toasts().some((entry) => entry.kind === 'success')).toBe(true);
    });

    // A declined prompt is a normal outcome, not an error worth a red toast: the
    // user saw their own wallet ask and said no.
    it('stays quiet when the user declines the chain prompt', async () =>
    {
        const { store, toast } = await loadStore();
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider: fakeProvider({ addFails: true }) });
        await store.addChainToWallet();
        expect(toast.toasts()).toEqual([]);
    });

    it('says so when the deployment it would hand over cannot be loaded', async () =>
    {
        const { store, toast } = await loadStore();
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider: fakeProvider() });
        chainScript.ensureFails = true;
        await store.addChainToWallet();
        expect(toast.toasts()[0].text).toContain('Cannot reach the market service');
    });
});

describe('sending a transaction', () =>
{
    async function connected(): Promise<{ store: Store; toast: typeof import('../src/lib/toast.ts') }>
    {
        const loaded = await loadStore();
        loaded.store.adoptWallet({} as never, ALICE, 1020, 'Test wallet');
        return loaded;
    }

    it('reports a confirmed transaction with a link to the explorer', async () =>
    {
        const { store, toast } = await connected();
        const send = vi.fn().mockResolvedValue('0xabc' as `0x${ string }`);
        const before = store.txEpoch();
        expect(await store.sendTx('Swap', send)).toBe(true);
        expect(send).toHaveBeenCalledTimes(1);
        const [entry] = toast.toasts();
        expect(entry.kind).toBe('success');
        expect(entry.text).toContain('Confirmed');
        expect(entry.link?.href).toBe('https://explorer.example/tx/0xabc');
        // Quotes, balances and positions all hang their refresh on this.
        expect(store.txEpoch()).toBe(before + 1);
    });

    it('omits the link on a chain with no explorer', async () =>
    {
        chainScript.explorerUrl = null;
        const { store, toast } = await connected();
        await store.sendTx('Swap', vi.fn().mockResolvedValue('0xabc' as `0x${ string }`));
        expect(toast.toasts()[0].link).toBeUndefined();
    });

    it('reports a reverted transaction as failed, not as confirmed', async () =>
    {
        chainScript.receiptStatus = 'reverted';
        const { store, toast } = await connected();
        expect(await store.sendTx('Swap', vi.fn().mockResolvedValue('0xabc' as `0x${ string }`))).toBe(false);
        expect(toast.toasts()[0].kind).toBe('error');
        expect(toast.toasts()[0].text).toContain('Failed');
    });

    // The guard that matters. A wallet on another network is offered the switch
    // first - someone on the wrong chain wants to be on the right one - and only
    // if that fails does the send refuse. It must never broadcast anyway.
    it('refuses to send from a wrong network it cannot switch off', async () =>
    {
        const { store, toast } = await loadStore();
        await store.connectInjected({
            id: 'x',
            name: 'x',
            icon: null,
            provider: fakeProvider({ chainId: '0x1', switchFails: true, addFails: true })
        });
        expect(store.onRightChain()).toBe(false);
        const send = vi.fn().mockResolvedValue('0xabc' as `0x${ string }`);
        expect(await store.sendTx('Swap', send)).toBe(false);
        // Never asked to sign: the alternative is a transaction broadcast to a
        // chain where those addresses mean something else entirely.
        expect(send).not.toHaveBeenCalled();
        expect(toast.toasts()[0].kind).toBe('error');
        expect(toast.toasts()[0].text).toContain('different network');
    });

    it('switches first and then sends, when the wallet agrees to move', async () =>
    {
        const { store } = await loadStore();
        const provider = fakeProvider({ chainId: '0x1' });
        await store.connectInjected({ id: 'x', name: 'x', icon: null, provider });
        expect(store.onRightChain()).toBe(false);
        const send = vi.fn().mockResolvedValue('0xabc' as `0x${ string }`);
        expect(await store.sendTx('Swap', send)).toBe(true);
        expect(provider.calls).toContain('wallet_switchEthereumChain');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('classifies a declined signature as a refusal rather than a chain failure', async () =>
    {
        const { store, toast } = await connected();
        const send = vi.fn().mockRejectedValue({ code: 4001, message: 'User rejected the request.' });
        expect(await store.sendTx('Swap', send)).toBe(false);
        expect(toast.toasts()[0].text).toContain('declined the signature');
    });

    it('classifies a slippage revert as the slippage bound firing', async () =>
    {
        const { store, toast } = await connected();
        const send = vi.fn().mockRejectedValue(new Error('UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'));
        await store.sendTx('Swap', send);
        expect(toast.toasts()[0].text).toContain('slippage limit');
    });

    it('falls back to the generic message for anything it cannot name', async () =>
    {
        const { store, toast } = await connected();
        await store.sendTx('Swap', vi.fn().mockRejectedValue(new Error('nonce too low')));
        expect(toast.toasts()[0].text).toContain('failed on-chain');
    });

    it('reports a receipt that never arrives as a failure', async () =>
    {
        chainScript.receiptThrows = true;
        const { store, toast } = await connected();
        expect(await store.sendTx('Swap', vi.fn().mockResolvedValue('0xabc' as `0x${ string }`))).toBe(false);
        expect(toast.toasts()[0].kind).toBe('error');
    });

    it('shows the work as pending while it is in flight', async () =>
    {
        const { store, toast } = await connected();
        let release: ((hash: `0x${ string }`) => void) | undefined;
        const pending = store.sendTx('Approve mUSDT', () => new Promise<`0x${ string }`>((resolve) =>
        {
            release = resolve;
        }));
        expect(toast.toasts()[0].kind).toBe('pending');
        expect(toast.toasts()[0].text).toContain('Approve mUSDT');
        release?.('0xabc');
        await pending;
        expect(toast.toasts()[0].kind).toBe('success');
    });
});

describe('balances', () =>
{
    it('maps every watched token onto its balance, keyed lowercase', async () =>
    {
        chainScript.multicallResults = [
            { status: 'success', result: 100n },
            { status: 'success', result: 250n }
        ];
        chainScript.nativeBalance = 42n;
        const { store } = await loadStore();
        store.adoptWallet({} as never, ALICE, 1020, 'Test wallet');
        store.watchTokens([WNURA.toUpperCase() as Address, USDT]);
        await settled();
        expect(store.balances()[WNURA.toLowerCase()]).toBe(100n);
        expect(store.balances()[USDT.toLowerCase()]).toBe(250n);
        expect(store.nativeBalance()).toBe(42n);
    });

    // allowFailure is on: one unreadable token must read as zero rather than
    // taking every other balance on the page down with it.
    it('reads a token that will not answer as zero', async () =>
    {
        chainScript.multicallResults = [
            { status: 'success', result: 100n },
            { status: 'failure' }
        ];
        const { store } = await loadStore();
        store.adoptWallet({} as never, ALICE, 1020, 'Test wallet');
        store.watchTokens([WNURA, USDT]);
        await settled();
        expect(store.balances()[USDT.toLowerCase()]).toBe(0n);
        expect(store.balances()[WNURA.toLowerCase()]).toBe(100n);
    });

    it('keeps the last known balances when the RPC drops the call', async () =>
    {
        chainScript.multicallResults = [{ status: 'success', result: 100n }];
        const { store } = await loadStore();
        store.adoptWallet({} as never, ALICE, 1020, 'Test wallet');
        store.watchTokens([WNURA]);
        await settled();
        chainScript.multicallThrows = true;
        await store.refreshBalances();
        expect(store.balances()[WNURA.toLowerCase()]).toBe(100n);
    });

    it('reads nothing at all with no account connected', async () =>
    {
        const { store } = await loadStore();
        store.watchTokens([WNURA]);
        await store.refreshBalances();
        expect(store.balances()).toEqual({});
    });

    it('refuses to hand out a wallet client before one is connected', async () =>
    {
        const { store } = await loadStore();
        expect(() => store.requiredWallet()).toThrow(/not connected/i);
    });
});
