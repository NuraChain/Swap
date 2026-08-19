// Chain access for the browser: the active deployment comes from the server
// (/api/market/deployment) so the bundle carries no generated addresses, and the
// public client reads the chain directly over the deployment's RPC.

import { createSignal } from 'azerothjs';
import { createPublicClient, defineChain, http, parseAbi, type Chain, type PublicClient } from 'viem';

import { client } from '../api.ts';
import type { DeploymentInfo } from '../api.ts';

export type Address = `0x${ string }`;

export const ERC20_ABI = parseAbi([
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 value) returns (bool)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function totalSupply() view returns (uint256)'
]);

export const ERC20_BYTES32_ABI = parseAbi([
    'function symbol() view returns (bytes32)',
    'function name() view returns (bytes32)'
]);

export const MOCK_TOKEN_ABI = parseAbi([
    'function faucet(uint256 amount)'
]);

export const FACTORY_ABI = parseAbi([
    'function getPair(address tokenA, address tokenB) view returns (address)',
    'function createPair(address tokenA, address tokenB) returns (address)',
    // Basis points, and NOT the 30 that stock UniswapV2 hardcodes: this factory
    // holds the fee and feeToSetter can retune it, so the number on screen and
    // the number in the impact maths are both read from here.
    'function swapFee() view returns (uint32)'
]);

export const PAIR_ABI = parseAbi([
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
    'function approve(address spender, uint256 value) returns (bool)'
]);

export const ROUTER_ABI = parseAbi([
    'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
    'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
    'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
    'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
    'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)',
    'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)',
    'function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)'
]);

export const WNURA_ABI = parseAbi([
    'function deposit() payable',
    'function withdraw(uint256 wad)'
]);

const [deploymentSignal, setDeployment] = createSignal<DeploymentInfo | null>(null);
let deploymentPromise: Promise<DeploymentInfo> | null = null;
let publicClientCache: PublicClient | null = null;
let chainCache: Chain | null = null;

export function deployment(): DeploymentInfo | null
{
    return deploymentSignal();
}

export function ensureDeployment(): Promise<DeploymentInfo>
{
    // The in-flight promise is shared so N callers cost one request - but a
    // REJECTED one must not be memoized. Caching the failure meant a single bad
    // first load (API still booting, a blip, a page opened before the server)
    // poisoned every later call for the life of the tab: the retry returned the
    // same stale rejection and only a full reload could clear it.
    deploymentPromise ??= client.market.deployment()
        .then((info) =>
        {
            setDeployment(info);
            return info;
        })
        .catch((error: unknown) =>
        {
            deploymentPromise = null;
            throw error;
        });
    return deploymentPromise;
}

export function chainOf(info: DeploymentInfo): Chain
{
    chainCache ??= defineChain({
        id: info.chainId,
        name: info.networkName,
        nativeCurrency: { name: 'NURA', symbol: 'NURA', decimals: 18 },
        rpcUrls: { default: { http: [info.rpcUrl] } },
        blockExplorers: info.explorerUrl === null
            ? undefined
            : { default: { name: 'explorer', url: info.explorerUrl } },
        contracts: { multicall3: { address: info.contracts.multicall3 as Address } }
    });
    return chainCache;
}

export function publicClient(): PublicClient
{
    const info = deploymentSignal();
    if (info === null)
    {
        throw new Error('deployment not loaded yet');
    }
    publicClientCache ??= createPublicClient({ chain: chainOf(info), transport: http(info.rpcUrl) });
    return publicClientCache;
}

export function explorerTxUrl(hash: string): string | null
{
    const info = deploymentSignal();
    if (info === null || info.explorerUrl === null)
    {
        return null;
    }
    return `${ info.explorerUrl }/tx/${ hash }`;
}

export function explorerAddressUrl(address: string): string | null
{
    const info = deploymentSignal();
    if (info === null || info.explorerUrl === null)
    {
        return null;
    }
    return `${ info.explorerUrl }/address/${ address }`;
}
