// Renders the whitepaper - src/lib/whitepaper/<lang>.ts, the same data the page
// reads - to public/whitepaper/nura-swap-whitepaper-<lang>.pdf through a
// headless Chrome: A4, a cover, a contents page, running page numbers. The
// output is committed, so the build and the server need no browser; rerun this
// after editing the text.
//
//   node scripts/build-whitepaper-pdf.mjs          # every language
//   node scripts/build-whitepaper-pdf.mjs fa       # one language
//   CHROME=/path/to/chrome node scripts/...        # a browser not on the list
//
// Chrome is driven over its DevTools protocol rather than --print-to-pdf,
// because only the protocol takes a footer template - and a document without
// page numbers is not a document. The fonts are the application's own,
// embedded as data URIs so a file:// page needs no network and no CORS.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { esc, fontFaces, shamseh } from './lib/brand.mjs';
import { findChrome, withPage } from './lib/chrome.mjs';

import { ar as arDict } from '../src/lib/locales/ar.ts';
import { en as enDict } from '../src/lib/locales/en.ts';
import { es as esDict } from '../src/lib/locales/es.ts';
import { fa as faDict } from '../src/lib/locales/fa.ts';
import { fr as frDict } from '../src/lib/locales/fr.ts';
import { hi as hiDict } from '../src/lib/locales/hi.ts';
import { pt as ptDict } from '../src/lib/locales/pt.ts';
import { ru as ruDict } from '../src/lib/locales/ru.ts';
import { tr as trDict } from '../src/lib/locales/tr.ts';
import { zh as zhDict } from '../src/lib/locales/zh.ts';
import { ar } from '../src/lib/whitepaper/ar.ts';
import { en } from '../src/lib/whitepaper/en.ts';
import { es } from '../src/lib/whitepaper/es.ts';
import { fa } from '../src/lib/whitepaper/fa.ts';
import { fr } from '../src/lib/whitepaper/fr.ts';
import { hi } from '../src/lib/whitepaper/hi.ts';
import { pt } from '../src/lib/whitepaper/pt.ts';
import { ru } from '../src/lib/whitepaper/ru.ts';
import { tr } from '../src/lib/whitepaper/tr.ts';
import { zh } from '../src/lib/whitepaper/zh.ts';
import { sectionsOf } from '../src/lib/whitepaper/model.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'public', 'whitepaper');

// One entry per language the application ships, in the picker's order. The
// directions repeat LANGS in src/lib/i18n.ts rather than importing it, so this
// script stays plain Node and never pulls the framework in to print a PDF.
const RTL = new Set(['fa', 'ar']);
const DOCS = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };
const DICTS = { en: enDict, fa: faDict, ar: arDict, es: esDict, pt: ptDict,
    hi: hiDict, zh: zhDict, ru: ruDict, fr: frDict, tr: trDict };

const DOCUMENTS = Object.fromEntries(Object.keys(DOCS).map((code) =>
    [code, { doc: DOCS[code], dict: DICTS[code], dir: RTL.has(code) ? 'rtl' : 'ltr' }]));

