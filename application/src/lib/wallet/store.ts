// The wallet store: EIP-6963 discovery, connection state, balances, and the
// pending-transaction queue. SSR-safe by construction - nothing here touches
// window at module scope, and discovery starts only when the UI asks for it.
//
// Refresh model: receipts and a 5s visible-tab timer, never per-block. The local
// chain automines (no blocks while idle) and public RPCs price per-poll, so
// block-driven UI would starve on one and overspend on the other.

import { createSignal } from 'azerothjs';
import { createWalletClient, custom, type WalletClient } from 'viem';

import type { DeploymentInfo } from '../../api.ts';
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
// Providers already bound to accountsChanged/chainChanged/disconnect. A second
// connect of the same wallet must not stack a second set of listeners - each
// would fire its own refresh and, worse, its own disconnect() on one event.
const boundProviders = new WeakSet<Eip1193Provider>();

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
        adoptAccount(option.provider, accounts[0] as Address, info);
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

function stopPolling(): void
{
    if (pollTimer !== null)
    {
        clearInterval(pollTimer);
        pollTimer = null;
    }
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

// The signing client and the account signal move TOGETHER, through here. They
// used to be assigned side by side at connect and at restore, and an
// accountsChanged updated only the signal - so the header showed the account the
// user had switched TO while every swap, approve and deposit went on being
// signed as the one they had switched away FROM.
function adoptAccount(provider: Eip1193Provider, address: Address, info: DeploymentInfo): void
{
    activeProvider = provider;
    walletClient = createWalletClient({
        account: address,
        chain: chainOf(info),
        transport: custom(provider as never)
    });
    setAccount(address);
}

function bindProviderEvents(provider: Eip1193Provider): void
{
    if (boundProviders.has(provider))
    {
        return;
    }
    boundProviders.add(provider);
    provider.on?.('accountsChanged', (accounts: never) =>
    {
        const list = accounts as unknown as string[];
        if (list.length === 0)
        {
            disconnect();
            return;
        }
        const info = deployment();
        if (info === null)
        {
            // No artifact yet means no chain to bind a client to. The signal
            // still follows, so the UI never shows an account the wallet left.
            setAccount(list[0] as Address);
        }
        else
        {
            adoptAccount(provider, list[0] as Address, info);
        }
        void refreshBalances();
    });
    provider.on?.('chainChanged', (chainIdHex: never) =>
    {
        setChainId(Number(chainIdHex as unknown as string));
    });
    provider.on?.('disconnect', () => disconnect());
}

/**
 * Connects an announced wallet. Resolves FALSE when nothing connected - a
 * declined prompt, a locked wallet, an unreachable api - so a caller can keep
 * its sheet open instead of stranding the user back at the page.
 */
export async function connectInjected(option: WalletOption): Promise<boolean>
{
    if (option.provider === null)
    {
        return false;
    }
    // The wallet prompt goes FIRST, while the click's user activation is still
    // live. Awaiting anything before it - the deployment fetch used to sit here -
    // spends that activation, and a wallet that has lost it may queue its approval
    // window behind its toolbar icon instead of raising it. To the person clicking,
    // that is a dead button.
    let accounts: string[];
    try
    {
        accounts = await option.provider.request({ method: 'eth_requestAccounts' }) as string[];
    }
    catch (error)
    {
        // 4001 is "user rejected": their own wallet already said so, so we stay
        // quiet. -32002 is a request ALREADY waiting in the wallet - the one case
        // where clicking again genuinely looks like nothing happening, so it is
        // the one that has to be spelled out.
        const code = (error as { code?: number }).code;
        if (code === -32002)
        {
            pushToast('error', t().wallet.alreadyPending);
        }
        else if (code !== 4001)
        {
            pushToast('error', t().wallet.connectFailed);
        }
        return false;
    }
    if (accounts.length === 0)
    {
        // A locked wallet answers an empty list rather than rejecting.
        pushToast('error', t().wallet.connectFailed);
        return false;
    }
    // The deployment still has to load - it names the chain the client is built
    // for - it just no longer stands between the click and the wallet.
    let info: DeploymentInfo;
    try
    {
        info = await ensureDeployment();
    }
    catch
    {
        pushToast('error', t().errors.apiUnreachable);
        return false;
    }
    const chainIdHex = await option.provider.request({ method: 'eth_chainId' }) as string;
    adoptAccount(option.provider, accounts[0] as Address, info);
    setChainId(Number(chainIdHex));
    setConnectedVia(option.name);
    writeSession(option.id);
    bindProviderEvents(option.provider);
    startPolling();
    void refreshBalances();
    return true;
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
    // The 5s poll has nothing to refresh without an account; leaving it running
    // would tick forever on a page whose owner already signed out.
    stopPolling();
}

export function onRightChain(): boolean
{
    const info = deployment();
    return info !== null && chainIdSignal() === info.chainId;
}

// ONE definition of the network, shared by the automatic add (the switch
// fallback below) and the explicit "add to wallet" button. Wallets key networks
// by chain id, so two call sites describing the same chain differently is how
// you end up with a wallet entry whose name depends on which button was pressed.
function addChainParams(info: NonNullable<ReturnType<typeof deployment>>): object
{
    return {
        chainId: `0x${ info.chainId.toString(16) }`,
        chainName: info.networkName,
        nativeCurrency: { name: 'NURA', symbol: 'NURA', decimals: 18 },
        rpcUrls: [info.rpcUrl],
        // Absent, NOT empty, when there is no explorer: EIP-3085 asks for null or
        // at least one URL, and MetaMask enforces it - an empty array comes back
        // -32602 "Expected null or array with at least one valid string HTTPS
        // URL", which failed the whole add for a deployment that simply has no
        // explorer configured.
        ...(info.explorerUrl === null ? {} : { blockExplorerUrls: [info.explorerUrl] })
    };
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
    catch (error)
    {
        // "Unknown chain" is 4902 by the spec, but wallets disagree in practice -
        // forks answer -32603 or 4200 for the same condition - so the fallback
        // fires on anything that is NOT an explicit refusal rather than on one
        // code. The test matters in the other direction too: catching everything
        // meant a DECLINED switch was answered by immediately asking to add the
        // chain, a second prompt for someone who had just said no.
        if (classifyTxError(error) === 'rejected')
        {
            return;
        }
        await activeProvider.request({
            method: 'wallet_addEthereumChain',
            params: [addChainParams(info)]
        });
    }
    setChainId(info.chainId);
}

/**
 * Registers the exchange's chain in the connected wallet on demand. Unlike
 * switchChain this never switches first: it is for the person who wants the
 * network in their wallet list before (or without) trading. A rejected prompt is
 * a normal outcome, not an error worth a red toast.
 */
export async function addChainToWallet(): Promise<void>
{
    // Registering a network needs no session: wallet_addEthereumChain is
    // answerable by any injected provider, and this button exists FOR the
    // visitor who has not connected yet - which is what the paragraph above
    // promises and what requiring `activeProvider` quietly took away.
    //
    // Prefer the connected wallet. Otherwise, when exactly one wallet announced
    // itself, ask that one. With several installed and none connected there is
    // no way to know which was meant, so ask them to connect and choose.
    const announced = optionsSignal()
        .map((option) => option.provider)
        .filter((provider): provider is Eip1193Provider => provider !== null);
    const provider = activeProvider ?? (announced.length === 1 ? announced[0] : null);
    if (provider === null)
    {
        pushToast('error', t().common.addChainNoWallet);
        return;
    }
    // The chain parameters ARE the deployment - id, name, RPC, explorer - so
    // there is nothing to hand the wallet without it. It is normally warm by the
    // time anyone clicks; when the api half is unreachable it never arrives, and
    // this button used to answer that by doing nothing at all. Ask for it here
    // and say what happened when it does not come.
    let info: DeploymentInfo;
    try
    {
        info = await ensureDeployment();
    }
    catch
    {
        pushToast('error', t().errors.apiUnreachable);
        return;
    }
    try
    {
        await provider.request({
            method: 'wallet_addEthereumChain',
            params: [addChainParams(info)]
        });
        pushToast('success', t().common.addChainDone);
    }
    catch (error)
    {
        // A declined prompt is a normal outcome: the user saw their own wallet ask
        // and said no, so a red toast would only restate it. Everything else is
        // NOT that - a malformed parameter (-32602) or a provider that does not
        // implement the method at all (4200) landed here too, and swallowing them
        // left a button that visibly did nothing, the one failure a user cannot
        // tell apart from a broken page.
        if (classifyTxError(error) !== 'rejected')
        {
            pushToast('error', t().common.addChainFailed);
        }
    }
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
