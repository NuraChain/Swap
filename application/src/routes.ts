// The one route table: the client router, the SSR entry, and the kit's server half all read
// it, so there is no second manifest. A page is one row; `render` is how it ships.
import type { PageRoute } from '@azerothjs/kit';

import Landing from './pages/landing.azeroth';

// The landing page prerenders to a static file; the trading pages depend on
// wallet and live chain state, so they render client-side only.
export const routes: PageRoute[] = [
    { path: '/', component: Landing, render: 'static' },
    { path: '/swap', lazy: () => import('./pages/swap.azeroth'), render: 'client' },
    { path: '/liquidity', lazy: () => import('./pages/liquidity.azeroth'), render: 'client' },
    { path: '/portfolio', lazy: () => import('./pages/portfolio.azeroth'), render: 'client' }
];
