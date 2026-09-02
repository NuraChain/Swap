// The whitepaper as DATA, not markup: one typed document per language, rendered
// twice - by the page (pages/whitepaper.azeroth) and by the print script
// (scripts/build-whitepaper-pdf.mjs) that writes the downloadable PDF. Keeping
// the prose out of both renderers is what lets the page and the PDF say the
// same thing, and lets a translation be a second data file rather than a
// second page.
//
// Blocks are a small closed set: a paragraph, a sub-heading, a list, a table, a
// callout, a step list, a fact grid, and a formula. Anything a section wants to
// say fits one of them; a renderer that meets a kind it does not know renders
// nothing, so a new kind is added here first and in both renderers after.

export interface Paragraph
{
    kind: 'p';
    text: string;
}

export interface SubHeading
{
    kind: 'h3';
    text: string;
}

export interface List
{
    kind: 'list';
    ordered: boolean;
    items: string[];
}

export interface Table
{
    kind: 'table';
    head: string[];
    rows: string[][];
    /** Column indexes that hold code, addresses or figures: mono face, LTR island. */
    mono: number[];
}

export interface Callout
{
    kind: 'callout';
    title: string;
    text: string;
}

export interface Steps
{
    kind: 'steps';
    items: Array<{ title: string; text: string }>;
}

export interface Facts
{
    kind: 'facts';
    items: Array<{ label: string; value: string; mono: boolean }>;
}

export interface Formula
{
    kind: 'formula';
    text: string;
    caption: string;
}

export type Block = Paragraph | SubHeading | List | Table | Callout | Steps | Facts | Formula;

export interface Section
{
    /** The anchor - stable across languages so a link survives a language switch. */
    id: string;
    title: string;
    blocks: Block[];
}

export interface Part
{
    id: string;
    /** 'Part I' - the running label above the part title. */
    label: string;
    title: string;
    lede: string;
    sections: Section[];
}

export interface WhitepaperMeta
{
    title: string;
    subtitle: string;
    /** The document's own version, distinct from the application release it describes. */
    version: string;
    date: string;
    /** 'covers application release 1.2.1' */
    covers: string;
    abstractTitle: string;
    disclaimerTitle: string;
    disclaimer: string;
}

export interface Whitepaper
{
    meta: WhitepaperMeta;
    abstract: string[];
    parts: Part[];
}

// Constructors, so a document reads as prose with a light frame around it
// rather than as a wall of `kind:` keys.
export const p = (text: string): Paragraph => ({ kind: 'p', text });
export const h3 = (text: string): SubHeading => ({ kind: 'h3', text });
export const ul = (...items: string[]): List => ({ kind: 'list', ordered: false, items });
export const ol = (...items: string[]): List => ({ kind: 'list', ordered: true, items });
export const table = (head: string[], rows: string[][], mono: number[] = []): Table => ({ kind: 'table', head, rows, mono });
export const callout = (title: string, text: string): Callout => ({ kind: 'callout', title, text });
export const steps = (...items: Array<{ title: string; text: string }>): Steps => ({ kind: 'steps', items });
export const facts = (...items: Array<{ label: string; value: string; mono?: boolean }>): Facts =>
    ({ kind: 'facts', items: items.map((item) => ({ ...item, mono: item.mono ?? false })) });
export const formula = (text: string, caption: string): Formula => ({ kind: 'formula', text, caption });

/** Every section of a document in reading order, numbered from 1 across parts. */
export function sectionsOf(doc: Whitepaper): Array<{ number: number; section: Section }>
{
    return doc.parts.flatMap((part) => part.sections).map((section, index) => ({ number: index + 1, section }));
}
