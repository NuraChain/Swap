// The wallet store: EIP-6963 discovery, connection state, balances, and the
// pending-transaction queue. SSR-safe by construction - nothing here touches
// window at module scope, and discovery starts only when the UI asks for it.
//
// Refresh model: receipts and a 5s visible-tab timer, never per-block. The local
// chain automines (no blocks while idle) and public RPCs price per-poll, so
// block-driven UI would starve on one and overspend on the other.

import { createSignal } from 'azerothjs';
import { createWalletClient, custom, type WalletClient } from 'viem';

import { ERC20_ABI, chainOf, deployment, ensureDeployment, explorerTxUrl, publicClient, type Address } from '../chain.ts';
import { t } from '../i18n.ts';
import { classifyTxError } from '../tx-errors.ts';
import { pushToast, resolveToast } from '../toast.ts';

export interface Eip1193Provider
{
    request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
    on?: (event: string, handler: (payload: never) => void) => void;
    removeListener?: (event: string, handler: (payload: never) => void) => void;
}

// Keyed by rdns, the identity EIP-6963 exists to provide: every announced
// wallet is admitted - hard-coded brand lists are what made installed wallets
// report "not detected".
export interface WalletOption
{
    id: string;
    name: string;
    icon: string | null;
    provider: Eip1193Provider | null;
}

interface Eip6963Detail
{
    info: { uuid: string; name: string; icon: string; rdns: string };
    provider: Eip1193Provider;
}

const SESSION_KEY = 'nuraswap.wallet';

function readSession(): string | null
{
    try
    {
        return window.localStorage.getItem(SESSION_KEY);
    }
    catch
    {
        return null;
    }
}

function writeSession(rdns: string | null): void
{
    try
    {
        if (rdns === null)
        {
            window.localStorage.removeItem(SESSION_KEY);
        }
        else
        {
            window.localStorage.setItem(SESSION_KEY, rdns);
        }
    }
    catch
    {
        // Session lives for this load only.
    }
}

const [optionsSignal, setOptions] = createSignal<WalletOption[]>([]);
const [accountSignal, setAccount] = createSignal<Address | null>(null);
const [chainIdSignal, setChainId] = createSignal<number | null>(null);
const [connectedViaSignal, setConnectedVia] = createSignal<string | null>(null);
const [balancesSignal, setBalances] = createSignal<Record<string, bigint>>({});
const [nativeBalanceSignal, setNativeBalance] = createSignal<bigint>(0n);
const [txEpochSignal, setTxEpoch] = createSignal(0);

let walletClient: WalletClient | null = null;
let activeProvider: Eip1193Provider | null = null;
let discoveryStarted = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let watchedTokens: Address[] = [];

export const walletOptions = optionsSignal;
export const account = accountSignal;
export const walletChainId = chainIdSignal;
export const connectedVia = connectedViaSignal;
export const balances = balancesSignal;
export const nativeBalance = nativeBalanceSignal;
// Bumped after every confirmed transaction and every poll tick - quote and
// position reads hang their refresh on this.
export const txEpoch = txEpochSignal;

export function requiredWallet(): WalletClient
{
    if (walletClient === null)
    {
        throw new Error('wallet not connected');
    }
    return walletClient;
}

