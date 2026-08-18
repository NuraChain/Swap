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
    tokens: DeployedToken[];
}

// Node-side loader (server, scripts). The frontend never reads these files - it
// receives the active deployment over /api so the bundle stays generation-free.
function fileFor(chainId: number): string
{
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