// The three type roles of styles.css, Vazirmatn second in each so Persian and
// Arabic fall through per glyph exactly as they do on the site. Latin-ext
// carries Turkish and the Iberian and French accents, cyrillic carries Russian;
// Devanagari and Chinese have no @fontsource package here and fall through to
// the system faces named in FALLBACK.
const FONTS = [
    ['Unbounded', 500, 'unbounded/files/unbounded-latin-500-normal.woff2'],
    ['Unbounded', 500, 'unbounded/files/unbounded-latin-ext-500-normal.woff2'],
    ['Unbounded', 500, 'unbounded/files/unbounded-cyrillic-500-normal.woff2'],
    ['Unbounded', 700, 'unbounded/files/unbounded-latin-700-normal.woff2'],
    ['Unbounded', 700, 'unbounded/files/unbounded-latin-ext-700-normal.woff2'],
    ['Unbounded', 700, 'unbounded/files/unbounded-cyrillic-700-normal.woff2'],
    ['IBM Plex Sans', 400, 'ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2'],
    ['IBM Plex Sans', 400, 'ibm-plex-sans/files/ibm-plex-sans-latin-ext-400-normal.woff2'],
    ['IBM Plex Sans', 400, 'ibm-plex-sans/files/ibm-plex-sans-cyrillic-400-normal.woff2'],
    ['IBM Plex Sans', 500, 'ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2'],
    ['IBM Plex Sans', 500, 'ibm-plex-sans/files/ibm-plex-sans-latin-ext-500-normal.woff2'],
    ['IBM Plex Sans', 500, 'ibm-plex-sans/files/ibm-plex-sans-cyrillic-500-normal.woff2'],
    ['IBM Plex Sans', 600, 'ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2'],
    ['IBM Plex Sans', 600, 'ibm-plex-sans/files/ibm-plex-sans-latin-ext-600-normal.woff2'],
    ['IBM Plex Sans', 600, 'ibm-plex-sans/files/ibm-plex-sans-cyrillic-600-normal.woff2'],
    ['IBM Plex Mono', 400, 'ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'],
    ['IBM Plex Mono', 400, 'ibm-plex-mono/files/ibm-plex-mono-latin-ext-400-normal.woff2'],
    ['IBM Plex Mono', 400, 'ibm-plex-mono/files/ibm-plex-mono-cyrillic-400-normal.woff2'],
    ['IBM Plex Mono', 500, 'ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2'],
    ['IBM Plex Mono', 500, 'ibm-plex-mono/files/ibm-plex-mono-latin-ext-500-normal.woff2'],
    ['IBM Plex Mono', 500, 'ibm-plex-mono/files/ibm-plex-mono-cyrillic-500-normal.woff2'],
    ['Vazirmatn', 400, 'vazirmatn/files/vazirmatn-arabic-400-normal.woff2'],
    ['Vazirmatn', 500, 'vazirmatn/files/vazirmatn-arabic-500-normal.woff2'],
    ['Vazirmatn', 700, 'vazirmatn/files/vazirmatn-arabic-700-normal.woff2']
];

// Devanagari and CJK, from whatever the printing machine has.
const FALLBACK = "'Nirmala UI', 'Noto Sans Devanagari', 'Microsoft YaHei', 'Noto Sans SC', 'PingFang SC', 'Noto Sans CJK SC'";

