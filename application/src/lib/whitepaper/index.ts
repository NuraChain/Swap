// Which document a language reads, and which PDF it downloads. Two languages
// carry their own text; the other eight read the English one, and the page
// says so above the abstract rather than showing a half-translated paper.

import { en } from './en.ts';
import { fa } from './fa.ts';
import type { Lang } from '../i18n.ts';
import type { Whitepaper } from './model.ts';

const DOCS: Partial<Record<Lang, Whitepaper>> = { en, fa };

export interface ResolvedWhitepaper
{
    doc: Whitepaper;
    /** The language the document is actually in - 'en' when `lang` has no translation. */
    lang: Lang;
}

export function whitepaper(lang: Lang): ResolvedWhitepaper
{
    const doc = DOCS[lang];
    return doc === undefined ? { doc: en, lang: 'en' } : { doc, lang };
}

export interface WhitepaperPdf
{
    lang: Lang;
    href: string;
    fileName: string;
}

// Written to public/whitepaper/ by scripts/build-whitepaper-pdf.mjs from the
// same data - one file per translated document. Not ReadonlyArray: `<For each>`
// takes a mutable array.
export const WHITEPAPER_PDFS: WhitepaperPdf[] = [
    { lang: 'en', href: '/whitepaper/nura-swap-whitepaper-en.pdf', fileName: 'nura-swap-whitepaper-en.pdf' },
    { lang: 'fa', href: '/whitepaper/nura-swap-whitepaper-fa.pdf', fileName: 'nura-swap-whitepaper-fa.pdf' }
];
