// The one route table: the client router, the SSR entry, and the kit's server half all read
// it, so there is no second manifest. A page is one row; `render` is how it ships.
import type { PageRoute } from '@azerothjs/kit';

import { LANGS, type Lang } from './lib/i18n.ts';
import { loadWhitepaper, whitepaperPath } from './lib/whitepaper/index.ts';

import Landing from './pages/landing.azeroth';

// One prerendered page per translation of the paper. The route carries the
// language, so the document is chosen at BUILD time rather than read off a
// browser signal: each URL prerenders to its own words, which is what makes the
// nine translations indexable at all. `lazy` resolving the page and the document
// together is also what keeps them apart in the bundle - a reader of one
// language never downloads the other nine.
function whitepaperRoute(lang: Lang): PageRoute
{
    return {
        path: whitepaperPath(lang),
        lazy: async () =>
        {
            const [page, doc] = await Promise.all([import('./pages/whitepaper.azeroth'), loadWhitepaper(lang)]);
            return () => page.default({ doc, lang });
        },
        render: 'static'
    };
}

// The landing page prerenders to a static file; the trading pages depend on
// wallet and live chain state, so they render client-side only.
export const routes: PageRoute[] = [
    { path: '/', component: Landing, render: 'static' },
    { path: '/swap', lazy: () => import('./pages/swap.azeroth'), render: 'client' },
    { path: '/liquidity', lazy: () => import('./pages/liquidity.azeroth'), render: 'client' },
    { path: '/portfolio', lazy: () => import('./pages/portfolio.azeroth'), render: 'client' },
    ...LANGS.map((entry) => whitepaperRoute(entry.code))
];
