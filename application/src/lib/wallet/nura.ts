// Nura Wallet outside its own browser.
//
// Nura Wallet is a desktop and Android app, not an extension: it can inject a
// provider only into pages opened in ITS dapp browser, and there it announces
// itself over EIP-6963 like any other wallet. Everywhere else - Chrome, Safari,
// the Android browser - the only transport it has is the `nurawallet://` deep
// link, and a page that does nothing about that lists every wallet except the
// one this chain ships.
//
// The wallet answers that with a connector: a shim that announces a "Nura
// Wallet" EIP-6963 provider whose requests travel over the deep link and come
// back in the URL fragment. Announced is announced - discovery in store.ts
// admits it by rdns like anything else, and nothing downstream has to know a
// signature left over a deep link rather than a message port.
//
// `public/nura-connector.js` is a VERBATIM copy of `sdk/nura-connector.js` from
// the wallet repository. Re-copy it to update; do not edit it here, or the next
// copy silently drops the change.

const CONNECTOR_SRC = '/nura-connector.js';

// Nura Wallet's own mark, a verbatim copy of `src/assets/image/logo.png` from
// the wallet repository - the same rule as the connector: re-copy to update, do
// not redraw it here. The connector ships a neutral placeholder for a host that
// passes no icon, so without this the one wallet this chain ships is the only
// row in the connect sheet wearing a glyph that is not its logo.
//
// A raster, not a vector, because the wallet has no vector to copy; 128px for a
// 24px slot covers every device pixel ratio the sheet is read at.
const CONNECTOR_ICON = '/wallets/nura.png';

/**
 * What the connector puts on `window`, plus what the wallet's OWN browser puts
 * there. Read through a cast rather than a global `Window` augmentation: these
 * two names exist on exactly one page in one deployment, and widening the global
 * type would offer them to every file that never checked they are there.
 */
export interface NuraWindow
{
    NuraConnector?: { init: (options: { chainId?: number; icon?: string }) => void };
    /** Set by the wallet's own dapp browser, which injects a full provider. */
    __nuraWallet?: unknown;
}

let started = false;

/**
 * Loads the connector and lets it announce Nura Wallet to the connect sheet.
 * Browser only, once per page.
 *
 * The chain id is the DEPLOYMENT's, not a constant: the connector answers
 * `eth_chainId` locally, and a wrong answer there paints the wrong-network
 * banner over a wallet that is in fact on the right chain.
 */
export function startNuraConnector(chainId: number): void
{
    if (started || typeof document === 'undefined')
    {
        return;
    }
    started = true;
    const host = window as unknown as NuraWindow;
    // Inside the wallet's own browser the injected provider is already there and
    // the connector would return anyway - skip the request entirely.
    if (host.__nuraWallet !== undefined)
    {
        return;
    }
    if (host.NuraConnector !== undefined)
    {
        host.NuraConnector.init({ chainId, icon: CONNECTOR_ICON });
        return;
    }
    const script = document.createElement('script');
    script.src = CONNECTOR_SRC;
    script.async = true;
    // No error handler on purpose. A connector that will not load is not worth a
    // toast: every announced wallet still connects, the sheet simply does not
    // list this one, and the browser has already said so in the console.
    script.addEventListener('load', () =>
    {
        host.NuraConnector?.init({ chainId, icon: CONNECTOR_ICON });
    });
    document.head.appendChild(script);
}
