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

import { OG_HEIGHT, OG_WIDTH } from './lib/brand.mjs';

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
const PRODUCTION_ORIGIN = 'https://swap.nurachain.net';
const ORIGIN = (process.env.SITE_ORIGIN ?? PRODUCTION_ORIGIN).replace(/\/+$/u, '');

// Only the real site invites a crawler in. A staging host serves the same ten
// documents under the same titles, and a search engine that finds them has two
// copies of everything to choose between - so every page it writes there says
// noindex and robots.txt closes the door behind it. The canonical rule above
// stops staging CLAIMING production's address; this stops it competing at all.
const INDEXABLE = ORIGIN === PRODUCTION_ORIGIN;

// `index, follow` is the default a crawler already assumes, so the tag earns its
// place on the second half: max-image-preview:large is what lets Google show the
// 1200x630 card rather than a thumbnail, and it is opt-in.
const ROBOTS = INDEXABLE ? 'index, follow, max-image-preview:large' : 'noindex, nofollow';

const DOCS = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };

// Google reads the plain language subtag happily and we serve ONE document per
// language - no pt-BR beside pt-PT - so the region in LangInfo.locale would
// narrow the match for nothing.
const HREFLANG = LANGS.map((entry) => entry.code);

// The 1200x630 card scripts/build-og-image.mjs renders and commits. A square app
// icon was what stood here, and every validator read it the same way: too small
// for the box every platform crops to, and the wrong ratio for a large summary
// card, so the preview could only ever be a thumbnail beside the title.
const OG_IMAGE = '/og.png';

// What the card SAYS, for a reader who cannot see it. Built from the same
// headline the card renders, so it describes the file that actually ships.
const OG_IMAGE_ALT = `Nura Swap - ${ enDict.landing.headline }`;

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
 * Replaces the shell's generic head tags with this page's own. Every META tag it
 * writes is a tag it strips, so a second run neither duplicates nor drops one.
 * The modulepreloads are the exception and deliberately so: they are filtered
 * against what is already in the head rather than stripped, because the kit
 * writes its own and this must not remove those. A re-run therefore leaves them
 * where they are and rebuilds the block below them - the same tags, once
 * reordered, stable from then on.
 */
function writeHead(html, { lang, locale, dir, title, description, canonical, alternates, structured, preloads })
{
    let out = html.replace(/<html[^>]*>/u, `<html lang="${ lang }" dir="${ dir }">`);

    out = out.replace(/[ \t]*<title>[\s\S]*?<\/title>\n?/u, '');
    out = out.replace(/[ \t]*<meta name="description"[^>]*>\n?/u, '');
    // og:[a-z:] rather than a list, so og:image:width and anything added later
    // is stripped by the same rule that writes it - a list stops matching the
    // moment a tag below it is added.
    out = out.replace(/[ \t]*<meta property="og:[a-z:_]+"[^>]*>\n?/gu, '');
    out = out.replace(/[ \t]*<meta name="robots"[^>]*>\n?/gu, '');
    out = out.replace(/[ \t]*<meta name="twitter:[^"]*"[^>]*>\n?/gu, '');
    out = out.replace(/[ \t]*<link rel="(?:canonical|alternate)"[^>]*>\n?/gu, '');
    out = out.replace(/[ \t]*<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/gu, '');

    const fresh = preloads.filter((href) => !out.includes(`href="${ href }"`));

    const lines = [
        `<title>${ escapeHtml(title) }</title>`,
        `<meta name="description" content="${ escapeHtml(description) }"/>`,
        `<meta name="robots" content="${ ROBOTS }"/>`,
        `<link rel="canonical" href="${ canonical }"/>`,
        ...alternates.map(({ hreflang, href }) => `<link rel="alternate" hreflang="${ hreflang }" href="${ href }"/>`),
        '<meta property="og:site_name" content="Nura Swap"/>',
        `<meta property="og:title" content="${ escapeHtml(title) }"/>`,
        `<meta property="og:description" content="${ escapeHtml(description) }"/>`,
        '<meta property="og:type" content="website"/>',
        `<meta property="og:url" content="${ canonical }"/>`,
        `<meta property="og:locale" content="${ locale }"/>`,
        `<meta property="og:image" content="${ ORIGIN }${ OG_IMAGE }"/>`,
        // Stated rather than left to be discovered: a crawler that has not yet
        // fetched the image still lays the card out correctly, and the first
        // unfurl is the one that gets cached.
        `<meta property="og:image:width" content="${ OG_WIDTH }"/>`,
        `<meta property="og:image:height" content="${ OG_HEIGHT }"/>`,
        '<meta property="og:image:type" content="image/png"/>',
        `<meta property="og:image:alt" content="${ escapeHtml(OG_IMAGE_ALT) }"/>`,
        // summary_large_image, because there is now an image worth the space.
        '<meta name="twitter:card" content="summary_large_image"/>',
        `<meta name="twitter:title" content="${ escapeHtml(title) }"/>`,
        `<meta name="twitter:description" content="${ escapeHtml(description) }"/>`,
        `<meta name="twitter:image" content="${ ORIGIN }${ OG_IMAGE }"/>`,
        `<meta name="twitter:image:alt" content="${ escapeHtml(OG_IMAGE_ALT) }"/>`,
        ...fresh.map((href) => `<link rel="modulepreload" crossorigin href="${ href }">`),
        `<script type="application/ld+json">${ jsonLd(structured) }</script>`
    ];
    const block = lines.map((line) => `        ${ line }`).join('\n');
    // The indentation before </head> would otherwise prefix the block's FIRST
    // line and only that one, leaving it four spaces deeper than its siblings.
    return out.replace(/[ \t]*<\/head>/u, `${ block }\n    </head>`);
}

