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

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The social card's pixel size. Every platform crops a large summary card to
 * 1200x630 - the 1.91:1 they all state - so build-og-image.mjs renders exactly
 * that and build-seo.mjs declares exactly that in og:image:width/height. One
 * pair of numbers, or the declaration and the file disagree.
 */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

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
