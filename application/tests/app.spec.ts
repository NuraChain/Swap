// Component tests run against real DOM (happy-dom) through the compiler - the same
// pipeline that serves the app. renderTest mounts, cleanup unmounts between tests.
// App takes a `url` so tests (like the kit's SSR renderer) pin the route.
import { describe, it, expect, afterEach } from 'vitest';
import { renderTest, cleanup } from '@azerothjs/testing';

import App from '../src/App.azeroth';

afterEach(cleanup);

describe('App', () =>
{
    it('renders the landing route with header, hero, and footer credit', () =>
    {
        const { container } = renderTest(() => App({ url: '/' }));
        expect(container.textContent).toContain('Trade straight from your wallet.');
        expect(container.querySelector('header')).not.toBeNull();
        expect(container.textContent).toContain('Built with AzerothJS');
    });

    it('renders the not-found fallback for an unknown path', () =>
    {
        const { container } = renderTest(() => App({ url: '/nope' }));
        expect(container.textContent).toContain('This page does not exist.');
    });
});
