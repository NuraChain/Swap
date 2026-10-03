import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [azeroth(), tailwindcss()],
    build:
    {
        // scripts/build-seo.mjs reads dist/.vite/manifest.json to learn which chunk
        // holds which whitepaper translation, so it can preload the right one on
        // each prerendered page. Guessing from a file name would break the day two
        // chunks start with the same two letters.
        manifest: true,
        // A font is NEVER inlined, whatever its size. Vite's 4 kB default swallowed
        // the four Unbounded cyrillic-ext subsets - each about 1 kB - into the
        // stylesheet as data: URIs, and `font-src 'self'` in server/src/csp.ts then
        // blocked all four in production. Two reasons this is the right end to fix:
        // the policy is deliberately tight for a money application, and a font in
        // the CSS is bytes every reader downloads before first paint to serve the
        // Cyrillic readers alone - twice over, because woff sits beside woff2.
        // Everything else keeps vite's own rule.
        assetsInlineLimit: (filePath) => (/\.(?:woff2?|ttf|otf|eot)$/iu.test(filePath) ? false : undefined)
    },
    // The SSR bundle (src/entry.server.ts) inlines its dependencies, so dist-server
    // is ONE self-contained file - production imports it with no client node_modules.
    ssr:
    {
        noExternal: true
    },
    test:
    {
        environment: 'happy-dom',
        coverage:
        {
            provider: 'v8',
            // src/ only, and .azeroth components are measured through the same
            // transform the app ships - the locales are data, not logic.
            include: ['src/**/*.{ts,azeroth}'],
            exclude: ['src/lib/locales/**', 'src/vite-env.d.ts', 'src/entry.server.ts'],
            reporter: ['text-summary', 'json-summary', 'html'],
            reportsDirectory: 'coverage'
        }
    }
});
