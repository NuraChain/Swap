import { defineConfig } from 'vitest/config';

// src/main.ts is excluded from the denominator on purpose: it is the boot
// script, not a module - importing it starts an indexer, opens a database and
// binds a port. What it composes (the app, the CSP, the rate limiter) is covered
// through tests/pipeline.spec.ts, which assembles the same pipeline by hand.
export default defineConfig({
    test:
    {
        coverage:
        {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/main.ts'],
            reporter: ['text-summary', 'json-summary', 'html'],
            reportsDirectory: 'coverage'
        }
    }
});
