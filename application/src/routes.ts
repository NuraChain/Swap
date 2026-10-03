// The one route table: the client router, the SSR entry, and the kit's server half all read
// it, so there is no second manifest. A page is one row; `render` is how it ships.
//
// The kit's 2.1 additions in use here:
//   - `staticParams` enumerates the param sets a parameterized static route prerenders,
//     so the paper's nine translations are build-time files with unlisted params falling
//     through to the live renderer;
//   - `revalidate` turns the landing page into ISR: the build writes a seed, requests
//     serve it fresh for 30s, and past the window a stale copy is answered WHILE one
//     background render replaces it - which is what puts the live market stats into the
//     HTML a crawler reads, instead of a numberless shell the browser fills in.
//
// The route loader is where per-language data belongs now: it runs before the render,
// on both sides, so the prerendered bytes are complete and the client navigation
// downloads only the one translation it needs (one dynamic import per document).
import type { PageRoute } from '@azerothjs/kit';
import { notFound } from 'azerothjs';

import { LANGS, type Lang } from './lib/langs.ts';
import { loadWhitepaper } from './lib/whitepaper/index.ts';
import { client, type Stats } from './api.ts';

import Landing from './pages/landing.azeroth';
import Whitepaper from './pages/whitepaper.azeroth';

// The landing page's data, one fetch everywhere: on the client a relative
// request; on the server (the ISR regeneration render) an absolute one to this
// process's own api, since the in-process bridge rides the per-request identity
// a shared render deliberately has no request to carry. A down api half is not
// a failed build: the loader catches, the seed carries no stats section, and
// the next regeneration fills it.
export async function loadLandingStats(signal?: AbortSignal): Promise<{ stats: Stats | null }>
{
    try
    {
        // The browser walks the same typed client every page uses - one client,
        // one manifest, mockable in tests. The SERVER render (the ISR
        // regeneration) cannot: the in-process bridge rides the per-request
        // identity a shared render deliberately has no request to carry, so it
        // fetches its own api over loopback instead. A down api half is not a
        // failed build either way: the loader catches, the seed carries no
        // stats section, and the next regeneration fills it.
        if (typeof window !== 'undefined')
        {
            return { stats: await client.market.stats() };
        }
        // The SSR bundle runs in node; a browser bundle never evaluates this
        // branch and is typed without node's ambient declarations on purpose.
        const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
        const response = await fetch(new Request(
            new URL('/api/market/stats', `http://127.0.0.1:${ env?.['PORT'] ?? '3000' }`),
            { signal }
        ));
        if (!response.ok)
        {
            throw new Error(`stats answered ${ response.status }`);
        }
        return { stats: await response.json() as Stats };
    }
    catch
    {
        return { stats: null };
    }
}

// The whitepaper's language is the ADDRESS: /whitepaper is English,
// /whitepaper/<lang> the other nine. The loader loads only that address's
// document, so a reader pays for the one translation they opened; an unknown
// language code is a 404, not a crash.
function assertLang(code: string | undefined): Lang
{
    if (!LANGS.some((entry) => entry.code === code))
    {
        throw notFound();
    }
    return code as Lang;
}

export const routes: PageRoute[] = [
    {
        path: '/',
        component: Landing,
        loader: ({ signal }) => loadLandingStats(signal),
        render: 'static',
        revalidate: 30
    },
    { path: '/swap', lazy: () => import('./pages/swap.azeroth'), render: 'client' },
    { path: '/liquidity', lazy: () => import('./pages/liquidity.azeroth'), render: 'client' },
    { path: '/portfolio', lazy: () => import('./pages/portfolio.azeroth'), render: 'client' },
    // The whitepaper ships as an EAGER component, not a lazy chunk. A lazy page
    // adopts its server markup from a deferred effect run (the chunk-load write),
    // and there the loader resource has not settled yet - so the page's
    // <Show when={ doc }> gates on `undefined` where the server rendered the
    // document, the adoption fails, and every visit falls back to a full client
    // render (the SSR bytes discarded; a HydrationMismatchError in dev). The
    // landing page, eager with the same loader-then-Show pattern, hydrates
    // clean. What STAYS lazy is the document data: the route loader imports only
    // the one translation the address names, so a reader still pays for a single
    // document and nothing else.
    {
        path: '/whitepaper',
        component: Whitepaper,
        loader: () => loadWhitepaper('en'),
        render: 'static'
    },
    {
        path: '/whitepaper/:lang',
        component: Whitepaper,
        staticParams: async () => LANGS.filter((entry) => entry.code !== 'en').map((entry) => ({ lang: entry.code })),
        loader: ({ params }) => loadWhitepaper(assertLang(params.lang)),
        render: 'static'
    }
];
