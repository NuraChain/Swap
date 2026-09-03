// Which document a language reads, and which PDF it downloads. Every language
// the application ships carries its own translation of the paper, so there is
// no English fallback to explain and no half-translated page to apologise for.

import { ar } from './ar.ts';
import { en } from './en.ts';
import { es } from './es.ts';
import { fa } from './fa.ts';
import { fr } from './fr.ts';
import { hi } from './hi.ts';
import { pt } from './pt.ts';
import { ru } from './ru.ts';
import { tr } from './tr.ts';
import { zh } from './zh.ts';
import type { Lang } from '../i18n.ts';
import type { Whitepaper } from './model.ts';

const DOCS: Record<Lang, Whitepaper> = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };

export interface ResolvedWhitepaper
{
    doc: Whitepaper;
    /** The language the document is in - always the one asked for. */
    lang: Lang;
}

export function whitepaper(lang: Lang): ResolvedWhitepaper
{
    return { doc: DOCS[lang], lang };
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
