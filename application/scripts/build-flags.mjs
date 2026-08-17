// Extracts the circular country flags for the language picker from circle-flags
// (MIT) into public/flags - self-hosted like the wallet vectors, so the picker
// needs no CDN and the strict CSP stays closed.
//
// The codes are ISO 3166-1 alpha-2 COUNTRIES, not language tags: a flag is a
// country's, and the mapping to a language is editorial (see LANGS in
// src/lib/i18n.ts, which is the list this must stay in step with).
//
// Rerun after changing FLAGS; the output is committed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAGS = ['gb', 'ir', 'sa', 'es', 'pt', 'in', 'cn', 'ru', 'fr', 'tr'];

// Hoisted to the workspace root by npm, but keep the local path as a fallback -
// same resolution dance as build-wallets.mjs.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const flagsDir = [
    join(root, 'node_modules', 'circle-flags', 'flags'),
    join(root, 'application', 'node_modules', 'circle-flags', 'flags')
].find((candidate) => existsSync(candidate));
if (flagsDir === undefined)
{
    throw new Error('circle-flags is not installed - run npm install first');
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'flags');
mkdirSync(out, { recursive: true });

let bytes = 0;
for (const code of FLAGS)
{
    const source = join(flagsDir, `${ code }.svg`);
    if (!existsSync(source))
    {
        throw new Error(`circle-flags has no ${ code }.svg - check the ISO 3166-1 alpha-2 code`);
    }
    const svg = readFileSync(source, 'utf8').trim();
    bytes += svg.length;
    writeFileSync(join(out, `${ code }.svg`), `${ svg }\n`);
}

console.log(`flags: ${ FLAGS.length } vectors (${ bytes } bytes) written to public/flags`);
