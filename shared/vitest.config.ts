import { defineConfig } from 'vitest/config';

// The pure half: bigint AMM maths, digit normalization, the deployment loader.
// Coverage is measured over src/ only - the specs themselves are not the subject.
export default defineConfig({
    test:
    {
        coverage:
        {
            provider: 'v8',
            include: ['src/**/*.ts'],
            reporter: ['text-summary', 'json-summary', 'html'],
            reportsDirectory: 'coverage'
        }
    }
});
