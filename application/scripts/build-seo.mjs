// The head of every prerendered page, plus robots.txt and sitemap.xml.
//
//   node scripts/build-seo.mjs                     # after `azeroth build`
//   SITE_ORIGIN=https://staging.nurachain.net node scripts/build-seo.mjs
//
// WHY A BUILD STEP. The kit splices rendered markup into the built shell and
// leaves the head alone, so every page would otherwise ship index.html's one
// generic title and no canonical at all. These pages are static - their titles,
// descriptions and language are fully known once the prerender has run - so the
// head is written here, at build time, rather than by script in the browser
// where a crawler may never see it.
//
// The whitepaper is the reason this exists: ten translations, one prerendered
// page each, and they only work as ten indexable documents if each one declares
// its own language, points a canonical at itself, and names the other nine as
// alternates. The prose is read from the SAME data the page and the PDF render
// (src/lib/whitepaper/<lang>.ts), so a title here can never drift from the
// document it describes.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGS } from '../src/lib/i18n.ts';
import { en as enDict } from '../src/lib/locales/en.ts';
import { landingTitle, whitepaperTitle } from '../src/lib/seo.ts';
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
import { whitepaperPath } from '../src/lib/whitepaper/index.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

// Absolute URLs are not optional here: canonical, hreflang, og:url and every
// sitemap entry are meaningless relative. One origin, overridable for a staging
// host that must not claim the production one's canonical.
const ORIGIN = (process.env.SITE_ORIGIN ?? 'https://swap.nurachain.net').replace(/\/+$/u, '');

const DOCS = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };

// Google reads the plain language subtag happily and we serve ONE document per
// language - no pt-BR beside pt-PT - so the region in LangInfo.locale would
// narrow the match for nothing.
const HREFLANG = LANGS.map((entry) => entry.code);

const OG_IMAGE = '/icon-512.png';

// og:locale is language_TERRITORY, not a BCP 47 tag. LangInfo.locale carries the
// region for nine of the ten; Arabic is written region-less there on purpose, so
// its flag - the one country the language is paired with - supplies the half
// Open Graph insists on.
function ogLocale({ locale, flag })
{
    const [language, region] = locale.split('-');
    return `${ language }_${ (region ?? '').length === 2 ? region.toUpperCase() : flag.toUpperCase() }`;
}