// The print palette is the light theme of styles.css, fixed: paper is white.
const CSS = `
@page { size: A4; }
* { box-sizing: border-box; }
html { font-size: 10.5pt; }
body { margin: 0; background: #fff; color: #1c2733; font-family: 'IBM Plex Sans', 'Vazirmatn', ${ FALLBACK }, sans-serif; line-height: 1.6; text-align: start; }
h1, h2, h3 { font-family: 'Unbounded', 'Vazirmatn', ${ FALLBACK }, sans-serif; font-weight: 500; margin: 0; break-after: avoid; }
h4 { margin: 0; break-after: avoid; }
p { margin: 0 0 7pt; orphans: 3; widows: 3; }
a { color: inherit; text-decoration: none; }
.eyebrow { font-size: 7.5pt; letter-spacing: 0.18em; text-transform: uppercase; color: #5b6b7a; margin: 0 0 4pt; }
[dir='rtl'] .eyebrow { letter-spacing: 0; }
.num, .mono, pre { font-family: 'IBM Plex Mono', 'Vazirmatn', ${ FALLBACK }, monospace; direction: ltr; unicode-bidi: isolate; }
.num { font-size: 8pt; color: #1f6fa8; }
.mono { font-size: 9pt; }

.cover { height: 236mm; display: flex; flex-direction: column; justify-content: space-between; break-after: page; }
.cover .mark { width: 88px; height: 88px; color: #1f6fa8; }
.cover h1 { font-size: 30pt; font-weight: 700; line-height: 1.15; margin-top: 20pt; }
.cover .kind { font-family: 'Unbounded', 'Vazirmatn', ${ FALLBACK }, sans-serif; font-size: 16pt; color: #1f6fa8; margin-top: 6pt; }
.cover .covers { margin-top: 16pt; color: #5b6b7a; max-width: 120mm; font-size: 11pt; }
.cover .lede { margin-top: 28pt; max-width: 135mm; font-size: 11.5pt; line-height: 1.7; }
.cover-foot { display: flex; justify-content: space-between; gap: 12pt; font-size: 8.5pt; color: #5b6b7a; border-top: 1px solid rgba(28, 39, 51, 0.14); padding-top: 8pt; }

.contents { break-after: page; }
.contents h2, .abstract h2 { font-size: 16pt; margin-bottom: 10pt; }
.toc-part { margin-top: 12pt; }
.contents ol { list-style: none; padding: 0; margin: 4pt 0 0; }
.contents li { display: flex; gap: 8pt; padding: 3pt 0; border-bottom: 1px solid rgba(28, 39, 51, 0.08); font-size: 10pt; }
.contents .num { min-width: 16pt; line-height: inherit; }

.part-business { break-before: page; }
.part-head { margin-top: 20pt; }
.part-head h2 { font-size: 20pt; }
.part-head .lede { color: #5b6b7a; font-size: 11pt; margin: 4pt 0 0; }
.section { margin-top: 16pt; padding-top: 10pt; border-top: 1px solid rgba(28, 39, 51, 0.14); }
.section-head { break-inside: avoid; break-after: avoid; }
.section-head .num { display: block; margin-bottom: 2pt; }
.section h3 { font-size: 13pt; margin-bottom: 6pt; }
h4 { font-size: 11pt; font-weight: 600; margin: 12pt 0 4pt; }
.steps h4 { font-size: 10.5pt; font-weight: 600; margin: 0 0 2pt; }
.callout .title { font-size: 10.5pt; font-weight: 600; margin: 0 0 2pt; color: #1c2733; }
ul, ol { margin: 4pt 0 8pt; padding-inline-start: 16pt; }
li { margin: 2pt 0; }
ul li::marker { color: #1f6fa8; }

table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9.5pt; }
th { text-align: start; font-size: 8pt; font-weight: 500; color: #5b6b7a; padding: 4pt 6pt; background: #f2f5f8; }
td { padding: 4pt 6pt; border-top: 1px solid rgba(28, 39, 51, 0.14); vertical-align: top; }
td.mono { overflow-wrap: anywhere; }
tr { break-inside: avoid; }

.callout { border: 1px solid rgba(28, 39, 51, 0.14); border-inline-start: 3px solid #1f6fa8; background: #f8fafc; border-radius: 6pt; padding: 8pt 10pt; margin: 8pt 0 10pt; break-inside: avoid; }
.callout p { margin: 2pt 0 0; color: #3b4a58; font-size: 9.8pt; }
.steps { list-style: none; padding: 0; margin: 6pt 0 10pt; display: grid; grid-template-columns: 1fr 1fr; gap: 6pt; }
.steps li { border: 1px solid rgba(28, 39, 51, 0.14); border-radius: 6pt; padding: 8pt 10pt; margin: 0; break-inside: avoid; }
.steps .num { display: block; margin-bottom: 2pt; }
.steps p { margin: 2pt 0 0; font-size: 9.5pt; color: #3b4a58; }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt; margin: 6pt 0 10pt; }
.fact { border: 1px solid rgba(28, 39, 51, 0.14); border-radius: 6pt; padding: 6pt 8pt; background: #fafcfe; break-inside: avoid; }
.fact dt { font-size: 7.5pt; letter-spacing: 0.12em; text-transform: uppercase; color: #5b6b7a; }
[dir='rtl'] .fact dt { letter-spacing: 0; }
.fact dd { margin: 2pt 0 0; font-size: 9.5pt; overflow-wrap: anywhere; }
.fact dd.mono { color: #8a6516; font-size: 8.5pt; }
.formula { margin: 6pt 0 10pt; break-inside: avoid; }
.formula pre { margin: 0; font-size: 9.5pt; border: 1px solid rgba(28, 39, 51, 0.14); background: #f8fafc; border-radius: 6pt; padding: 8pt 10pt; white-space: pre-wrap; }
.formula figcaption { font-size: 9pt; color: #5b6b7a; margin-top: 3pt; }

.disclaimer { margin-top: 18pt; padding: 8pt 10pt; border: 1px solid rgba(28, 39, 51, 0.14); border-radius: 6pt; background: #f8fafc; font-size: 9pt; color: #5b6b7a; break-inside: avoid; }
.disclaimer h2 { font-family: inherit; font-size: 8pt; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 4pt; }
[dir='rtl'] .disclaimer h2 { letter-spacing: 0; }
.disclaimer p { margin: 0; }
`;

