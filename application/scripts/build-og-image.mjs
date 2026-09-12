// Renders public/og.png - the 1200x630 card a link to this site unfurls into on
// social platforms and in chat - through the same headless Chrome the whitepaper
// PDFs go through. The output is committed, so the build and the server need no
// browser; rerun this after changing the landing copy or the palette.
//
//   node scripts/build-og-image.mjs
//   CHROME=/path/to/chrome node scripts/build-og-image.mjs
//
// WHY A RENDERED CARD. The share preview used to point at icon-512.png, and
// every validator said the same three things: 512x512 is below the 1200x630
// every platform crops to, a 1:1 mark is not the 1.91:1 a large summary card
// wants, and a card that small can only ever be shown as a thumbnail beside the
// title. A real card carries the wordmark in Unbounded and says what the site
// is before anyone clicks.
//
// The words come from the SAME dictionary the landing page renders
// (src/lib/locales/en.ts) and the colours are the dark theme of styles.css, so
// the card cannot drift from the site it advertises.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OG_HEIGHT, OG_WIDTH, esc, fontFaces, shamseh } from './lib/brand.mjs';
import { findChrome, withPage } from './lib/chrome.mjs';

import { en as enDict } from '../src/lib/locales/en.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public', 'og.png');

// The host, for the line along the bottom. SITE_ORIGIN so a staging card names
// the staging host rather than promising production.
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://swap.nurachain.net').replace(/\/+$/u, '');

// Only the faces the card actually sets. The PDF needs twenty-four because it
// typesets ten languages; this is one English card in three sizes.
const FONTS = [
    ['Unbounded', 700, 'unbounded/files/unbounded-latin-700-normal.woff2'],
    ['IBM Plex Sans', 400, 'ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2'],
    ['IBM Plex Mono', 500, 'ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2']
];

// The DARK theme of src/styles.css, resolved. A card is one artwork in every
// theme - it lives outside the document, so `light-dark()` has nothing to
// resolve - and the identity is the cold mark in night water.
const BG = '#090d12';
const INK = '#d5e1ec';
const ICE = '#5fb3e8';
const FAINT = '#8aa0b5';
const LINE = '#1e2a38';

/**
 * The closing sentence of the landing sub-headline. That last clause is the
 * claim worth putting on a card - the rest of the paragraph explains the
 * mechanism, which a reader gets after they click. Derived rather than retyped
 * so the card follows the copy.
 */
function closingSentence(text)
{
    const sentences = text.trim().split(/(?<=\.)\s+/u);
    return sentences[sentences.length - 1];
}

function card()
{
    const fonts = fontFaces(FONTS);
    const host = ORIGIN.replace(/^https?:\/\//u, '');

    const css = `
${ fonts }
* { box-sizing: border-box; margin: 0; }
html, body { width: ${ OG_WIDTH }px; height: ${ OG_HEIGHT }px; }
body
{
    background: ${ BG };
    color: ${ INK };
    font-family: 'IBM Plex Sans', sans-serif;
    /* Grayscale antialiasing. Chrome's default is LCD subpixel, which lays red
       and cyan fringes along every stem - invisible on the screen it was tuned
       for, and baked into a PNG that platforms then rescale. */
    -webkit-font-smoothing: antialiased;
    /* The glow of styles.css, as light off the mark rather than a flat fill. */
    background-image:
        radial-gradient(760px 520px at 82% 12%, rgba(95, 179, 232, 0.17), transparent 70%),
        radial-gradient(520px 420px at 4% 96%, rgba(95, 179, 232, 0.08), transparent 68%);
    padding: 76px 84px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
}
.lockup { display: flex; align-items: center; gap: 22px; }
.mark { width: 76px; height: 76px; color: ${ ICE }; flex: none; }
.wordmark { font-family: 'Unbounded', sans-serif; font-weight: 700; font-size: 44px; letter-spacing: 0.005em; }
h1
{
    font-family: 'Unbounded', sans-serif;
    font-weight: 700;
    font-size: 72px;
    line-height: 1.12;
    letter-spacing: -0.015em;
    max-width: 15ch;
}
.support { font-size: 30px; line-height: 1.45; color: ${ FAINT }; max-width: 44ch; margin-top: 22px; text-wrap: balance; }
.foot
{
    border-top: 1px solid ${ LINE };
    padding-top: 22px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 24px;
}
.host { font-family: 'IBM Plex Mono', monospace; font-weight: 500; font-size: 24px; color: ${ ICE }; }
.kicker { font-size: 22px; color: ${ FAINT }; }
`;

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        + `<title>Nura Swap</title><style>${ css }</style></head><body>`
        + `<div class="lockup">${ shamseh() }<span class="wordmark">Nura Swap</span></div>`
        + `<div><h1>${ esc(enDict.landing.headline) }</h1>`
        + `<p class="support">${ esc(closingSentence(enDict.landing.sub)) }</p></div>`
        + `<div class="foot"><span class="host">${ esc(host) }</span>`
        + '<span class="kicker">Open automated market maker</span></div>'
        + '</body></html>';
}

async function main()
{
    const chrome = findChrome();
    const scratch = mkdtempSync(join(tmpdir(), 'nuraswap-og-'));
    try
    {
        const htmlPath = join(scratch, 'og.html');
        writeFileSync(htmlPath, card(), 'utf8');

        const png = await withPage(chrome, htmlPath, async (send, sessionId) =>
        {
            const { data } = await send('Page.captureScreenshot', {
                format: 'png',
                // The card IS the viewport; clipping to it keeps a stray scrollbar
                // or a rounding error from changing the committed dimensions.
                clip: { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT, scale: 1 },
                captureBeyondViewport: false
            }, sessionId);
            return Buffer.from(data, 'base64');
        }, { viewport: { width: OG_WIDTH, height: OG_HEIGHT } });

        writeFileSync(OUT, png);
        console.log(`${ OUT }  ${ OG_WIDTH }x${ OG_HEIGHT }  ${ (png.length / 1024).toFixed(0) } KB`);
    }
    finally
    {
        rmSync(scratch, { recursive: true, force: true });
    }
}

await main();
