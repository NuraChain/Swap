import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// The proxy has to name the port the server ACTUALLY listens on, and that is
// server/.env - the same file the server reads. Hardcoded, it was a trap: set
// PORT there and every /api call in dev 404s into a server that answers on
// another port, the deployment never loads, and the buttons that need it (add
// chain, connect) do nothing while the page itself looks fine.
// API_PORT wins if set, then server/.env, then the server's own default.
function apiPort(): string
{
    if (process.env.API_PORT !== undefined)
    {
        return process.env.API_PORT;
    }
    const envFile = fileURLToPath(new URL('../server/.env', import.meta.url));
    if (existsSync(envFile))
    {
        const declared = readFileSync(envFile, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
        if (declared !== null)
        {
            return declared[1];
        }
    }
    return '3000';
}

export default defineConfig({
    plugins: [azeroth(), tailwindcss()],
    // The SSR bundle (src/entry.server.ts) inlines its dependencies, so dist-server
    // is ONE self-contained file - production imports it with no client node_modules.
    ssr:
    {
        noExternal: true
    },
    server:
    {
        // Declared, not inherited: the README and the devtools bridge URL both name these
        // ports, so they belong in the config rather than in vite's defaults. Vite still
        // steps to the next free port if this one is taken.
        port: 5173,
        proxy:
        {
            // The server half of this app. `azeroth dev` runs both halves; this line is
            // the whole DEV wiring. In production the server serves the built client
            // itself (one origin) - see server/src/app.ts.
            '/api': `http://localhost:${ apiPort() }`
        }
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
