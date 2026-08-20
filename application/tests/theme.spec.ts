// Theme selection. The failure this guards is not cosmetic in the way it sounds:
// the class on <html> is what light-dark() resolves against, and a stored
// preference that fails to apply gives a returning user a flash of the wrong
// theme on every load - or, if storage is unavailable, a page that throws before
// it paints.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'nuraswap.theme';

// A fresh module instance per test re-transforms the module graph; slow, but the
// storage read happens exactly once per load and that is the behaviour under test.
vi.setConfig({ testTimeout: 30_000 });

/** A fresh module instance - the init-from-storage read happens once per load. */
async function loadTheme(stored?: string): Promise<typeof import('../src/lib/theme.ts')>
{
    vi.resetModules();
    window.localStorage.clear();
    document.documentElement.className = '';
    if (stored !== undefined)
    {
        window.localStorage.setItem(STORAGE_KEY, stored);
    }
    return await import('../src/lib/theme.ts');
}

function htmlThemeClasses(): string[]
{
    return [...document.documentElement.classList].filter((name) => name === 'light' || name === 'dark');
}

beforeEach(() =>
{
    vi.restoreAllMocks();
});

afterEach(() =>
{
    window.localStorage.clear();
    document.documentElement.className = '';
});

describe('first load', () =>
{
    it('answers a valid theme with no preference stored', async () =>
    {
        const theme = await loadTheme();
        expect(['light', 'dark']).toContain(theme.currentTheme());
    });

    // No stored choice means "follow the system", and the system is expressed by
    // the media query, not by a class. Pinning one here would freeze the page
    // against a user who changes their OS theme mid-session.
    it('pins no class when the choice is the system default', async () =>
    {
        const theme = await loadTheme();
        theme.currentTheme();
        expect(htmlThemeClasses()).toEqual([]);
    });

    it('applies a stored light preference to the document', async () =>
    {
        const theme = await loadTheme('light');
        expect(theme.currentTheme()).toBe('light');
        expect(htmlThemeClasses()).toEqual(['light']);
    });

    it('applies a stored dark preference to the document', async () =>
    {
        const theme = await loadTheme('dark');
        expect(theme.currentTheme()).toBe('dark');
        expect(htmlThemeClasses()).toEqual(['dark']);
    });

    it('ignores a stored value that is not a theme', async () =>
    {
        const theme = await loadTheme('chartreuse');
        expect(['light', 'dark']).toContain(theme.currentTheme());
        expect(htmlThemeClasses()).toEqual([]);
    });

    it('reads storage once, not on every call', async () =>
    {
        const theme = await loadTheme('light');
        // The first read is the initialization; the spy watches what comes after.
        theme.currentTheme();
        const spy = vi.spyOn(window.localStorage, 'getItem');
        theme.currentTheme();
        theme.currentTheme();
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('toggling', () =>
{
    it('flips the theme, the class and the stored preference together', async () =>
    {
        const theme = await loadTheme('dark');
        theme.toggleTheme();
        expect(theme.currentTheme()).toBe('light');
        expect(htmlThemeClasses()).toEqual(['light']);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
    });

    it('never leaves both classes on at once', async () =>
    {
        const theme = await loadTheme('dark');
        theme.toggleTheme();
        theme.toggleTheme();
        expect(htmlThemeClasses()).toEqual(['dark']);
        expect(theme.currentTheme()).toBe('dark');
    });

    it('returns to where it started after two flips', async () =>
    {
        const theme = await loadTheme('light');
        const start = theme.currentTheme();
        theme.toggleTheme();
        theme.toggleTheme();
        expect(theme.currentTheme()).toBe(start);
    });
});

describe('when storage is unavailable', () =>
{
    // Private browsing and hardened profiles throw on access rather than
    // returning null. The page has to render anyway.
    it('falls back to the system theme instead of throwing on read', async () =>
    {
        vi.resetModules();
        document.documentElement.className = '';
        const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() =>
        {
            throw new Error('storage blocked');
        });
        const theme = await import('../src/lib/theme.ts');
        expect(() => theme.currentTheme()).not.toThrow();
        expect(['light', 'dark']).toContain(theme.currentTheme());
        spy.mockRestore();
    });

    it('still switches the theme for this session when the write fails', async () =>
    {
        const theme = await loadTheme('dark');
        const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() =>
        {
            throw new Error('storage blocked');
        });
        expect(() => theme.toggleTheme()).not.toThrow();
        expect(theme.currentTheme()).toBe('light');
        expect(htmlThemeClasses()).toEqual(['light']);
        spy.mockRestore();
    });
});
