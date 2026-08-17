// The app's languages as one typed dictionary per locale: a missing key in any
// of them is a compile error, not a silent English fallback. Reading t() inside
// a component tracks the language signal, so the picker re-renders every string
// in place. SSR renders the 'en' default; the persisted choice applies on
// hydration (and the pre-paint script in index.html sets lang/dir even earlier).
//
// Adding a language: write src/lib/locales/<code>.ts against the Dict type, add
// its row to LANGS, and add its flag to FLAGS in scripts/build-flags.mjs.

import { createSignal } from 'azerothjs';

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

export type { Dict };

export type Lang = 'en' | 'fa' | 'ar' | 'es' | 'pt' | 'hi' | 'zh' | 'ru' | 'fr' | 'tr';

export interface LangInfo
{
    code: Lang;
    /** Endonym - a language list nobody can read is not a language list. */
    native: string;
    /** ISO 3166-1 alpha-2 COUNTRY code: the flag is a country's, the pairing editorial. */
    flag: string;
    /** BCP 47 tag for Intl number and date formatting. */
    locale: string;
    dir: 'ltr' | 'rtl';
    /** Percent sign; Arabic and Persian use U+066A. */
    percent: string;
    /** Currency word appended instead of a leading '$', where that reads better. */
    usdSuffix: string | null;
}

// Not `readonly`: <For each> takes a mutable array. Order is the picker's order.
export const LANGS: LangInfo[] = [
    { code: 'en', native: 'English', flag: 'gb', locale: 'en-US', dir: 'ltr', percent: '%', usdSuffix: null },
    { code: 'fa', native: 'فارسی', flag: 'ir', locale: 'fa-IR', dir: 'rtl', percent: '٪', usdSuffix: 'دلار' },
    { code: 'ar', native: 'العربية', flag: 'sa', locale: 'ar', dir: 'rtl', percent: '٪', usdSuffix: 'دولار' },
    { code: 'es', native: 'Español', flag: 'es', locale: 'es-ES', dir: 'ltr', percent: '%', usdSuffix: null },
    { code: 'pt', native: 'Português', flag: 'pt', locale: 'pt-PT', dir: 'ltr', percent: '%', usdSuffix: null },
    { code: 'hi', native: 'हिन्दी', flag: 'in', locale: 'hi-IN', dir: 'ltr', percent: '%', usdSuffix: null },
    { code: 'zh', native: '中文', flag: 'cn', locale: 'zh-CN', dir: 'ltr', percent: '%', usdSuffix: null },
    { code: 'ru', native: 'Русский', flag: 'ru', locale: 'ru-RU', dir: 'ltr', percent: '%', usdSuffix: null },
    { code: 'fr', native: 'Français', flag: 'fr', locale: 'fr-FR', dir: 'ltr', percent: '%', usdSuffix: null },
    { code: 'tr', native: 'Türkçe', flag: 'tr', locale: 'tr-TR', dir: 'ltr', percent: '%', usdSuffix: null }
];

const DICTS: Record<Lang, Dict> = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };

const STORAGE_KEY = 'nuraswap.lang';
const [langSignal, setLangSignal] = createSignal<Lang>('en');
let initialized = false;

function isLang(value: string | null): value is Lang
{
    return value !== null && Object.prototype.hasOwnProperty.call(DICTS, value);
}

export function langInfo(lang: Lang = currentLang()): LangInfo
{
    return LANGS.find((entry) => entry.code === lang) as LangInfo;
}

/** Flag asset for a language, served from public/ (see scripts/build-flags.mjs). */
export function flagSrc(lang: Lang): string
{
    return `/flags/${ langInfo(lang).flag }.svg`;
}

function initFromStorage(): void
{
    if (initialized || typeof window === 'undefined')
    {
        return;
    }
    initialized = true;
    const stored = readStorage(STORAGE_KEY);
    if (isLang(stored))
    {
        applyLang(stored);
    }
}

// Storage can be absent or throwing (privacy modes, test DOMs) - degrade to the
// default rather than taking the app down.
function readStorage(key: string): string | null
{
    try
    {
        return window.localStorage.getItem(key);
    }
    catch
    {
        return null;
    }
}

function applyLang(lang: Lang): void
{
    setLangSignal(lang);
    if (typeof document !== 'undefined')
    {
        document.documentElement.lang = lang;
        document.documentElement.dir = langInfo(lang).dir;
    }
}

export function currentLang(): Lang
{
    initFromStorage();
    return langSignal();
}

export function setLang(lang: Lang): void
{
    applyLang(lang);
    try
    {
        window.localStorage.setItem(STORAGE_KEY, lang);
    }
    catch
    {
        // Preference lives for the session only.
    }
}

export function t(): Dict
{
    return DICTS[currentLang()];
}

// Localized display formatting. Locales with their own numerals (Persian,
// Arabic) get them in DISPLAY only - inputs normalize back to ASCII before
// parsing (shared/digits).
export function fmtNumber(value: number, maxFractionDigits = 2): string
{
    return new Intl.NumberFormat(langInfo().locale, {
        maximumFractionDigits: maxFractionDigits
    }).format(value);
}

export function fmtUsd(value: number): string
{
    const text = fmtNumber(value, value >= 1000 ? 0 : 2);
    const suffix = langInfo().usdSuffix;
    return suffix === null ? `$${ text }` : `${ text } ${ suffix }`;
}
