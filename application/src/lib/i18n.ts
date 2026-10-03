// The app's languages over the FRAMEWORK's locale system. Negotiation, the
// persisted choice and `<html lang>`/`<html dir>` belong to azerothjs now: the
// server stamps the language onto the document before any script runs, the
// client seeds from that attribute, and `setLocale` writes the choice to a
// cookie the next request is rendered from. What remains here is the part the
// framework deliberately leaves to the application - the strings and the
// display formats - read off the framework's one reactive locale signal so a
// switch still redraws every string in place.
//
// Which languages exist is data, and lives in langs.ts (the server imports it
// for the kit's `locales` option, so it stays free of framework imports).
//
// Adding a language: write src/lib/locales/<code>.ts against the Dict type, add
// its row to LANGS, and add its flag to FLAGS in scripts/build-flags.mjs.

import { useLocale, setLocale } from 'azerothjs';

import { ar } from './locales/ar.ts';
import { en, type Dict } from './locales/en.ts';
import { es } from './locales/es.ts';
import { fa } from './locales/fa.ts';
import { fr } from './locales/fr.ts';
import { hi } from './locales/hi.ts';
import { pt } from './locales/pt.ts';
import { ru } from './locales/ru.ts';
import { tr } from './locales/tr.ts';
import { zh } from './locales/zh.ts';
import { isLang, langInfo as langInfoOf, type Lang, type LangInfo } from './langs.ts';

export type { Dict } from './locales/en.ts';
export { LANGS, SUPPORTED_LOCALES, flagSrc, isLang } from './langs.ts';
export type { Lang, LangInfo } from './langs.ts';

const DICTS: Record<Lang, Dict> = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };

/** The primary subtag of a BCP 47 tag: 'fa-IR' -> 'fa'. */
function primary(tag: string): string
{
    return tag.toLowerCase().split('-')[0];
}

/**
 * The reader's language, reactive: reads the framework's locale signal, which
// the server pins per render and the client seeds from `<html lang>`. Every
 * `t()` call inside a markup getter re-runs on a switch, so the picker redraws
 * the page in place. A regional tag the site does not publish ('pt-BR') reads
 * the language it belongs to; English stands when nothing matches.
 */
export function currentLang(): Lang
{
    const tag = useLocale()();
    const code = primary(tag);
    return isLang(code) ? code : 'en';
}

/**
 * The reader's language choice, persisted by the framework: `setLocale` writes
 * the cookie the next request is negotiated from and updates the document's
 * `lang`/`dir`, so everything derived from {@link currentLang} redraws.
 */
export function setLang(lang: Lang): void
{
    setLocale(lang);
}

export function t(): Dict
{
    return DICTS[currentLang()];
}

/**
 * The metadata row for a language - the CURRENT one when none is named, so
 * callers that format for the reader pass no argument. (langs.ts keeps the pure
 * lookup; the default has to live here, where the locale signal is.)
 */
export function langInfo(lang: Lang = currentLang()): LangInfo
{
    return langInfoOf(lang);
}

// Localized display formatting. Locales with their own numerals (Persian,
// Arabic) get them in DISPLAY only - inputs normalize back to ASCII before
// parsing (shared/digits). The region-bearing Intl tag comes from langs.ts
// ('fa-IR'), which the picker's tag alone would lose.
export function fmtNumber(value: number, maxFractionDigits = 2): string
{
    return new Intl.NumberFormat(langInfo(currentLang()).locale, {
        maximumFractionDigits: maxFractionDigits
    }).format(value);
}

// Marks an already-formatted figure as USD: a leading '$', or the locale's
// currency word appended where that reads better. Separate from fmtUsd because
// a PRICE carries its own precision rule (format.ts) and only borrows the mark.
export function markUsd(text: string): string
{
    const suffix = langInfo(currentLang()).usdSuffix;
    return suffix === null ? `$${ text }` : `${ text } ${ suffix }`;
}

export function fmtUsd(value: number): string
{
    return markUsd(fmtNumber(value, value >= 1000 ? 0 : 2));
}