/**
 * The shell dist/shell.html, which the kit serves for every render: 'client'
 * route - /swap, /liquidity, /portfolio. It is ONE file behind three addresses,
 * so it gets no canonical and no og:url; the app sets the real title on
 * hydration through lib/seo.ts. What it can carry is everything that does not
 * depend on which of the three you asked for: the robots directive, and the
 * card, which is the whole reason a link to /swap pasted into a chat looked
 * like a bare URL before.
 *
 * Only the tags it writes are stripped, so the generic og:title and
 * og:description from index.html survive and this stays idempotent.
 */
function writeShellHead(html)
{
    let out = html;
    out = out.replace(/[ \t]*<meta name="robots"[^>]*>\n?/gu, '');
    out = out.replace(/[ \t]*<meta property="og:image[a-z:_]*"[^>]*>\n?/gu, '');
    out = out.replace(/[ \t]*<meta name="twitter:[^"]*"[^>]*>\n?/gu, '');

    const lines = [
        `<meta name="robots" content="${ ROBOTS }"/>`,
        `<meta property="og:image" content="${ ORIGIN }${ OG_IMAGE }"/>`,
        `<meta property="og:image:width" content="${ OG_WIDTH }"/>`,
        `<meta property="og:image:height" content="${ OG_HEIGHT }"/>`,
        '<meta property="og:image:type" content="image/png"/>',
        `<meta property="og:image:alt" content="${ escapeHtml(OG_IMAGE_ALT) }"/>`,
        '<meta name="twitter:card" content="summary_large_image"/>',
        `<meta name="twitter:image" content="${ ORIGIN }${ OG_IMAGE }"/>`,
        `<meta name="twitter:image:alt" content="${ escapeHtml(OG_IMAGE_ALT) }"/>`
    ];
    const block = lines.map((line) => `        ${ line }`).join('\n');
    // The indentation before </head> would otherwise prefix the block's FIRST
    // line and only that one, leaving it four spaces deeper than its siblings.
    return out.replace(/[ \t]*<\/head>/u, `${ block }\n    </head>`);
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

    // The shell behind the three client-rendered routes. It is written by the
    // kit, not prerendered, so readPage would not find it under a URL.
    const shellFile = join(DIST, 'shell.html');
    if (existsSync(shellFile))
    {
        writeFileSync(shellFile, writeShellHead(readFileSync(shellFile, 'utf8')), 'utf8');
        written.push('shell.html');
    }

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

    // A staging host closes the door and does not advertise the sitemap: the
    // Sitemap: line is an invitation, and every page it would list says noindex.
    const robots = (INDEXABLE
        ? [
            '# Nura Swap. Written by scripts/build-seo.mjs - edit that, not this.',
            'User-agent: *',
            'Allow: /',
            '',
            `Sitemap: ${ ORIGIN }/sitemap.xml`
        ]
        : [
            `# Not the production site (${ ORIGIN }). Written by scripts/build-seo.mjs.`,
            'User-agent: *',
            'Disallow: /'
        ]).concat('').join('\n');
    writeFileSync(join(DIST, 'robots.txt'), robots, 'utf8');

    console.log(`seo: ${ ORIGIN } -> ${ written.length } pages, sitemap.xml, robots.txt`);
}

if (!existsSync(DIST))
{
    throw new Error('dist/ is missing - run `azeroth build` before this script.');
}
run();