function pad(number)
{
    return String(number).padStart(2, '0');
}

function renderBlock(block)
{
    switch (block.kind)
    {
        case 'p':
            return `<p>${ esc(block.text) }</p>`;
        case 'h3':
            return `<h4>${ esc(block.text) }</h4>`;
        case 'list':
        {
            const tag = block.ordered ? 'ol' : 'ul';
            return `<${ tag }>${ block.items.map((item) => `<li>${ esc(item) }</li>`).join('') }</${ tag }>`;
        }
        case 'table':
        {
            const head = block.head.map((cell) => `<th>${ esc(cell) }</th>`).join('');
            const rows = block.rows.map((row) => `<tr>${ row.map((cell, index) =>
                `<td${ block.mono.includes(index) ? ' class="mono"' : '' }>${ esc(cell) }</td>`).join('') }</tr>`).join('');
            return `<table><thead><tr>${ head }</tr></thead><tbody>${ rows }</tbody></table>`;
        }
        case 'callout':
            return `<aside class="callout"><p class="title">${ esc(block.title) }</p><p>${ esc(block.text) }</p></aside>`;
        case 'steps':
            return `<ol class="steps">${ block.items.map((item, index) =>
                `<li><span class="num">${ pad(index + 1) }</span><h4>${ esc(item.title) }</h4><p>${ esc(item.text) }</p></li>`).join('') }</ol>`;
        case 'facts':
            return `<dl class="facts">${ block.items.map((item) =>
                `<div class="fact"><dt>${ esc(item.label) }</dt><dd${ item.mono ? ' class="mono"' : '' }>${ esc(item.value) }</dd></div>`).join('') }</dl>`;
        case 'formula':
            return `<figure class="formula"><pre>${ esc(block.text) }</pre><figcaption>${ esc(block.caption) }</figcaption></figure>`;
        default:
            return '';
    }
}

