// The whitepaper is data rendered twice - by the page and by the print script -
// and written in all ten languages the application ships. The compiler holds
// each document to the Whitepaper type; what it cannot see is what this file
// defends: that every translation has every part, section and block the English
// one has, in the same order; that every anchor is unique and stable across
// languages; that asking for a language gives you that language; and that a PDF
// actually ships for each one.

import { describe, expect, it } from 'vitest';

import { LANGS } from '../src/lib/i18n.ts';
import type { Lang } from '../src/lib/i18n.ts';
import { ar } from '../src/lib/whitepaper/ar.ts';
import { en } from '../src/lib/whitepaper/en.ts';
import { es } from '../src/lib/whitepaper/es.ts';
import { fa } from '../src/lib/whitepaper/fa.ts';
import { fr } from '../src/lib/whitepaper/fr.ts';
import { hi } from '../src/lib/whitepaper/hi.ts';
import { pt } from '../src/lib/whitepaper/pt.ts';
import { ru } from '../src/lib/whitepaper/ru.ts';
import { tr } from '../src/lib/whitepaper/tr.ts';
import { zh } from '../src/lib/whitepaper/zh.ts';
import { WHITEPAPER_PDFS, whitepaper } from '../src/lib/whitepaper/index.ts';
import { sectionsOf } from '../src/lib/whitepaper/model.ts';
import type { Block, Whitepaper } from '../src/lib/whitepaper/model.ts';

// Asked of the bundler, like the flag assets in i18n.spec: the question is
// which PDFs SHIP, and the glob answers from the public directory.
const PDF_ASSETS = new Set(
    Object.keys(import.meta.glob('../public/whitepaper/*.pdf'))
        .map((path) => path.split('/').pop() ?? '')
);

const DOCS: Record<Lang, Whitepaper> = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };
const TRANSLATIONS = (Object.entries(DOCS) as Array<[Lang, Whitepaper]>).filter(([lang]) => lang !== 'en');
const ALL = Object.values(DOCS);

/** The shape of a document with the words taken out. */
function outline(doc: Whitepaper): unknown
{
    return doc.parts.map((part) => ({
        id: part.id,
        sections: part.sections.map((section) => ({
            id: section.id,
            blocks: section.blocks.map(shape)
        }))
    }));
}

function shape(block: Block): unknown
{
    switch (block.kind)
    {
        case 'list':
            return { kind: block.kind, ordered: block.ordered, items: block.items.length };
        case 'table':
            // Which columns are code is presentation, and it can differ: a Latin
            // term column in English is Persian prose in the translation.
            return { kind: block.kind, columns: block.head.length, rows: block.rows.length };
        case 'steps':
        case 'facts':
            return { kind: block.kind, items: block.items.length };
        default:
            return { kind: block.kind };
    }
}

/** Every string a document carries, so a blank one is a finding. */
function strings(doc: Whitepaper): string[]
{
    const out: string[] = [...Object.values(doc.meta), ...doc.abstract];
    for (const part of doc.parts)
    {
        out.push(part.label, part.title, part.lede);
        for (const section of part.sections)
        {
            out.push(section.title);
            for (const block of section.blocks)
            {
                out.push(...stringsOf(block));
            }
        }
    }
    return out;
}

function stringsOf(block: Block): string[]
{
    switch (block.kind)
    {
        case 'p':
        case 'h3':
            return [block.text];
        case 'list':
            return block.items;
        case 'table':
            return [...block.head, ...block.rows.flat()];
        case 'callout':
            return [block.title, block.text];
        case 'steps':
            return block.items.flatMap((item) => [item.title, item.text]);
        case 'facts':
            return block.items.flatMap((item) => [item.label, item.value]);
        case 'formula':
            return [block.text, block.caption];
    }
}

describe('the whitepaper', () =>
{
    it('carries a document in every language the application ships', () =>
    {
        expect(Object.keys(DOCS).sort()).toEqual(LANGS.map((entry) => entry.code).sort());
    });

    it.each(TRANSLATIONS)('keeps the %s outline identical to the English one', (_lang, doc) =>
    {
        expect(outline(doc)).toEqual(outline(en));
    });

    it('anchors every section once, and the same way in every language', () =>
    {
        const ids = sectionsOf(en).map(({ section }) => section.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const [lang, doc] of TRANSLATIONS)
        {
            expect(sectionsOf(doc).map(({ section }) => section.id), lang).toEqual(ids);
        }
        for (const id of ids)
        {
            expect(id, id).toMatch(/^[a-z][a-z-]*$/);
        }
    });

    it('numbers sections continuously across the two parts', () =>
    {
        const numbers = sectionsOf(en).map(({ number }) => number);
        expect(numbers[0]).toBe(1);
        expect(numbers.at(-1)).toBe(numbers.length);
        expect(en.parts.length).toBe(2);
    });

    it('says nothing blank, in any language', () =>
    {
        for (const doc of ALL)
        {
            for (const text of strings(doc))
            {
                expect(text.trim(), text).not.toBe('');
            }
        }
    });

    it('marks only whole columns as code, inside the table', () =>
    {
        for (const doc of ALL)
        {
            for (const { section } of sectionsOf(doc))
            {
                for (const block of section.blocks)
                {
                    if (block.kind === 'table')
                    {
                        for (const column of block.mono)
                        {
                            expect(column, section.id).toBeLessThan(block.head.length);
                        }
                        for (const row of block.rows)
                        {
                            expect(row.length, section.id).toBe(block.head.length);
                        }
                    }
                }
            }
        }
    });

    it('reads a language its own document, never a substitute', () =>
    {
        for (const { code } of LANGS)
        {
            expect(whitepaper(code)).toEqual({ doc: DOCS[code], lang: code });
        }
    });

    it('ships a PDF for every language, in the picker’s order', () =>
    {
        expect(WHITEPAPER_PDFS.map((pdf) => pdf.lang)).toEqual(LANGS.map((entry) => entry.code));
        for (const pdf of WHITEPAPER_PDFS)
        {
            expect(PDF_ASSETS, pdf.fileName).toContain(pdf.fileName);
            expect(pdf.href).toBe(`/whitepaper/${ pdf.fileName }`);
        }
    });
});
