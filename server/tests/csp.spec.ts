// The CSP is only as good as its weakest directive, and its most fragile part is
// the hash allowing the inline pre-paint theme script. Edit that script without
// updating the hash and the browser silently blocks it: the app still works but
// every visitor gets a flash of the wrong theme. This recomputes the hash from
// the BUILT html and fails loudly instead.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { THEME_SCRIPT_HASH, buildCsp } from '../src/csp.ts';

const BUILT_HTML = fileURLToPath(new URL('../../application/dist/index.html', import.meta.url));

describe('buildCsp', () =>
{
    it('lists the chain RPC in connect-src - forgetting it bricks every read', () =>
    {
        const csp = buildCsp({ rpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545', explorerUrl: null });
        expect(csp).toContain('https://data-seed-prebsc-1-s1.bnbchain.org:8545');
        expect(csp).toContain("connect-src 'self'");
    });

    it('allows the websocket form of the RPC origin', () =>
    {
        const csp = buildCsp({ rpcUrl: 'https://rpc.example.com', explorerUrl: null });
        expect(csp).toContain('wss://rpc.example.com');
    });

    it('never allows inline or eval script - the directive that actually matters', () =>
    {
        const csp = buildCsp({ rpcUrl: 'https://x.io', explorerUrl: null });
        const scriptSrc = csp.split('; ').find((part) => part.startsWith('script-src'));
        expect(scriptSrc).toBeDefined();
        expect(scriptSrc).not.toContain("'unsafe-inline'");
        expect(scriptSrc).not.toContain("'unsafe-eval'");
        expect(scriptSrc).toContain(THEME_SCRIPT_HASH);
    });

    it('locks down the classic injection vectors', () =>
    {
        const csp = buildCsp({ rpcUrl: 'https://x.io', explorerUrl: null });
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("base-uri 'self'");
        expect(csp).toContain("form-action 'self'");
    });

    it('permits data: images - EIP-6963 wallets ship their icons that way', () =>
    {
        expect(buildCsp({ rpcUrl: 'https://x.io', explorerUrl: null }))
            .toContain("img-src 'self' data:");
    });

    it('survives a malformed rpc url rather than emitting a broken directive', () =>
    {
        const csp = buildCsp({ rpcUrl: 'not a url', explorerUrl: null });
        expect(csp).toContain("connect-src 'self'");
        expect(csp).not.toContain('undefined');
        expect(csp).not.toContain('null');
    });
});

describe('inline theme script hash', () =>
{
    it('matches the script in the built html', () =>
    {
        if (!existsSync(BUILT_HTML))
        {
            // Nothing to check before a build; CI always builds first.
            return;
        }
        const html = readFileSync(BUILT_HTML, 'utf8');
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
        expect(inline.length).toBe(1);
        const hash = `sha256-${ createHash('sha256').update(inline[0][1], 'utf8').digest('base64') }`;
        expect(
            hash,
            'The inline theme script changed. Update THEME_SCRIPT_HASH in server/src/csp.ts to this value.'
        ).toBe(THEME_SCRIPT_HASH);
    });
});
