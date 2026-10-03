// The pieces of the identity that a build script draws into an HTML page, in ONE
// place: the mark, and the application's own webfonts embedded so a file:// page
// needs no network and no CORS.
//
// The mark lives here for the same reason build-app-icons.mjs generates the
// favicons rather than carrying them by hand - a second copy drifts, and the
// favicon this repository replaced had already drifted into a different logo
// from the one the header drew.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One source of truth for the card's size: src/lib/seo.ts declares it in every
// page head, and this module - the image renderer's - reads the same pair.
// Node runs the TypeScript source directly (type stripping), so no second
// constant can drift.
import { OG_HEIGHT as CARD_HEIGHT, OG_WIDTH as CARD_WIDTH } from '../../src/lib/seo.ts';

export const OG_WIDTH = CARD_WIDTH;
export const OG_HEIGHT = CARD_HEIGHT;

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The shamseh, as ui/shamseh.component.azeroth draws it, on a 100x100 field. */
export function shamseh(className = 'mark')
{
    return `<svg class="${ className }" viewBox="-50 -50 100 100" fill="none" stroke="currentColor" aria-hidden="true">`
        + '<rect x="-31" y="-31" width="62" height="62" stroke-width="1.6"/>'
        + '<rect x="-31" y="-31" width="62" height="62" stroke-width="1.6" transform="rotate(45)"/>'
        + '<circle r="19" stroke-width="1.3"/><circle r="4.5" fill="currentColor" stroke="none"/></svg>';
}

export function esc(text)
{
    return String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

/**
 * `@font-face` rules with the woff2 inlined, for a page Chrome opens off the
 * disk. `font-display: block` rather than swap: these pages are rendered once
 * into a PDF or a PNG, and a fallback face caught mid-swap is a permanent
 * mistake in a committed file rather than a flash someone sees for 100ms.
 *
 * @param {[string, number, string][]} files family, weight, path under @fontsource
 */
export function fontFaces(files)
{
    const bases = [join(ROOT, 'node_modules', '@fontsource'), join(ROOT, '..', 'node_modules', '@fontsource')];
    const base = bases.find((candidate) => existsSync(candidate));
    if (base === undefined)
    {
        throw new Error('@fontsource packages not found - run npm install first');
    }
    return files.map(([family, weight, file]) =>
    {
        const data = readFileSync(join(base, file)).toString('base64');
        return `@font-face { font-family: '${ family }'; font-weight: ${ weight }; font-style: normal; font-display: block; src: url(data:font/woff2;base64,${ data }) format('woff2'); }`;
    }).join('\n');
}
