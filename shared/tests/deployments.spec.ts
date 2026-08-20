// The deployment artifact is this repository's only piece of configuration, and
// it is a list of addresses people send money to. It is written by another
// repository's deploy script and committed here, which means nothing between the
// two halves validates it - these tests are that validation.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadDeployment, loadDeploymentIfPresent } from '../src/deployments.ts';
import type { Deployment } from '../src/deployments.ts';

const DEPLOYMENTS_DIR = fileURLToPath(new URL('../deployments/', import.meta.url));

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function committedChainIds(): number[]
{
    return readdirSync(DEPLOYMENTS_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => Number(name.replace('.json', '')));
}

describe('the loader', () =>
{
    it('loads a committed artifact', () =>
    {
        const [chainId] = committedChainIds();
        const deployment = loadDeployment(chainId);
        expect(deployment.chainId).toBe(chainId);
    });

    it('answers null for a chain with no artifact instead of throwing', () =>
    {
        // main.ts branches on this to print "run the contracts deploy first"
        // rather than dying with a filesystem error.
        expect(loadDeploymentIfPresent(999_999)).toBeNull();
    });

    it('throws when a caller demands an artifact that is not there', () =>
    {
        expect(() => loadDeployment(999_999)).toThrow();
    });

    it('reads a fresh copy rather than handing out one shared object', () =>
    {
        const [chainId] = committedChainIds();
        const first = loadDeployment(chainId);
        const second = loadDeployment(chainId);
        expect(first).not.toBe(second);
        first.tokens.length = 0;
        expect(second.tokens.length).toBeGreaterThan(0);
    });

    // The path is built from the chain id, so a non-numeric one would address a
    // file outside the deployments folder. Nothing in this repo can reach that -
    // CHAIN_ID goes through a numeric config parse first - but a loader that
    // builds a path from its argument should refuse the shape outright.
    it('refuses a chain id that is not a plain non-negative integer', () =>
    {
        for (const hostile of ['../package', '../../package', 1.5, -1, NaN, Infinity])
        {
            expect(() => loadDeployment(hostile as number), String(hostile)).toThrow(TypeError);
            expect(() => loadDeploymentIfPresent(hostile as number), String(hostile)).toThrow(TypeError);
        }
    });
});

describe.each(committedChainIds())('the committed artifact for chain %i', (chainId) =>
{
    const deployment = loadDeployment(chainId);

    it('agrees with the file it is named by', () =>
    {
        expect(deployment.chainId).toBe(chainId);
        expect(Number.isSafeInteger(deployment.chainId)).toBe(true);
        expect(deployment.chainId).toBeGreaterThan(0);
    });

    it('names a network and a reachable-looking RPC', () =>
    {
        expect(deployment.networkName.length).toBeGreaterThan(0);
        expect(() => new URL(deployment.rpcUrl)).not.toThrow();
        // The CSP derives connect-src from this; an http origin in production
        // would be blocked by upgrade-insecure-requests.
        expect(new URL(deployment.rpcUrl).protocol).toBe('https:');
    });

    it('either has no explorer or a well-formed one', () =>
    {
        if (deployment.explorerUrl !== null)
        {
            expect(() => new URL(deployment.explorerUrl as string)).not.toThrow();
            // Toast links append /tx/<hash>; a trailing slash would double it.
            expect(deployment.explorerUrl?.endsWith('/')).toBe(false);
        }
    });

    it('starts indexing at a real block', () =>
    {
        expect(Number.isSafeInteger(deployment.startBlock)).toBe(true);
        expect(deployment.startBlock).toBeGreaterThanOrEqual(0);
    });

    it('gives every core contract a well-formed, distinct address', () =>
    {
        const contracts = deployment.contracts;
        for (const [name, address] of Object.entries(contracts))
        {
            expect(address, name).toMatch(ADDRESS);
            expect(BigInt(address), `${ name } must not be the zero address`).not.toBe(0n);
        }
        const unique = new Set(Object.values(contracts).map((address) => address.toLowerCase()));
        expect(unique.size, 'two contracts share an address').toBe(Object.keys(contracts).length);
    });

    it('lists tokens with unique addresses and sane decimals', () =>
    {
        expect(deployment.tokens.length).toBeGreaterThan(0);
        const seen = new Set<string>();
        for (const token of deployment.tokens)
        {
            expect(token.address, token.symbol).toMatch(ADDRESS);
            expect(BigInt(token.address)).not.toBe(0n);
            expect(token.symbol.length).toBeGreaterThan(0);
            expect(token.name.length).toBeGreaterThan(0);
            expect(Number.isInteger(token.decimals)).toBe(true);
            expect(token.decimals).toBeGreaterThanOrEqual(0);
            // Beyond 36 the 1e18 scaling in shared/math would underflow to zero.
            expect(token.decimals).toBeLessThanOrEqual(36);
            const key = token.address.toLowerCase();
            expect(seen.has(key), `${ token.symbol } duplicates an address`).toBe(false);
            seen.add(key);
        }
    });

    // The swap page treats WNURA as the native wrapper and routes every
    // multi-hop trade through it. If the artifact's wrapper is not a token the
    // registry serves, the picker cannot offer the wrap pair at all.
    it('serves the wrapped native token in its own token list', () =>
    {
        const listed = deployment.tokens.some(
            (token) => token.address.toLowerCase() === deployment.contracts.wnura.toLowerCase()
        );
        expect(listed).toBe(true);
    });

    it('either omits V3 or gives it a complete, well-formed address set', () =>
    {
        const v3 = deployment.v3;
        if (v3 === undefined || v3 === null)
        {
            return;
        }
        expect(Object.keys(v3).sort()).toEqual(['factory', 'positionManager', 'quoter', 'swapRouter', 'tickLens']);
        for (const [name, address] of Object.entries(v3))
        {
            expect(address, name).toMatch(ADDRESS);
            expect(BigInt(address), `v3.${ name } must not be the zero address`).not.toBe(0n);
        }
        // The V3 factory is a different contract from the V2 one; sharing an
        // address would mean the app quotes V3 against a V2 factory.
        expect(v3.factory.toLowerCase()).not.toBe(deployment.contracts.factory.toLowerCase());
        expect(v3.swapRouter.toLowerCase()).not.toBe(deployment.contracts.router.toLowerCase());
        expect(new Set(Object.values(v3).map((address) => address.toLowerCase())).size).toBe(5);
    });

    it('holds no unexpected top-level keys', () =>
    {
        // A key the loader does not know about is a contract the app will not
        // read - most likely a rename that landed on one side only.
        const raw = JSON.parse(readFileSync(`${ DEPLOYMENTS_DIR }${ chainId }.json`, 'utf8')) as Record<string, unknown>;
        const known = ['chainId', 'networkName', 'rpcUrl', 'explorerUrl', 'faucet', 'startBlock', 'contracts', 'v3', 'tokens'];
        expect(Object.keys(raw).filter((key) => !known.includes(key))).toEqual([]);
    });

    it('says plainly whether its tokens have a faucet', () =>
    {
        expect(typeof deployment.faucet).toBe('boolean');
    });

    it('round-trips through JSON unchanged - it crosses the wire as-is', () =>
    {
        const copy = JSON.parse(JSON.stringify(deployment)) as Deployment;
        expect(copy).toEqual(deployment);
    });
});