export function startDiscovery(): void
{
    if (discoveryStarted || typeof window === 'undefined')
    {
        return;
    }
    discoveryStarted = true;
    const savedRdns = readSession();
    window.addEventListener('eip6963:announceProvider', (event) =>
    {
        const detail = (event as CustomEvent<Eip6963Detail>).detail;
        const rdns = detail.info.rdns || detail.info.uuid;
        if (optionsSignal().some((option) => option.id === rdns))
        {
            return;
        }
        const option: WalletOption = { id: rdns, name: detail.info.name, icon: detail.info.icon, provider: detail.provider };
        setOptions([...optionsSignal(), option]);
        // A remembered wallet restores silently: eth_accounts never prompts.
        if (rdns === savedRdns && accountSignal() === null)
        {
            void restoreSession(option);
        }
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
}

async function restoreSession(option: WalletOption): Promise<void>
{
    if (option.provider === null)
    {
        return;
    }
    try
    {
        const accounts = await option.provider.request({ method: 'eth_accounts' }) as string[];
        if (accounts.length === 0)
        {
            return;
        }
        const info = await ensureDeployment();
        const chainIdHex = await option.provider.request({ method: 'eth_chainId' }) as string;
        activeProvider = option.provider;
        walletClient = createWalletClient({
            account: accounts[0] as Address,
            chain: chainOf(info),
            transport: custom(option.provider as never)
        });
        setAccount(accounts[0] as Address);
        setChainId(Number(chainIdHex));
        setConnectedVia(option.name);
        bindProviderEvents(option.provider);
        startPolling();
        void refreshBalances();
    }
    catch
    {
        writeSession(null);
    }
}

function startPolling(): void
{
    if (pollTimer !== null || typeof window === 'undefined')
    {
        return;
    }
    pollTimer = setInterval(() =>
    {
        if (!document.hidden && accountSignal() !== null)
        {
            void refreshBalances();
            setTxEpoch(txEpochSignal() + 1);
        }
    }, 5000);
}

export function watchTokens(tokens: Address[]): void
{
    watchedTokens = tokens;
    void refreshBalances();
}

export async function refreshBalances(): Promise<void>
{
    const owner = accountSignal();
    const info = deployment();
    if (owner === null || info === null)
    {
        return;
    }
    try
    {
        const reads = await publicClient().multicall({
            contracts: watchedTokens.map((token) => ({
                address: token,
                abi: ERC20_ABI,
                functionName: 'balanceOf' as const,
                args: [owner] as const
            })),
            allowFailure: true
        });
        const next: Record<string, bigint> = {};
        watchedTokens.forEach((token, index) =>
        {
            const read = reads[index];
            next[token.toLowerCase()] = read.status === 'success' ? (read.result as bigint) : 0n;
        });
        setBalances(next);
        setNativeBalance(await publicClient().getBalance({ address: owner }));
    }
    catch
    {
        // Transient RPC failure - the next tick retries.
    }
}

function bindProviderEvents(provider: Eip1193Provider): void
{
    provider.on?.('accountsChanged', (accounts: never) =>
    {
        const list = accounts as unknown as string[];
        if (list.length === 0)
        {
            disconnect();
        }
        else
        {
            setAccount(list[0] as Address);
            void refreshBalances();
        }
    });
    provider.on?.('chainChanged', (chainIdHex: never) =>
    {
        setChainId(Number(chainIdHex as unknown as string));
    });
    provider.on?.('disconnect', () => disconnect());
}

export async function connectInjected(option: WalletOption): Promise<void>
{
    if (option.provider === null)
    {
        return;
    }
    const info = await ensureDeployment();
    const accounts = await option.provider.request({ method: 'eth_requestAccounts' }) as string[];
    if (accounts.length === 0)
    {
        return;
    }
    const chainIdHex = await option.provider.request({ method: 'eth_chainId' }) as string;
    activeProvider = option.provider;
    walletClient = createWalletClient({
        account: accounts[0] as Address,
        chain: chainOf(info),
        transport: custom(option.provider as never)
    });
    setAccount(accounts[0] as Address);
    setChainId(Number(chainIdHex));
    setConnectedVia(option.name);
    writeSession(option.id);
    bindProviderEvents(option.provider);
    startPolling();
    void refreshBalances();
}

// Used by the dev wallet module (dev builds only) to install a ready client.
export function adoptWallet(clientToAdopt: WalletClient, address: Address, chainId: number, label: string): void
{
    walletClient = clientToAdopt;
    activeProvider = null;
    setAccount(address);
    setChainId(chainId);
    setConnectedVia(label);
    startPolling();
    void refreshBalances();
}

export function disconnect(): void
{
    walletClient = null;
    activeProvider = null;
    setAccount(null);
    setChainId(null);
    setConnectedVia(null);
    setBalances({});
    setNativeBalance(0n);
    writeSession(null);
}

export function onRightChain(): boolean
{
    const info = deployment();
    return info !== null && chainIdSignal() === info.chainId;
}

export async function switchChain(): Promise<void>
{
    const info = deployment();
    if (info === null)
    {
        return;
    }
    const hexId = `0x${ info.chainId.toString(16) }`;
    if (activeProvider === null)
    {
        setChainId(info.chainId);
        return;
    }
    try
    {
        await activeProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    }
    catch
    {
        await activeProvider.request({
            method: 'wallet_addEthereumChain',
            params: [{
                chainId: hexId,
                chainName: `NuraSwap ${ info.networkName }`,
                nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                rpcUrls: [info.rpcUrl],
                blockExplorerUrls: info.explorerUrl === null ? [] : [info.explorerUrl]
            }]
        });
    }
    setChainId(info.chainId);
}

// Wraps a transaction: pending toast, receipt wait, resolved toast with explorer
// link, balance refresh, and a txEpoch bump so quotes re-read the pool.
export async function sendTx(label: string, send: () => Promise<`0x${ string }`>): Promise<boolean>
{
    const toastId = pushToast('pending', `${ label }…`);
    try
    {
        // The chain guard lives HERE, not on each button: the swap page gated its
        // action but add/remove liquidity and the faucet did not, so on the wrong
        // network those threw a chain mismatch that surfaced as a generic
        // "failed on-chain" - the one message guaranteed to send someone hunting
        // for a problem with their funds. Offer the switch first; a user on the
        // wrong network wants to be on the right one.
        if (!onRightChain())
        {
            await switchChain().catch(() => undefined);
            if (!onRightChain())
            {
                resolveToast(toastId, 'error', t().errors.wrongNetwork);
                return false;
            }
        }
        const hash = await send();
        const url = explorerTxUrl(hash);
        const receipt = await publicClient().waitForTransactionReceipt({ hash });
        const ok = receipt.status === 'success';
        resolveToast(
            toastId,
            ok ? 'success' : 'error',
            ok ? `${ label } - ${ t().wallet.confirmed }` : `${ label } - ${ t().wallet.failed }`,
            url === null ? undefined : { href: url, label: t().common.viewExplorer }
        );
        await refreshBalances();
        setTxEpoch(txEpochSignal() + 1);
        return ok;
    }
    catch (error)
    {
        resolveToast(toastId, 'error', mapTxError(error));
        return false;
    }
}

function mapTxError(error: unknown): string
{
    return t().errors[classifyTxError(error)];
}
