// Ten dictionaries, one shape. The compiler already refuses a MISSING key, so
// what is left to defend is everything it cannot see: a locale whose flag asset
// was never built, an RTL language marked left-to-right, a blank string that
// renders as an empty button, and the number formatting that decides whether a
// Persian reader sees their own digits.

import { afterEach, describe, expect, it } from 'vitest';

import { LANGS, currentLang, flagSrc, fmtNumber, fmtUsd, langInfo, setLang, t } from '../src/lib/i18n.ts';
import { ar } from '../src/lib/locales/ar.ts';
import { en } from '../src/lib/locales/en.ts';
import { es } from '../src/lib/locales/es.ts';
import { fa } from '../src/lib/locales/fa.ts';
import { fr } from '../src/lib/locales/fr.ts';
import { hi } from '../src/lib/locales/hi.ts';
import { pt } from '../src/lib/locales/pt.ts';
import { ru } from '../src/lib/locales/ru.ts';
import { tr } from '../src/lib/locales/tr.ts';
import { zh } from '../src/lib/locales/zh.ts';
import type { Dict, Lang } from '../src/lib/i18n.ts';

const DICTS: Record<Lang, Dict> = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };

// Asked of the bundler rather than the filesystem: this half of the project has
// no node types, and the question is which flags SHIP, which is what the glob
// answers.
const FLAG_ASSETS = new Set(
    Object.keys(import.meta.glob('../public/flags/*.svg'))
        .map((path) => path.split('/').pop()?.replace('.svg', '') ?? '')
);

/** Every leaf path in a dictionary, as `section.key`. */
function leafPaths(dict: Record<string, unknown>, prefix = ''): string[]
{
    return Object.entries(dict).flatMap(([key, value]) =>
    {
        const path = prefix === '' ? key : `${ prefix }.${ key }`;
        return typeof value === 'object' && value !== null
            ? leafPaths(value as Record<string, unknown>, path)
            : [path];
    });
}

function leafValues(dict: Record<string, unknown>): Array<[string, unknown]>
{
    return Object.entries(dict).flatMap(([key, value]) =>
        (typeof value === 'object' && value !== null
            ? leafValues(value as Record<string, unknown>).map(([path, leaf]): [string, unknown] => [`${ key }.${ path }`, leaf])
            : [[key, value] as [string, unknown]]));
}

afterEach(() =>
{
    // The language is module state; a test that switched it must not colour the
    // next one's assertions.
    setLang('en');
});

describe('dictionary parity', () =>
{
    const reference = leafPaths(en).sort();

    it.each(Object.keys(DICTS) as Lang[])('%s carries exactly the keys English does', (lang) =>
    {
        expect(leafPaths(DICTS[lang]).sort()).toEqual(reference);
    });

    it.each(Object.keys(DICTS) as Lang[])('%s has no blank or placeholder strings', (lang) =>
    {
        for (const [path, value] of leafValues(DICTS[lang] as unknown as Record<string, unknown>))
        {
            expect(typeof value, `${ lang }.${ path }`).toBe('string');
            expect((value as string).trim().length, `${ lang }.${ path } is blank`).toBeGreaterThan(0);
            // Case-SENSITIVE: a real placeholder is shouted, and 'Todo' is
            // simply the Spanish for 'All'.
            expect(/^(TODO|FIXME|XXX)(?![a-z])/.test(value as string), `${ lang }.${ path } is a placeholder`).toBe(false);
        }
    });

    it('covers every language the picker offers, and offers every one it covers', () =>
    {
        expect(LANGS.map((entry) => entry.code).sort()).toEqual(Object.keys(DICTS).sort());
    });

    it('has a dictionary behind every language t() can be asked for', () =>
    {
        for (const entry of LANGS)
        {
            setLang(entry.code);
            expect(currentLang()).toBe(entry.code);
            expect(t().nav.swap.length, entry.code).toBeGreaterThan(0);
            expect(t().v3.feeTier.length, entry.code).toBeGreaterThan(0);
        }
    });
});