function escapeHtml(text)
{
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

// A meta description is cut off by the search engine around 160 characters, so
// cut it here instead - at the end of a sentence, where the text still reads
// like a sentence. The terminators cover the Latin, Arabic, Devanagari and CJK
// full stops, because zh and hi have no spaces to fall back on.
const TERMINATORS = ['.', '!', '?', '۔', '؟', '।', '。', '！', '？'];

function describe(text, limit = 160)
{
    const clean = text.replace(/\s+/gu, ' ').trim();
    if (clean.length <= limit)
    {
        return clean;
    }
    const head = clean.slice(0, limit);
    let cut = -1;
    for (const mark of TERMINATORS)
    {
        cut = Math.max(cut, head.lastIndexOf(mark));
    }
    // A terminator in the last third is a real sentence end; earlier than that
    // and cutting there would throw most of the description away.
    if (cut >= limit / 3)
    {
        return head.slice(0, cut + 1).trim();
    }
    const space = head.lastIndexOf(' ');
    return `${ (space > limit / 3 ? head.slice(0, space) : head).trim() }…`;
}

function jsonLd(data)
{
    // `</script>` inside a JSON string would close the tag it lives in.
    return JSON.stringify(data, null, 4).replaceAll('<', '\\u003c');
}

// ---------------------------------------------------------------------------
// The client manifest: which chunk holds which module.

function loadManifest()
{
    const file = join(DIST, '.vite', 'manifest.json');
    if (!existsSync(file))
    {
        throw new Error('dist/.vite/manifest.json is missing - run `azeroth build` first (vite build.manifest must stay on).');
    }
    return JSON.parse(readFileSync(file, 'utf8'));
}

/** A module's own chunk plus everything it statically pulls in, deduplicated. */
function chunksFor(manifest, source, seen = new Set())
{
    const entry = manifest[source];
    if (entry === undefined || seen.has(source))
    {
        return [];
    }
    seen.add(source);
    const files = [`/${ entry.file }`];
    for (const imported of entry.imports ?? [])
    {
        files.push(...chunksFor(manifest, imported, seen));
    }
    return files;
}

// ---------------------------------------------------------------------------
// Head rewriting.

/**
 * Replaces the shell's generic head tags with this page's own. Idempotent: the
 * tags it writes are the tags it strips, so a second run over the same file
 * produces the same file.
 */
function writeHead(html, { lang, locale, dir, title, description, canonical, alternates, structured, preloads })
{
    let out = html.replace(/<html[^>]*>/u, `<html lang="${ lang }" dir="${ dir }">`);

    out = out.replace(/[ \t]*<title>[\s\S]*?<\/title>\n?/u, '');
    out = out.replace(/[ \t]*<meta name="description"[^>]*>\n?/u, '');
    out = out.replace(/[ \t]*<meta property="og:(?:title|description|type|url|image|locale|site_name)"[^>]*>\n?/gu, '');
    out = out.replace(/[ \t]*<meta name="twitter:[^"]*"[^>]*>\n?/gu, '');
    out = out.replace(/[ \t]*<link rel="(?:canonical|alternate)"[^>]*>\n?/gu, '');
    out = out.replace(/[ \t]*<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/gu, '');

    const fresh = preloads.filter((href) => !out.includes(`href="${ href }"`));

    const lines = [
        `<title>${ escapeHtml(title) }</title>`,
        `<meta name="description" content="${ escapeHtml(description) }"/>`,
        `<link rel="canonical" href="${ canonical }"/>`,
        ...alternates.map(({ hreflang, href }) => `<link rel="alternate" hreflang="${ hreflang }" href="${ href }"/>`),
        '<meta property="og:site_name" content="Nura Swap"/>',
        `<meta property="og:title" content="${ escapeHtml(title) }"/>`,
        `<meta property="og:description" content="${ escapeHtml(description) }"/>`,
        '<meta property="og:type" content="website"/>',
        `<meta property="og:url" content="${ canonical }"/>`,
        `<meta property="og:locale" content="${ locale }"/>`,
        `<meta property="og:image" content="${ ORIGIN }${ OG_IMAGE }"/>`,
        '<meta name="twitter:card" content="summary"/>',
        `<meta name="twitter:title" content="${ escapeHtml(title) }"/>`,
        `<meta name="twitter:description" content="${ escapeHtml(description) }"/>`,
        `<meta name="twitter:image" content="${ ORIGIN }${ OG_IMAGE }"/>`,
        ...fresh.map((href) => `<link rel="modulepreload" crossorigin href="${ href }">`),
        `<script type="application/ld+json">${ jsonLd(structured) }</script>`
    ];
    const block = lines.map((line) => `        ${ line }`).join('\n');
    return out.replace('</head>', `${ block }\n    </head>`);
}

function readPage(urlPath)
{
    const file = urlPath === '/' ? join(DIST, 'index.html') : join(DIST, urlPath.slice(1), 'index.html');
    if (!existsSync(file))
    {
        throw new Error(`${ urlPath } was not prerendered - expected ${ file }. Is it still render: 'static' in src/routes.ts?`);
    }
    return { file, html: readFileSync(file, 'utf8') };
}

// ---------------------------------------------------------------------------

function run()
{
    const manifest = loadManifest();
    const written = [];

    // Every translation names every other, and x-default points at the English
    // one - the address a reader who matches no listed language should land on.
    const alternates = [
        ...HREFLANG.map((code) => ({ hreflang: code, href: `${ ORIGIN }${ whitepaperPath(code) }` })),
        { hreflang: 'x-default', href: `${ ORIGIN }${ whitepaperPath('en') }` }
    ];

    const pageChunks = chunksFor(manifest, 'src/pages/whitepaper.azeroth');

    for (const entry of LANGS)
    {
        const { code, dir } = entry;
        const doc = DOCS[code];
        const path = whitepaperPath(code);
        const canonical = `${ ORIGIN }${ path }`;
        const title = whitepaperTitle(doc);
        const description = describe(doc.abstract[0]);
        const pdf = `${ ORIGIN }/whitepaper/nura-swap-whitepaper-${ code }.pdf`;
        const { file, html } = readPage(path);

        // The prerendered markup is already this language's words; without these
        // the browser still has to discover the page chunk and the document
        // chunk one after the other before it can hydrate them.
        const preloads = [...new Set([...pageChunks, ...chunksFor(manifest, `src/lib/whitepaper/${ code }.ts`)])];

        writeFileSync(file, writeHead(html, {
            lang: code,
            locale: ogLocale(entry),
            dir,
            title,
            description,
            canonical,
            alternates,
            preloads,
            structured: {
                '@context': 'https://schema.org',
                '@type': 'TechArticle',
                headline: title,
                description,
                inLanguage: code,
                url: canonical,
                isAccessibleForFree: true,
                license: 'https://opensource.org/licenses/MIT',
                publisher: { '@type': 'Organization', name: 'Nura Swap', url: `${ ORIGIN }/` },
                // The same document as a file, which is what the download button
                // hands over - stated rather than left for a crawler to guess.
                associatedMedia: { '@type': 'MediaObject', encodingFormat: 'application/pdf', contentUrl: pdf }
            }
        }), 'utf8');
        written.push(path);
    }

    // The landing page prerenders in English only - it is one URL, not ten - so
    // it gets a canonical and no alternates to promise translations that have no
    // address.
    const landing = readPage('/');
    writeFileSync(landing.file, writeHead(landing.html, {
        lang: 'en',
        locale: ogLocale(LANGS[0]),
        dir: 'ltr',
        title: landingTitle(enDict),
        description: describe(enDict.landing.sub),
        canonical: `${ ORIGIN }/`,
        alternates: [],
        preloads: [],
        structured: {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Nura Swap',
            url: `${ ORIGIN }/`,
            description: describe(enDict.landing.sub),
            inLanguage: HREFLANG
        }
    }), 'utf8');
    written.push('/');

    // Only the pages that hold text worth ranking. The trading pages render in
    // the browser against a wallet and would be an empty shell to a crawler, and
    // the PDFs are left out on purpose: they say the same thing as the ten HTML
    // pages, and these are the ones that should win the query.
    const urls = ['/', ...LANGS.map((entry) => whitepaperPath(entry.code))];
    const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        ...urls.map((path) =>
        {
            const rows = ['    <url>', `        <loc>${ ORIGIN }${ path }</loc>`];
            if (path !== '/')
            {
                for (const alternate of alternates)
                {
                    rows.push(`        <xhtml:link rel="alternate" hreflang="${ alternate.hreflang }" href="${ alternate.href }"/>`);
                }
            }
            rows.push('    </url>');
            return rows.join('\n');
        }),
        '</urlset>',
        ''
    ].join('\n');
    writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8');

    const robots = [
        '# Nura Swap. Written by scripts/build-seo.mjs - edit that, not this.',
        'User-agent: *',
        'Allow: /',
        '',
        `Sitemap: ${ ORIGIN }/sitemap.xml`,
        ''
    ].join('\n');
    writeFileSync(join(DIST, 'robots.txt'), robots, 'utf8');

    console.log(`seo: ${ ORIGIN } -> ${ written.length } pages, sitemap.xml, robots.txt`);
}

if (!existsSync(DIST))
{
    throw new Error('dist/ is missing - run `azeroth build` before this script.');
}
run();