function renderDocument(lang, { doc, dict, dir }, fonts)
{
    const numberOf = new Map(sectionsOf(doc).map(({ number, section }) => [section.id, pad(number)]));

    const cover = `<section class="cover">
        <div>${ shamseh() }<h1>${ esc(doc.meta.title) }</h1><p class="kind">${ esc(doc.meta.subtitle) }</p><p class="covers">${ esc(doc.meta.covers) }</p><p class="lede">${ esc(doc.abstract[0]) }</p></div>
        <div class="cover-foot"><span>${ esc(doc.meta.version) } · ${ esc(doc.meta.date) }</span><span class="mono">github.com/NuraChain/Swap</span></div>
    </section>`;

    const contents = `<section class="contents"><h2>${ esc(dict.whitepaper.contents) }</h2>${ doc.parts.map((part) =>
        `<div class="toc-part"><p class="eyebrow">${ esc(part.label) } · ${ esc(part.title) }</p><ol>${ part.sections.map((section) =>
            `<li><span class="num">${ numberOf.get(section.id) }</span><span>${ esc(section.title) }</span></li>`).join('') }</ol></div>`).join('') }</section>`;

    const abstract = `<section class="abstract"><h2>${ esc(doc.meta.abstractTitle) }</h2>${ doc.abstract.map((text) => `<p>${ esc(text) }</p>`).join('') }</section>`;

    const parts = doc.parts.map((part) => `<section class="part part-${ part.id }">
        <header class="part-head"><p class="eyebrow">${ esc(part.label) }</p><h2>${ esc(part.title) }</h2><p class="lede">${ esc(part.lede) }</p></header>
        ${ part.sections.map((section) => `<section class="section" id="${ section.id }"><header class="section-head"><span class="num">${ numberOf.get(section.id) }</span><h3>${ esc(section.title) }</h3></header>${ section.blocks.map(renderBlock).join('') }</section>`).join('') }
    </section>`).join('');

    const disclaimer = `<section class="disclaimer"><h2>${ esc(doc.meta.disclaimerTitle) }</h2><p>${ esc(doc.meta.disclaimer) }</p></section>`;

    return `<!doctype html><html lang="${ lang }" dir="${ dir }"><head><meta charset="utf-8"><title>${ esc(doc.meta.title) } - ${ esc(doc.meta.subtitle) }</title><style>${ fonts }${ CSS }</style></head><body>${ cover }${ contents }${ abstract }${ parts }${ disclaimer }</body></html>`;
}

function footerTemplate(label, dir)
{
    // Header/footer templates render outside the page, with system fonts only.
    return `<div style="width:100%;direction:${ dir };font-family:'Segoe UI',Arial,sans-serif;font-size:7.5px;color:#6b7a89;padding:0 16.5mm;display:flex;justify-content:space-between;align-items:center">`
        + `<span>${ esc(label) }</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

/** One page, printed. The browser plumbing lives in lib/chrome.mjs. */
async function printToPdf(chrome, htmlPath, footer)
{
    return withPage(chrome, htmlPath, async (send, sessionId) =>
    {
        const { data } = await send('Page.printToPDF', {
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate: footer,
            marginTop: 0.6,
            marginBottom: 0.7,
            marginLeft: 0.65,
            marginRight: 0.65
        }, sessionId);
        return Buffer.from(data, 'base64');
    });
}

async function main()
{
    const wanted = process.argv.slice(2);
    const langs = wanted.length === 0 ? Object.keys(DOCUMENTS) : wanted;
    for (const lang of langs)
    {
        if (!(lang in DOCUMENTS))
        {
            throw new Error(`no whitepaper in '${ lang }' - have ${ Object.keys(DOCUMENTS).join(', ') }`);
        }
    }
    const chrome = findChrome();
    const fonts = fontFaces(FONTS);
    mkdirSync(OUT_DIR, { recursive: true });
    const scratch = mkdtempSync(join(tmpdir(), 'nuraswap-whitepaper-html-'));
    try
    {
        for (const lang of langs)
        {
            const entry = DOCUMENTS[lang];
            const htmlPath = join(scratch, `${ lang }.html`);
            writeFileSync(htmlPath, renderDocument(lang, entry, fonts));
            const pdf = await printToPdf(chrome, htmlPath, footerTemplate(`${ entry.doc.meta.title } · ${ entry.doc.meta.version }`, entry.dir));
            const out = join(OUT_DIR, `nura-swap-whitepaper-${ lang }.pdf`);
            writeFileSync(out, pdf);
            console.log(`${ out }  ${ (pdf.length / 1024).toFixed(0) } KB`);
        }
    }
    finally
    {
        rmSync(scratch, { recursive: true, force: true });
    }
}

await main();
