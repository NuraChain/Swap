import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Address = `0x${ string }`;

export interface DeployedToken
{
    address: Address;
    symbol: string;
    name: string;
    decimals: number;
}

// UniswapV3 is OPTIONAL, and optional all the way down: a chain can carry the V2
// factory alone and every half of this repo still runs - the indexer skips the V3
// scan, the API serves `v3: null`, and the app hides the fee-tier and range
// controls instead of pointing them at a zero address. A deployment artifact
// written before V3 existed stays valid, unedited.
export interface V3Contracts
{
    factory: Address;
    swapRouter: Address;
    quoter: Address;
    positionManager: Address;
    tickLens: Address;
}

export interface Deployment
{
    chainId: number;
    networkName: string;
    rpcUrl: string;
    explorerUrl: string | null;
    /** The mock tokens expose their public faucet (dev chains and testnets only). */
    faucet: boolean;
    startBlock: number;
    contracts:
    {
        factory: Address;
        router: Address;
        wnura: Address;
        multicall3: Address;
    };
    v3?: V3Contracts | null;
    tokens: DeployedToken[];
}

// Node-side loader (server, scripts). The frontend never reads these files - it
// receives the active deployment over /api so the bundle stays generation-free.
function fileFor(chainId: number): string
{
    // The chain id becomes part of a filesystem path, so its SHAPE is checked
    // before it is interpolated: '../package' would resolve out of the
    // deployments folder and hand the caller some other JSON file typed as a
    // Deployment. CHAIN_ID reaches this through a numeric config parse today -
    // this is the guard that does not depend on every caller doing that.
    if (!Number.isSafeInteger(chainId) || chainId < 0)
    {
        throw new TypeError(`chain id must be a non-negative integer, got ${ String(chainId) }`);
    }
    return fileURLToPath(new URL(`../deployments/${ chainId }.json`, import.meta.url));
}

export function loadDeployment(chainId: number): Deployment
{
    return JSON.parse(readFileSync(fileFor(chainId), 'utf8')) as Deployment;
}

export function loadDeploymentIfPresent(chainId: number): Deployment | null
{
    return existsSync(fileFor(chainId)) ? loadDeployment(chainId) : null;
}
