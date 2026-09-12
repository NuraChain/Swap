// Content-Security-Policy for a money application.
//
// The threat this answers: injected script on a DEX front-end does not deface a
// page, it rewrites the router address or the recipient of an approval and the
// user signs it. `securityHeaders()` ships sensible defaults but sets no CSP, so
// this adds one, and keeps it TIGHT - no 'unsafe-inline' for scripts.
//
// connect-src must list the chain RPC: the browser reads reserves, balances and
// quotes directly from it, so a policy that forgets the RPC bricks the whole app
// while looking fine on the landing page. It is derived from the active
// deployment rather than hardcoded, so a testnet/mainnet switch cannot desync.

/**
 * The pre-paint theme script in index.html is inline BY DESIGN - it must run
 * before first paint to avoid a flash of the wrong theme, and an external file
 * costs a blocking round trip. It is therefore allowed by hash. `csp.spec.ts`
 * recomputes this from the built HTML and fails if the script drifts.
 */
export const THEME_SCRIPT_HASH = 'sha256-+4y84WB4TTY5nGmWZTVe1CnQFcVst3HuJ0TiSe6rmGk=';

/**
 * Cloudflare Web Analytics. The beacon is injected by the PROXY in front of this
 * app, not by anything in this repository, so a policy that omits it reports a
 * violation on every page load of the production site and the console is never
 * clean. Two origins, and they are not interchangeable: the script is served
 * from `static.`, and it POSTs what it measures to the apex.
 *
 * This is the only external script the policy allows. Turning the injection off
 * in the Cloudflare dashboard is the other way to silence it - do that and these
 * two entries should come back out.
 */
const CLOUDFLARE_BEACON_SCRIPT = 'https://static.cloudflareinsights.com';
const CLOUDFLARE_BEACON_ENDPOINT = 'https://cloudflareinsights.com';

function originOf(url: string): string | null
{
    try
    {
        return new URL(url).origin;
    }
    catch
    {
        return null;
    }
}

export interface CspInput
{
    /** The chain RPC the browser reads from. */
    rpcUrl: string;
    /** Block explorer, linked from toasts and the wallet menu. */
    explorerUrl: string | null;
}

export function buildCsp(input: CspInput): string
{
    const connect = new Set(["'self'", CLOUDFLARE_BEACON_ENDPOINT]);
    const rpc = originOf(input.rpcUrl);
    if (rpc !== null)
    {
        connect.add(rpc);
        // Wallets and RPC providers commonly upgrade to a websocket subscription.
        connect.add(rpc.replace(/^http/, 'ws'));
    }

    const directives: Record<string, string> = {
        'default-src': "'self'",
        'base-uri': "'self'",
        'object-src': "'none'",
        'frame-ancestors': "'none'",
        'form-action': "'self'",
        'script-src': `'self' '${ THEME_SCRIPT_HASH }' ${ CLOUDFLARE_BEACON_SCRIPT }`,
        // Style ATTRIBUTES carry the token gradients, the identicon, and the chart
        // geometry. Style injection cannot move funds the way script injection can,
        // so this is the one relaxation.
        'style-src': "'self' 'unsafe-inline'",
        // Wallet icons arrive as data: URIs over EIP-6963. Everything else the page
        // draws - the app icons, the sprite, the flags - is served from this origin.
        'img-src': "'self' data:",
        'font-src': "'self'",
        'connect-src': [...connect].join(' '),
        'upgrade-insecure-requests': ''
    };

    return Object.entries(directives)
        .map(([name, value]) => (value === '' ? name : `${ name } ${ value }`))
        .join('; ');
}
