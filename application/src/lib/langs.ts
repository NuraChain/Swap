// The app's languages as one typed table - pure data, no framework imports.
// The server half reads this file too (the kit's `locales` option), so it must
// stay free of anything browser-shaped: no signals, no document, no window.
//
// A missing key in any locale dictionary is a compile error (see locales/en.ts);
// this file only answers WHICH languages exist and HOW each is presented.

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

// Not `readonly`: <For each> takes a mutable array. Order is the picker's order,
// and `supported[0]` is the site's own language first - the framework's locale
// negotiation serves this list's codes in exactly this order.
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

/** The BCP 47 tags the site is published in, best first - the kit's `locales.supported`. */
export const SUPPORTED_LOCALES: readonly string[] = LANGS.map((entry) => entry.code);

export function isLang(value: string | null | undefined): value is Lang
{
    return value !== undefined && value !== null && LANGS.some((entry) => entry.code === value);
}

export function langInfo(lang: Lang = 'en'): LangInfo
{
    return LANGS.find((entry) => entry.code === lang) as LangInfo;
}

/** Flag asset for a language, served from public/ (see scripts/build-flags.mjs). */
export function flagSrc(lang: Lang): string
{
    return `/flags/${ langInfo(lang).flag }.svg`;
}
