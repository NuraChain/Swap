// The build's SEO step: the per-language prerender, the sitemap and robots.txt.
//
//   node scripts/build-seo.mjs                     # after `azeroth build`
//   SITE_ORIGIN=https://staging.nurachain.net node scripts/build-seo.mjs
//
// WHAT MOVED INTO THE FRAMEWORK. The kit's `useHead()` writes the head now: a
// page declares its title, description, robots directive, canonical, the
// ten-way hreflang cluster, Open Graph, Twitter and JSON-LD, and the same
// declaration is serialized into the served document on the server - where a
// crawler reads it - and applied live on the client. The old job of this
// script, splicing those tags into prerendered files after the fact and
// keeping a browser-side document.title write in step, is gone; the head can
// no longer drift from the page because it is the page's own declaration.
//
// WHAT STAYS HERE, and why. Two artifacts are not pages:
//
//   - The per-language prerender. The CLI's own prerender pass writes each
//     static page once; the site is published in ten languages, so this pass
//     renders each one AGAIN per language - `index.fa.html` beside
//     `index.html` - and the mounted kit serves a request the file its
//     negotiation picks. A static site has a real artifact for every reader
//     instead of one language's copy corrected after it arrives.
//   - sitemap.xml and robots.txt. They are directory-level documents about the
//     whole site, not any page's head, and the sitemap's xhtml:link cluster
//     needs the ORIGIN - the one fact a page never knows.
//
// The origin comes from SITE_ORIGIN, defaulting to the production address; a
// staging build points it elsewhere, which also flips every page's robots
// directive to noindex (the pages read the same variable at render time) and
// closes robots.txt.
//
// The prerender pass refuses a page whose LOADER rejects - a build must not
// write a half-loaded page as a permanent artifact - so this step fails the
// build loudly rather than shipping a broken seed.

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

import { prerender } from '@azerothjs/kit/prerender';

import { LANGS } from '../src/lib/langs.ts';
import { whitepaperPath } from '../src/lib/whitepaper/index.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const SSR_ENTRY = join(ROOT, 'dist-server', 'entry.server.js');

// Absolute URLs are not optional here: every sitemap entry is meaningless relative. One
// origin, overridable for a staging host that must not claim the production one's canonical.
const PRODUCTION_ORIGIN = 'https://swap.nurachain.net';
const ORIGIN = (process.env.SITE_ORIGIN ?? PRODUCTION_ORIGIN).replace(/\/+$/u, '');

// Only the real site invites a crawler in. A staging host serves the same ten
// documents under the same titles, and a search engine that finds them has two
// copies of everything to choose between - so every page it writes there says
// noindex (lib/seo.ts reads the same variable) and robots.txt closes the door
// behind it. The canonical rule stops staging CLAIMING production's address;
// this stops it competing at all.
const INDEXABLE = ORIGIN === PRODUCTION_ORIGIN;

async function prerenderLocales()
{
    if (!existsSync(SSR_ENTRY))
    {
        throw new Error('dist-server/entry.server.js is missing - run `azeroth build` first.');
    }
    const ssr = await import(pathToFileURL(SSR_ENTRY).href);
    await prerender({
        routes: ssr.routes,
        clientDir: DIST,
        renderer: ssr.renderPage,
        locales: LANGS.map((entry) => entry.code)
    });
}

function writeSitemap()
{
    // Only the pages that hold text worth ranking. The trading pages render in
    // the browser against a wallet and would be an empty shell to a crawler, and
    // the PDFs are left out on purpose: they say the same thing as the ten HTML
    // pages, and these are the ones that should win the query.
    const urls = ['/', ...LANGS.map((entry) => whitepaperPath(entry.code))];
    // Every translation names every other, and x-default points at the English
    // one - the address a reader who matches no listed language should land on.
    const alternates = [
        ...LANGS.map((entry) => ({ hreflang: entry.code, href: `${ ORIGIN }${ whitepaperPath(entry.code) }` })),
        { hreflang: 'x-default', href: `${ ORIGIN }${ whitepaperPath('en') }` }
    ];
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
}

function writeRobots()
{
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
}

if (!existsSync(DIST))
{
    throw new Error('dist/ is missing - run `azeroth build` before this script.');
}

await prerenderLocales();
writeSitemap();
writeRobots();
console.log(`seo: prerendered ${ LANGS.length } languages, sitemap.xml and robots.txt for ${ ORIGIN }`);