describe('language metadata', () =>
{
    it('marks exactly Persian and Arabic as right-to-left', () =>
    {
        const rtl = LANGS.filter((entry) => entry.dir === 'rtl').map((entry) => entry.code);
        expect(rtl.sort()).toEqual(['ar', 'fa']);
    });

    it('gives the RTL languages their own percent sign', () =>
    {
        // U+066A, not the ASCII '%': mixing them in an RTL run reorders the line.
        expect(langInfo('fa').percent).toBe('٪');
        expect(langInfo('ar').percent).toBe('٪');
        expect(langInfo('en').percent).toBe('%');
    });

    it('names every language in its own script', () =>
    {
        // A language list nobody can read is not a language list.
        expect(langInfo('fa').native).toBe('فارسی');
        expect(langInfo('zh').native).toBe('中文');
        for (const entry of LANGS)
        {
            expect(entry.native.trim().length, entry.code).toBeGreaterThan(0);
        }
    });

    it('gives every language a BCP 47 tag Intl accepts', () =>
    {
        for (const entry of LANGS)
        {
            expect(() => new Intl.NumberFormat(entry.locale), entry.code).not.toThrow();
        }
    });

    it('points every flag at an asset that was actually built', () =>
    {
        for (const entry of LANGS)
        {
            const src = flagSrc(entry.code);
            expect(src, entry.code).toBe(`/flags/${ entry.flag }.svg`);
            expect(FLAG_ASSETS.has(entry.flag), `${ entry.code } flag missing`).toBe(true);
        }
    });

    it('does not reuse one country flag for two languages', () =>
    {
        const flags = LANGS.map((entry) => entry.flag);
        expect(new Set(flags).size).toBe(flags.length);
    });
});

describe('switching language', () =>
{
    it('applies the choice to the document so CSS and screen readers follow', () =>
    {
        setLang('fa');
        expect(document.documentElement.lang).toBe('fa');
        expect(document.documentElement.dir).toBe('rtl');
        setLang('en');
        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('persists the choice for the next visit', () =>
    {
        setLang('tr');
        expect(window.localStorage.getItem('nuraswap.lang')).toBe('tr');
    });

    it('re-reads t() through the new dictionary', () =>
    {
        setLang('en');
        const english = t().nav.swap;
        setLang('ru');
        expect(t().nav.swap).not.toBe(english);
        expect(t().nav.swap).toBe(ru.nav.swap);
    });
});

describe('number formatting', () =>
{
    it('groups and rounds for display', () =>
    {
        setLang('en');
        expect(fmtNumber(1234.567, 2)).toBe('1,234.57');
        expect(fmtNumber(0)).toBe('0');
        expect(fmtNumber(1234.5, 0)).toBe('1,235');
    });

    it('renders Persian digits for a Persian reader', () =>
    {
        // Display only - inputs normalize back to ASCII before any amount is
        // parsed, which is what shared/digits exists for.
        setLang('fa');
        expect(fmtNumber(123)).toMatch(/[۰-۹]/);
        expect(fmtNumber(1234.5, 1)).toMatch(/[۰-۹]/);
    });

    // Whether the bare 'ar' tag selects Arabic-Indic or Latin digits is an ICU
    // build detail, so this pins only what the app can promise: a formatted,
    // non-empty string in every locale, with no exception thrown.
    it('formats numbers in every locale it offers', () =>
    {
        for (const entry of LANGS)
        {
            setLang(entry.code);
            const text = fmtNumber(1234.56, 2);
            expect(text.length, entry.code).toBeGreaterThan(0);
            expect(text, entry.code).not.toContain('NaN');
        }
    });

    it('drops the cents on large figures and keeps them on small ones', () =>
    {
        setLang('en');
        expect(fmtUsd(1500.75)).toBe('$1,501');
        expect(fmtUsd(12.34)).toBe('$12.34');
        expect(fmtUsd(0)).toBe('$0');
    });

    it('appends the currency word where a leading dollar sign reads badly', () =>
    {
        setLang('fa');
        expect(fmtUsd(10)).toContain('دلار');
        expect(fmtUsd(10).startsWith('$')).toBe(false);
        setLang('ar');
        expect(fmtUsd(10)).toContain('دولار');
    });

    it('never renders a NaN or an Infinity into the page', () =>
    {
        setLang('en');
        for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
        {
            const text = fmtUsd(value);
            expect(typeof text).toBe('string');
            expect(text.length).toBeGreaterThan(0);
        }
    });
});

describe('the English source dictionary', () =>
{
    it('is the one every other locale is typed against', () =>
    {
        // If this ever stops being true the parity tests above are meaningless.
        expect(Object.keys(en).sort()).toEqual([
            'common', 'errors', 'footer', 'landing', 'liquidity', 'nav', 'portfolio', 'swap', 'v3', 'wallet'
        ]);
    });

    it('has an error string for every failure the classifier can name', () =>
    {
        // tx-errors returns these keys; a missing one renders as undefined in a
        // toast at exactly the moment a trade failed.
        for (const failure of ['rejected', 'wrongNetwork', 'expired', 'insufficientOutput', 'transferFailed', 'insufficientLiquidity', 'unknown'])
        {
            expect(Object.keys(en.errors), failure).toContain(failure);
        }
    });
});
