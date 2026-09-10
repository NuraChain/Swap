// Which document a language reads, which URL it reads at, and which PDF it
// downloads. Every language the application ships carries its own translation of
// the paper, so there is no English fallback to explain and no half-translated
// page to apologise for.
//
// The documents are NOT imported here. Ten translations in one module made one
// chunk of every language - an English reader downloading Hindi, Chinese and
// eight more to read none of them. Each is its own dynamic import, so the
// bundler gives each its own chunk and a reader pays for the one they opened.

import { LANGS, type Lang } from '../i18n.ts';
import type { Whitepaper } from './model.ts';

// Written as ten literal `import()` calls rather than a computed specifier: the
// bundler reads these statically to cut the chunks, and a template literal is
// invisible to it.
const DOCS: Record<Lang, () => Promise<Whitepaper>> = {
    en: () => import('./en.ts').then((module) => module.en),
    fa: () => import('./fa.ts').then((module) => module.fa),
    ar: () => import('./ar.ts').then((module) => module.ar),
    es: () => import('./es.ts').then((module) => module.es),
    pt: () => import('./pt.ts').then((module) => module.pt),
    hi: () => import('./hi.ts').then((module) => module.hi),
    zh: () => import('./zh.ts').then((module) => module.zh),
    ru: () => import('./ru.ts').then((module) => module.ru),
    fr: () => import('./fr.ts').then((module) => module.fr),
    tr: () => import('./tr.ts').then((module) => module.tr)
};

/** The document a language reads - always that language, never a fallback. */
export function loadWhitepaper(lang: Lang): Promise<Whitepaper>
{
    return DOCS[lang]();
}

// One URL per translation, because ten languages behind one address are nine
// languages a search engine cannot reach. English keeps the bare path - it is
// the one that has been linked to - and carries the canonical and x-default.
const EN_PATH = '/whitepaper';

export function whitepaperPath(lang: Lang): string
{
    return lang === 'en' ? EN_PATH : `${ EN_PATH }/${ lang }`;
}

// Which translation a pathname is, or null when it is not the paper at all. The
// PDFs sit under the same prefix (`/whitepaper/nura-swap-whitepaper-fa.pdf`), so
// the tail is matched against the language codes exactly rather than taken as a
// parameter.
export function whitepaperLangOf(pathname: string): Lang | null
{
    const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    if (path === EN_PATH)
    {
        return 'en';
    }
    const tail = path.startsWith(`${ EN_PATH }/`) ? path.slice(EN_PATH.length + 1) : '';
    return LANGS.some((entry) => entry.code === tail) ? tail as Lang : null;
}

export interface WhitepaperPdf
{
    lang: Lang;
    href: string;
    fileName: string;
}

// Written to public/whitepaper/ by scripts/build-whitepaper-pdf.mjs from the
// same data - one file per language, in the picker's order. Not ReadonlyArray:
// `<For each>` takes a mutable array.
export const WHITEPAPER_PDFS: WhitepaperPdf[] = (
    ['en', 'fa', 'ar', 'es', 'pt', 'hi', 'zh', 'ru', 'fr', 'tr'] as Lang[]
).map((lang) => ({
    lang,
    href: `/whitepaper/nura-swap-whitepaper-${ lang }.pdf`,
    fileName: `nura-swap-whitepaper-${ lang }.pdf`
}));
