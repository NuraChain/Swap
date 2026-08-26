// Chain access for the browser: the active deployment comes from the server
// (/api/market/deployment) so the bundle carries no generated addresses, and the
// public client reads the chain directly over the deployment's RPC.

import { createSignal } from 'azerothjs';
import { createPublicClient, defineChain, http, parseAbi, type Chain, type PublicClient } from 'viem';

import { client } from '../api.ts';
import type { DeploymentInfo, TokenRef } from '../api.ts';

export type Address = `0x${ string }`;

/** The zero address - what a factory answers for "no such pool". */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// The native pseudo-token: swaps route through the router's ETH entrypoints and
// WNURA<->NURA is a direct wrap. Everything else treats it as WNURA - hopAddress
// maps it to the wrapper before any contract call.
export const NATIVE_TOKEN: TokenRef = { address: 'nura', symbol: 'NURA', name: 'NURA', decimals: 18 };

export function isNativeToken(token: TokenRef | null): boolean
{
    return token?.address === NATIVE_TOKEN.address;
}

/** Slippage tolerance for the liquidity flows, in basis points. The swap card
 *  keeps its own user-set one; these deposits/withdrawals use this fixed band. */
export const LIQUIDITY_SLIPPAGE_BPS = 100;

/**
 * Chain time, not wall time: a local chain's clock can be offset and a user's
 * clock can skew, so deadlines are anchored to the node's own LATEST block -
 * on an automining chain that pending-ish block is the referee the router will
 * actually consult.
 */
export async function chainDeadline(extraSeconds: number): Promise<bigint>
{
    const reader = publicClient();
    const block = await reader.getBlock({ blockTag: 'pending' }).catch(() => reader.getBlock());
    return block.timestamp + BigInt(extraSeconds);
}

/**
 * Refreshes the ERC20 allowances a flow's non-native sides need. The caller
 * paints "approved until the read says otherwise" first; this re-reads the
 * chain over it. Each read stands alone - one transient RPC failure must not
 * take its sibling down or leak a rejection.
 */
export function refreshAllowances(
    owner: Address,
    entries: ReadonlyArray<{ token: TokenRef | null; spender: Address; onValue: (value: bigint) => void }>
): void
{
    for (const entry of entries)
    {
        if (entry.token === null || isNativeToken(entry.token))
        {
            continue;
        }
        void publicClient().readContract({
            address: entry.token.address as Address,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [owner, entry.spender]
        }).then((value) => entry.onValue(value as bigint)).catch(() => undefined);
    }
}

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

export const WNURA_ABI = parseAbi([
    'function deposit() payable',
    'function withdraw(uint256 wad)'
]);

// ---------------------------------------------------------------------------
// UniswapV3. Every fragment below is declared `view` where the deployed function
// is actually nonpayable - the Quoter and the position manager's simulated reads
// among them. eth_call does not check mutability, and viem's readContract does:
// without the lie the quote would have to go through simulateContract and carry
// a gas estimate nobody reads.

export const V3_FACTORY_ABI = parseAbi([
    'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
    // Which tiers this factory actually enables, and at what spacing. The four
    // canonical tiers are a convention, not a guarantee: a factory may enable
    // fewer, or enable one at a spacing of its own. 0 means "not enabled".
    'function feeAmountTickSpacing(uint24 fee) view returns (int24)'
]);

export const V3_POOL_ABI = parseAbi([
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() view returns (uint128)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function fee() view returns (uint24)',
    'function tickSpacing() view returns (int24)'
]);

// QuoterV2 takes its arguments as a struct and answers with the post-swap price
// alongside the amount. Which of the two is deployed is the contracts
// repository's business, so the app probes rather than assumes - see quoteV3 in
// lib/v3.ts.
export const QUOTER_V2_ABI = parseAbi([
    'struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }',
    'function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
]);

/** The original Quoter: flat arguments, one return value. */
export const QUOTER_V1_ABI = parseAbi([
    'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)'
]);

// The canonical SwapRouter. `positionManager()` is not part of its interface -
// it is SwapRouter02's, and calling it is how lib/v3.ts tells the two apart.
export const SWAP_ROUTER_ABI = parseAbi([
    'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
    'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
    'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
    'function refundETH() payable',
    'function positionManager() view returns (address)'
]);

/** SwapRouter02: the same call without a deadline (its multicall carries one). */
export const SWAP_ROUTER_02_ABI = parseAbi([
    'struct ExactInputSingleParams02 { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
    'function exactInputSingle(ExactInputSingleParams02 params) payable returns (uint256 amountOut)',
    'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
    'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
    'function refundETH() payable'
]);

export const POSITION_MANAGER_ABI = parseAbi([
    'struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }',
    'struct IncreaseLiquidityParams { uint256 tokenId; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }',
    'struct DecreaseLiquidityParams { uint256 tokenId; uint128 liquidity; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }',
    'struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }',
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
    'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
    'function mint(MintParams params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
    'function increaseLiquidity(IncreaseLiquidityParams params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)',
    'function decreaseLiquidity(DecreaseLiquidityParams params) payable returns (uint256 amount0, uint256 amount1)',
    'function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)',
    'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)',
    'function burn(uint256 tokenId) payable',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
    'function refundETH() payable'
]);

/** The same fragment as POSITION_MANAGER_ABI.collect, declared readable so the
 *  uncollected-fee probe can eth_call it instead of estimating gas for it. */
export const POSITION_COLLECT_STATIC_ABI = parseAbi([
    'struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }',
    'function collect(CollectParams params) view returns (uint256 amount0, uint256 amount1)'
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

export interface V3Addresses
{
    factory: Address;
    swapRouter: Address;
    quoter: Address;
    positionManager: Address;
    tickLens: Address;
}

/**
 * The V3 contract addresses, or null while the deployment is still loading.
 * Reads the deployment SIGNAL, so a component that guards on it re-renders the
 * moment the artifact lands - which is what lets the page appear whole instead
 * of after a refresh.
 */
export function v3Addresses(): V3Addresses | null
{
    const v3 = deploymentSignal()?.v3;
    if (v3 === undefined)
    {
        return null;
    }
    return {
        factory: v3.factory as Address,
        swapRouter: v3.swapRouter as Address,
        quoter: v3.quoter as Address,
        positionManager: v3.positionManager as Address,
        tickLens: v3.tickLens as Address
    };
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
