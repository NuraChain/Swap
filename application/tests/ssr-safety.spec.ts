// @vitest-environment node
//
// The SSR/prerender bundle evaluates EVERY page module - render: 'client' does
// not exempt one. A single module-scope window/localStorage/EventTarget touch
// anywhere in the import graph kills the production build. This spec imports the
// whole page graph under plain Node, where any such touch throws.

import { describe, expect, it } from 'vitest';

describe('ssr safety', () =>
{
    // Generous timeout: the first import cold-compiles the entire component graph.
    it('every page module imports cleanly without a DOM', { timeout: 30_000 }, async () =>
    {
        await expect(import('../src/App.azeroth')).resolves.toBeDefined();
        await expect(import('../src/pages/landing.azeroth')).resolves.toBeDefined();
        await expect(import('../src/pages/swap.azeroth')).resolves.toBeDefined();
        await expect(import('../src/pages/liquidity.azeroth')).resolves.toBeDefined();
        await expect(import('../src/pages/portfolio.azeroth')).resolves.toBeDefined();
        await expect(import('../src/lib/wallet/store.ts')).resolves.toBeDefined();
        await expect(import('../src/lib/theme.ts')).resolves.toBeDefined();
        await expect(import('../src/lib/i18n.ts')).resolves.toBeDefined();
    });
});
