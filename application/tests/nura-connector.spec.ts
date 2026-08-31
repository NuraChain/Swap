// The Nura Wallet connector loader. Nura Wallet is an app, not an extension, so
// in any browser it did not open itself the deep-link connector is the ONLY way
// it can appear in the connect sheet at all. Nothing here is visible: the
// failures are a connector that never loads, a second copy announcing the same
// wallet twice, and a chain id invented locally instead of read from the
// deployment - which would paint "wrong network" over a wallet that is on it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NuraWindow } from '../src/lib/wallet/nura.ts';

// The two names the connector and the wallet's own browser put on `window`.
const host = window as unknown as NuraWindow;

// A fresh module instance per test: the loader runs once per page by design.
vi.setConfig({ testTimeout: 30_000 });

async function loadLoader(): Promise<typeof import('../src/lib/wallet/nura.ts')>
{
    vi.resetModules();
    return await import('../src/lib/wallet/nura.ts');
}

/**
 * happy-dom refuses to CONNECT a `<script src>` - it does not run foreign
 * JavaScript, by design. Intercepting the insertion is what makes the loader
 * testable at all, and what arrives here is the real element it built.
 */
function capturedScripts(): HTMLScriptElement[]
{
    const captured: HTMLScriptElement[] = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) =>
    {
        captured.push(node as HTMLScriptElement);
        return node;
    }) as typeof document.head.appendChild);
    return captured;
}

beforeEach(() =>
{
    delete host.NuraConnector;
    delete host.__nuraWallet;
});

afterEach(() =>
{
    vi.restoreAllMocks();
    delete host.NuraConnector;
    delete host.__nuraWallet;
});

describe('nura wallet connector', () =>
{
    it('announces with the deployment chain id once the connector has loaded', async () =>
    {
        const scripts = capturedScripts();
        const { startNuraConnector } = await loadLoader();
        startNuraConnector(1020);
        expect(scripts).toHaveLength(1);
        expect(scripts[0].src).toContain('/nura-connector.js');
        const init = vi.fn();
        host.NuraConnector = { init };
        scripts[0].dispatchEvent(new Event('load'));
        expect(init).toHaveBeenCalledWith({ chainId: 1020 });
    });

    it('loads the connector once however often it is asked', async () =>
    {
        const scripts = capturedScripts();
        const { startNuraConnector } = await loadLoader();
        startNuraConnector(1020);
        startNuraConnector(1020);
        expect(scripts).toHaveLength(1);
    });

    it('announces through a connector that is already on the page', async () =>
    {
        const scripts = capturedScripts();
        const init = vi.fn();
        host.NuraConnector = { init };
        const { startNuraConnector } = await loadLoader();
        startNuraConnector(1020);
        expect(init).toHaveBeenCalledWith({ chainId: 1020 });
        expect(scripts).toHaveLength(0);
    });

    // The wallet's own dapp browser injects a full provider that announces
    // itself. Fetching the shim there would cost a request to be told so.
    it('stays out of the way inside the wallet own browser', async () =>
    {
        const scripts = capturedScripts();
        host.__nuraWallet = {};
        const { startNuraConnector } = await loadLoader();
        startNuraConnector(1020);
        expect(scripts).toHaveLength(0);
    });
});
