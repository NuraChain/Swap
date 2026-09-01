// Builds the application icon set - favicon, PWA icons, apple-touch icon - from
// ONE geometry: the shamseh that components/ui/shamseh.component.azeroth draws.
// Hand-maintained icons drift; the favicon this replaced still carried the old
// gold identity and had lost the inscribed ring, so the tab and the header were
// showing two different marks.
//
// Pure node: zlib deflates the pixels and the PNG/ICO containers are written
// here. No rasterizer dependency, no headless browser, no new package.
//
// Rerun after changing the geometry or the colours; the output is committed.
//
//   node application/scripts/build-app-icons.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- the artwork

// A 100x100 tile. The mark keeps the component's proportions - ring at 19/31 of
// the outer square, core at 4.5/31 - but carries a heavier stroke: the component
// draws 2.5 units at 26px, and that same ratio at favicon size is a grey haze
// rather than a line.
const TILE = 100;
const CORNER = 22;                  // corner radius of the tile

// Optical scaling, not two identities. Below about 24px the ring closes on the
// core and the whole mark floods into one blue blob, so the small sizes drop the
// ring and carry the weight in a thicker stroke instead: same eight-pointed
// silhouette, still legible at 16.
const FULL = { half: 24, stroke: 5.5, ring: 24 * 19 / 31, ringStroke: 5.5 * 0.8, core: 5 };
const COMPACT = { half: 25, stroke: 8, ring: 0, ringStroke: 0, core: 6.5 };
const DETAIL_FROM = 24;             // px; below this the compact mark is drawn

// The mark's furthest point is a square corner plus half a stroke. A maskable
// icon may only rely on the middle 80% - a circle of radius 40 on this tile -
// so this is the number that keeps the launcher from shaving the points off.
for (const mark of [FULL, COMPACT])
{
    const reach = mark.half * Math.SQRT2 + mark.stroke / 2;
    if (reach > TILE * 0.4)
    {
        throw new Error(`the mark reaches ${ reach.toFixed(1) } - outside the maskable safe circle`);
    }
}

// Fixed hexes rather than tokens: an icon is one artwork in every theme and
// lives outside the document, so `light-dark()` has nothing to resolve here.
// These are --bg and --ice from src/styles.css in their DARK values - the tile
// is always night water, and the mark is always the cold light in it.
const GROUND = [0x09, 0x0d, 0x12];
const MARK = [0x5f, 0xb3, 0xe8];

const hex = (rgb) => `#${ rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('') }`;

// ------------------------------------------------------------------ distances

