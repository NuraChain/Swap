// The page titles, in ONE place. scripts/build-seo.mjs writes them into the
// prerendered head, where a crawler reads them; the app sets the same string
// when a client-side navigation changes the page under a tab that is already
// open. Two renderers over one formula - the same arrangement the whitepaper
// itself uses for its prose.

import type { Dict } from './i18n.ts';
import type { Whitepaper } from './whitepaper/model.ts';

/** 'Nura Swap · Whitepaper' - the document names itself, in its own language. */
export function whitepaperTitle(doc: Whitepaper): string
{
    return `${ doc.meta.title } · ${ doc.meta.subtitle }`;
}

/** 'Nura Swap · Trade straight from your wallet' - the headline, minus its full stop. */
export function landingTitle(dict: Dict): string
{
    return `Nura Swap · ${ dict.landing.headline.replace(/[.!?]$/u, '') }`;
}

/**
 * Browser-only, and only for navigations: the prerendered head already carries
 * the right title on a first load, so this is what keeps it right afterwards.
 */
export function setDocumentTitle(title: string): void
{
    if (typeof document !== 'undefined')
    {
        document.title = title;
    }
}
