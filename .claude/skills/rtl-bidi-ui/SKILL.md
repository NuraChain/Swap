---
name: rtl-bidi-ui
description: Bidirectional UI rules for this repository's ten languages - two of them right-to-left. Covers logical CSS properties, the banned physical utilities the rtl-lint enforces, LTR islands for numbers and addresses, Persian and Arabic typography, and how to verify a layout in both directions. Load before any layout, spacing, icon, animation or text-direction work.
---

# RTL / LTR / Persian-English

This app ships in ten languages. `fa` (فارسی) and `ar` (العربية) are **RTL**; the
other eight are LTR. Direction is set on `<html>` from `lib/i18n.ts`, and the
pre-paint script in `index.html` applies it before first paint.

A layout that looks right in English is **not** verified. Half the audience reads
the mirror image of it.

## The lint that will fail you

`npm run lint:rtl` (`application/scripts/lint-rtl.mjs`, also in CI) greps every
`.azeroth` and `.ts` file under `src/` and rejects:

```
ml-*  mr-*  -ml-*  -mr-*        pl-*  pr-*
left-*  right-*  -left-*  -right-*
text-left  text-right
rounded-l-*  rounded-r-*  rounded-t[lr]-*  rounded-b[lr]-*
border-l-*  border-r-*
space-x-*  divide-x   (unless paired with an rtl:*-reverse or on a data-ltr line)
```

Three escapes are allowed, and only these:

1. a line containing an explicit `rtl:` variant - a considered override;
2. `-translate-x-1/2` centring, which is symmetric;
3. `space-x`/`divide-x` **with** a matching `rtl:space-x-reverse` on the same
   class list, or inside a `data-ltr` island.

## Use logical properties instead

| Instead of | Write |
| --- | --- |
| `ml-2` / `mr-2` | `ms-2` / `me-2` |
| `pl-4` / `pr-4` | `ps-4` / `pe-4` |
| `left-0` / `right-0` | `start-0` / `end-0` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `border-l` | `border-s` |
| `rounded-l-lg` | `rounded-s-lg` |

In hand-written CSS the same applies: `margin-inline`, `padding-inline`,
`inset-inline`, `border-inline`, `text-align: start`.

## LTR islands

Numbers, token amounts, addresses, hashes, chart axes and code are **always**
read left-to-right, even inside a Persian sentence. Mark them:

```html
<span class="font-mono" data-ltr>{ amount }</span>
```

`[data-ltr]` is defined in `@layer base` as `direction: ltr; unicode-bidi: isolate`.
The isolation matters: without it a trailing symbol or a mixed run reorders the
whole line around it.

For a pair inside a sentence - `NURA → USDT` in a toast - wrap the Latin run in
FSI/PDI (`⁨ … ⁩`) so it renders deterministically. `sendTx` labels in
`pages/swap.azeroth` already do this; copy that pattern.

## Icons and motion

A chevron that means "next" must point at the next page in both directions.
The pagination component rotates its glyphs with `rtl:rotate-180` **and** relies
on logical positioning, so position and glyph mirror together. If you add a
directional icon, do the same.

The drawer slides from the inline end. That is done by flipping one variable,
not by duplicating keyframes:

```css
:root        { --drawer-off:  100%; }
[dir='rtl']  { --drawer-off: -100%; }
```

Follow that shape for any new directional animation.

## Persian and Arabic typography

- All three font roles list **Vazirmatn** as the second family, so Arabic-script
  glyphs fall through per glyph. Do not add a `lang`-scoped font switch.
- Persian and Arabic use their own digits in **display only** (`fmtNumber`,
  `fmtAmount` via `Intl`), and their own percent sign `٪` (U+066A) from
  `langInfo().percent`. Never concatenate a literal `%`.
- Input is normalised the other way: `shared/src/digits.ts` converts Persian
  (U+06F0-9), Arabic-Indic (U+0660-9), `٫` and `٬` back to ASCII before any
  amount is parsed. Never parse a raw field value yourself.
- Persian text runs taller than Latin at the same size. Give mixed-script blocks
  `leading-relaxed` and never fix a height that only fits English.
- `fmtUsd` appends a currency word (`دلار`, `دولار`) instead of a leading `$`
  where that reads better - see `langInfo().usdSuffix`.

## Verifying

Checking the lint is necessary but not sufficient - it cannot see a layout that
merely looks wrong. For any visible change, view it in both directions:

```js
// through the Playwright MCP server
browser_navigate  http://localhost:4001/swap
browser_evaluate  () => { localStorage.setItem('nuraswap.lang','fa');
                          document.documentElement.setAttribute('dir','rtl');
                          document.documentElement.lang = 'fa'; }
browser_navigate  http://localhost:4001/swap      // reload so the app re-reads it
browser_take_screenshot
```

Then compare against the LTR shot. Look specifically for: labels and values that
did not swap sides, an icon still pointing the old way, a number that reordered,
text clipped because Persian is wider, and any element still pinned with a
physical offset.

See the `visual-qa` skill for the full viewport matrix.