function sdBox(x, y, half)
{
    const dx = Math.abs(x) - half;
    const dy = Math.abs(y) - half;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

function sdRoundBox(x, y, half, radius)
{
    return sdBox(x, y, half - radius) - radius;
}

// Distance to the shamseh: two square outlines at 45 degrees to each other, the
// inscribed ring, and the filled core. The union is the nearest of them.
function sdMark(x, y, mark)
{
    const rx = (x + y) * Math.SQRT1_2;
    const ry = (y - x) * Math.SQRT1_2;
    const radius = Math.hypot(x, y);
    const parts = [
        Math.abs(sdBox(x, y, mark.half)) - mark.stroke / 2,
        Math.abs(sdBox(rx, ry, mark.half)) - mark.stroke / 2,
        radius - mark.core
    ];
    if (mark.ring > 0)
    {
        parts.push(Math.abs(radius - mark.ring) - mark.ringStroke / 2);
    }
    return Math.min(...parts);
}

// ----------------------------------------------------------------- rasterizer

/**
 * One RGBA sample per pixel. A signed distance IS the coverage ramp once it is
 * in pixel units, so half a pixel either side of the edge antialiases exactly -
 * no supersampling, and the 16px favicon comes out as clean as the 512.
 *
 * `bleed` fills the tile edge to edge instead of rounding it: what a maskable
 * icon and an apple-touch icon want, because the launcher applies its own mask
 * and a second rounded corner inside it reads as a mistake.
 */
function render(size, { bleed })
{
    const scale = size / TILE;
    const mark = size < DETAIL_FROM ? COMPACT : FULL;
    const coverage = (distance) => Math.min(Math.max(0.5 - distance * scale, 0), 1);
    const pixels = Buffer.alloc(size * size * 4);

    for (let row = 0; row < size; row++)
    {
        for (let column = 0; column < size; column++)
        {
            const x = (column + 0.5) / scale - TILE / 2;
            const y = (row + 0.5) / scale - TILE / 2;

            const ground = bleed ? 1 : coverage(sdRoundBox(x, y, TILE / 2, CORNER));
            const glyph = coverage(sdMark(x, y, mark));

            // The mark drawn over the ground, then flattened out of premultiplied
            // form - PNG stores straight alpha.
            const under = ground * (1 - glyph);
            const alpha = glyph + under;
            const at = (row * size + column) * 4;
            if (alpha > 0)
            {
                for (let channel = 0; channel < 3; channel++)
                {
                    pixels[at + channel] = Math.round((MARK[channel] * glyph + GROUND[channel] * under) / alpha);
                }
                pixels[at + 3] = Math.round(alpha * 255);
            }
        }
    }

    return pixels;
}

// ------------------------------------------------------------------ png / ico

const CRC_TABLE = Array.from({ length: 256 }, (_, index) =>
{
    let value = index;
    for (let bit = 0; bit < 8; bit++)
    {
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});

function crc32(buffer)
{
    let value = 0xffffffff;
    for (const byte of buffer)
    {
        value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data)
{
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

function png(size, pixels)
{
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;      // bits per channel
    header[9] = 6;      // truecolour with alpha
    // 10..12 stay zero: deflate, adaptive filtering, no interlace.

    // Every scanline is prefixed with its filter byte. None (0) is the honest
    // choice for artwork this flat - deflate already collapses the ground.
    const stride = size * 4;
    const raw = Buffer.alloc(size * (stride + 1));
    for (let row = 0; row < size; row++)
    {
        pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// PNG-compressed entries rather than the legacy BMP form: every browser that
// still asks for /favicon.ico reads them, and the alpha survives intact.
function ico(entries)
{
    const directory = Buffer.alloc(6 + entries.length * 16);
    directory.writeUInt16LE(1, 2);                  // type: icon
    directory.writeUInt16LE(entries.length, 4);

    let offset = directory.length;
    entries.forEach(({ size, data }, index) =>
    {
        const at = 6 + index * 16;
        directory[at] = size;                       // 0 would mean 256; nothing here is
        directory[at + 1] = size;
        directory.writeUInt16LE(1, at + 4);         // colour planes
        directory.writeUInt16LE(32, at + 6);        // bits per pixel
        directory.writeUInt32LE(data.length, at + 8);
        directory.writeUInt32LE(offset, at + 12);
        offset += data.length;
    });

    return Buffer.concat([directory, ...entries.map((entry) => entry.data)]);
}

// ------------------------------------------------------------------ the vector

// Trailing zeros make the geometry look more precise than it is.
const round = (value) => Number(value.toFixed(2)).toString();

// The vector carries the FULL mark: a browser that takes it renders it into
// whatever box it has, and on the displays that box is 2x or 3x device pixels.
// The 16px case is covered by favicon.ico, which is where the compact mark went.
function svg()
{
    const side = round(FULL.half * 2);
    const corner = round(-FULL.half);
    return [
        '<!-- Generated by scripts/build-app-icons.mjs - edit the script, not this file. -->',
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ TILE } ${ TILE }" width="${ TILE }" height="${ TILE }" role="img" aria-label="Nura Swap">`,
        `    <rect width="${ TILE }" height="${ TILE }" rx="${ CORNER }" fill="${ hex(GROUND) }"/>`,
        `    <g transform="translate(${ TILE / 2 } ${ TILE / 2 })" fill="none" stroke="${ hex(MARK) }" stroke-width="${ round(FULL.stroke) }">`,
        `        <rect x="${ corner }" y="${ corner }" width="${ side }" height="${ side }"/>`,
        `        <rect x="${ corner }" y="${ corner }" width="${ side }" height="${ side }" transform="rotate(45)"/>`,
        `        <circle r="${ round(FULL.ring) }" stroke-width="${ round(FULL.ringStroke) }"/>`,
        `        <circle r="${ round(FULL.core) }" fill="${ hex(MARK) }" stroke="none"/>`,
        '    </g>',
        '</svg>',
        ''
    ].join('\n');
}

// ----------------------------------------------------------------------- write

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const raster = (size, bleed = false) => png(size, render(size, { bleed }));

const written = [
    ['icon.svg', Buffer.from(svg(), 'utf8')],
    // Legacy, and still the URL a browser guesses when nothing is declared.
    ['favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: raster(size) })))],
    ['icon-192.png', raster(192)],
    ['icon-512.png', raster(512)],
    // Both of these are masked by the platform, so they go edge to edge.
    ['icon-maskable-512.png', raster(512, true)],
    ['apple-touch-icon.png', raster(180, true)]
];

for (const [name, data] of written)
{
    writeFileSync(join(out, name), data);
}

console.log(`app icons: ${ written.length } files written to public/`);
