// The page heads, in ONE place. `useHead()` (azerothjs 2.1) is the writer now:
// a page declares its title, meta, links and JSON-LD and the same declaration
// is serialized into the served document on the server - where a crawler reads
// it - and applied to the live `document.head` on the client, so a client-side
// navigation keeps the tab honest without a second renderer. The old
// arrangement - a build script splicing heads into prerendered files, and a
// browser-side `document.title` write mirroring it - is gone; both jobs are the
// framework's one declaration now.
//
// What stays application-side is the POLICY: which origin a canonical claims,
// whether a host may index at all, and the shapes the pages fill in.

import type { HeadInput, HeadValue } from 'azerothjs';

import { langInfo, type Lang } from './langs.ts';

// The SSR bundle and the prerender run in node, where the environment is the
// configuration; a browser bundle has no process, never evaluates this, and is
// typed without node's ambient declarations on purpose.
function env(name: string): string | undefined
{
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

/**
 * The social card's pixel size, declared beside the file itself:
 * scripts/build-og-image.mjs renders exactly this and every head here declares
 * exactly this - one pair of numbers, or the file and the og:image dimensions
 * would disagree. scripts/lib/brand.mjs re-exports these for the image renderer.
 */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** The card scripts/build-og-image.mjs renders and commits, from the site root. */
export const OG_IMAGE_PATH = '/og.png';

/**
 * The origin canonical, hreflang, og:url and the sitemap claim. Production by
// default; a staging build points SITE_ORIGIN elsewhere so it cannot claim the
// production address. Anything other than the production origin also flips
// every page to `noindex, nofollow` and closes robots.txt - staging must not
// compete with production for the query.
 */
const PRODUCTION_ORIGIN = 'https://swap.nurachain.net';

export function siteOrigin(): string
{
    return (env('SITE_ORIGIN') ?? PRODUCTION_ORIGIN).replace(/\/+$/u, '');
}

/** Whether THIS build may invite a crawler in. */
export function indexable(): boolean
{
    return siteOrigin() === PRODUCTION_ORIGIN;
}

// `index, follow` is the default a crawler already assumes, so the tag earns
// its place on the second half: max-image-preview:large is what lets Google
// show the 1200x630 card rather than a thumbnail, and it is opt-in.
export const ROBOTS_DIRECTIVE = indexable()
    ? 'index, follow, max-image-preview:large'
    : 'noindex, nofollow';

// og:locale is language_TERRITORY, not a BCP 47 tag. LangInfo.locale carries
// the region for nine of the ten; Arabic is written region-less there on
// purpose, so its flag - the one country the language is paired with - supplies
// the half Open Graph insists on.
export function ogLocale(lang: Lang): string
{
    const info = langInfo(lang);
    const [language, region] = info.locale.split('-');
    return `${ language }_${ (region ?? '').length === 2 ? region.toUpperCase() : info.flag.toUpperCase() }`;
}

// A meta description is cut off by the search engine around 160 characters, so
// cut it here instead - at the end of a sentence, where the text still reads
// like a sentence. The terminators cover the Latin, Arabic, Devanagari and CJK
// full stops, because zh and hi have no spaces to fall back on.
const TERMINATORS = ['.', '!', '?', '۔', '؟', '।', '。', '！', '？'];

export function describe(text: string, limit = 160): string
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

export interface PageHeadInput
{
    /**
     * The composed document title, already in the page's language. A getter
     * stays reactive on the client - a language switch keeps the tab honest.
     */
    title: HeadValue;
    /** The meta description, already trimmed by {@link describe}; a getter as title. */
    description: HeadValue;
    /** The app path this page claims as its own - canonical and og:url. */
    canonicalPath: string;
    /** The language this page is rendered in - `og:locale` follows it, live if a getter. */
    lang: Lang | (() => Lang);
    /**
     * The sibling-language addresses this page annotates, x-default included.
     * Only pages with one address per language declare them: hreflang
     * annotates a relationship BETWEEN urls, and a set all naming one
     * negotiated address says nothing.
     */
    alternates?: ReadonlyArray<{ hreflang: string; href: string }>;
    /** Structured data blocks, serialized inert by the head pipeline. */
    jsonLd?: HeadInput['jsonLd'];
}

/**
 * The per-page head: the page's own facts over the site-wide defaults App
 * declares (site name, card, robots). Absolute URLs are not optional here -
 * canonical, hreflang and og:url are meaningless relative - so the origin is
 * joined here, once.
 */
export function pageHead(input: PageHeadInput): HeadInput
{
    const origin = siteOrigin();
    const canonical = `${ origin }${ input.canonicalPath }`;
    const card = `${ origin }${ OG_IMAGE_PATH }`;
    const lang = (): Lang => (typeof input.lang === 'function' ? input.lang() : input.lang);
    const title = (): string => (typeof input.title === 'function' ? input.title() : input.title);
    const description = (): string => (typeof input.description === 'function' ? input.description() : input.description);
    const cardAlt = (): string => `Nura Swap - ${ title() }`;
    return {
        title: input.title,
        meta: [
            { name: 'description', content: input.description },
            { name: 'robots', content: ROBOTS_DIRECTIVE },
            { property: 'og:title', content: title },
            { property: 'og:description', content: description },
            { property: 'og:url', content: canonical },
            { property: 'og:locale', content: () => ogLocale(lang()) },
            { property: 'og:image', content: card },
            { property: 'og:image:alt', content: cardAlt },
            { name: 'twitter:title', content: title },
            { name: 'twitter:description', content: description },
            { name: 'twitter:image', content: card },
            { name: 'twitter:image:alt', content: cardAlt }
        ],
        links: [
            { rel: 'canonical', href: canonical },
            ...(input.alternates ?? []).map((alternate) => ({ rel: 'alternate', hreflang: alternate.hreflang, href: alternate.href }))
        ],
        jsonLd: input.jsonLd
    };
}

/** 'Nura Swap · Whitepaper' - the document names itself, in its own language. */
export function whitepaperTitle(doc: { meta: { title: string; subtitle: string } }): string
{
    return `${ doc.meta.title } · ${ doc.meta.subtitle }`;
}

/** 'Nura Swap · Trade straight from your wallet' - the headline, minus its full stop. */
export function landingTitle(dict: { landing: { headline: string } }): string
{
    return `Nura Swap · ${ dict.landing.headline.replace(/[.!?]$/u, '') }`;
}
