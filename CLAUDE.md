# Nura Swap — working notes for Claude Code

An open AMM front-end and indexer for Nura Chain (EVM, chain id 1020), built on
UniswapV3 only. Three workspaces, one npm lockfile:

```
shared/        bigint maths (V3 Q64.96 ticks), digit normalization, the typed
               deployment artifacts
server/        indexer + market API: chain watcher -> sqlite -> REST (@azerothjs/http)
application/   the site: compiled .azeroth components on vite (AzerothJS)
```

The exchange contracts live in a **separate repository**. This one consumes its
deployment artifact (`shared/deployments/1020.json`) and never imports Solidity.
The artifact's `v3` block is required; there is no V2 anywhere - no pairs table,
no protocol switch, no constant-product maths.

---

# Frontend

## Architecture

**AzerothJS 2** (`.azeroth` single-file components) on **Vite 8**, **TypeScript 6**,
**TailwindCSS 4** in CSS-first mode. There is **no React** here — no hooks, no
`useMemo`/`useCallback`/`memo`, no JSX tooling. A component reads:

```
export default component Name(props: { ... })
{
    state x = 0;            // reactive local state
    derived y = x * 2;      // computed
    effect (x) { ... }      // reruns when a listed dep changes
    mount { ... }           // browser-only; cleanup { ... } tears down
    <div>markup is the final expression</div>
}
```

Markup control flow is `<Show when={} fallback={} let={}>` and
`<For each={} key={} let={}>`. `batch { }` groups writes so a half-applied state
never reaches an effect.

Routes are declared once in `src/routes.ts` and shared by the client router, the
SSR entry and the server. The landing page prerenders (`render: 'static'`) with
`revalidate: 30`, so it is ISR: the market stats land in the HTML a crawler reads
instead of in a numberless shell the browser fills in. The trading pages are
`render: 'client'` and lazy. The whitepaper is TWO static routes - `/whitepaper`
for English and `/whitepaper/:lang` for the other nine, enumerated by
`staticParams` from `LANGS` - and only the translation the address names is
loaded, so a reader pays for one document. Ten languages behind one URL were nine
languages no search engine could reach, and one 157 kB chunk every reader paid
for.

Keep the whitepaper page an **eager `component`, not `lazy`**. A lazy page adopts
its server markup from a deferred effect run (the chunk-load write), and there the
route's loader resource has not settled yet - so a page that gates on it
(`<Show when={ doc }>` where the server rendered the document) hydrates against
`undefined`, the mismatch makes the framework fall back to a FULL client render,
and the prerendered bytes are silently thrown away on every visit (a
`HydrationMismatchError` in dev). An eager page adopts in the main pass, where the
loader handoff has already been applied - the landing page, eager with the same
loader-then-Show pattern, is the working reference. What stays lazy is the DATA:
the route loader imports only the one translation the address names.

**SSR safety matters**: the prerender evaluates every page module, so nothing may
touch `window`/`localStorage` at module scope. `tests/ssr-safety.spec.ts` is the
gate.

## Design system

`application/src/styles.css` is the single source of truth (~330 lines). Read it
before styling anything.

Tokens are CSS variables resolved through `light-dark()` and exposed to Tailwind
via `@theme inline` — so every token is automatically correct in both themes:

`bg` `panel` `raised` · `ink` `faint` · `ice` (`ice-hi`/`ice-lo`/`ice-ink`) ·
`val` `rise` `fall` · `line` `line-strong` · `glow`

`val` is reserved for **on-chain numbers** — amounts, prices, stats. Type roles
are `font-display` (Unbounded), `font-sans` (IBM Plex Sans), `font-mono`
(IBM Plex Mono); each lists **Vazirmatn** second so Persian falls through per
glyph with no `lang`-scoped switch.

Surface and control classes live in `@layer components`: `.card`, `.card-pop`,
`.btn-ice`, `.btn-ghost`, `.eyebrow`, and the overlay choreography
`.anim-overlay` / `.anim-drawer` / `.anim-pop` with `.is-closing` playing exits.

There is **no `tailwind.config.js`** and there must not be one. Button and badge
variants are full literal class strings in `components/ui/variants.ts` — a
composed name like `` `btn-${kind}` `` is invisible to the Tailwind scanner.

## Component rules

```
Existing component -> Reuse -> Extend with an optional prop -> Create new, with a reason
```

The whitepaper is data, not markup: `src/lib/whitepaper/{model,index}.ts` plus
one document per language. **All ten languages are translated** - there is no
English fallback - and `tests/whitepaper.spec.ts` holds every one to the English
outline block for block, so a paragraph added to `en.ts` has to be added to the
other nine. Register: plain spoken language, short sentences, everyday words.
The page renders the data, and `scripts/build-whitepaper-pdf.mjs` renders the
same data to `public/whitepaper/nura-swap-whitepaper-<lang>.pdf` through a
headless Chrome (rerun it after editing the text; the ten PDFs are committed).
Devanagari and CJK have no bundled webfont and fall through to system faces in
the PDF, so regenerate on a machine that has them.

Read the nearest neighbours before adding anything. No new UI framework, no
component library, no CSS-in-JS. No hex colours in components.

## Page heads, locale and the CSP

The detail - how the head, the sitemap, the share card, the locale negotiation
and the CSP fit together, and why - lives in `.claude/rules/head-seo-csp.md`,
which loads when you touch those files. What always holds:

- The **pages own their head**, through `useHead()` and the `pageHead()` factory
  in `src/lib/seo.ts`. Nothing splices tags into a head at build time.
- The **language and direction belong to the framework**: the server negotiates
  per request and stamps `<html lang dir>`. The pre-paint script in `index.html`
  is theme-only, and editing it changes the hash `server/src/csp.ts` carries.
- The CSP is tight on purpose. **A font is never inlined**, and a blocked asset
  is fixed at the build end, never by relaxing a directive.
- Anything other than the production `SITE_ORIGIN` is `noindex, nofollow`, and
  `dist/shell.html` carries no canonical or `og:url`.
- The share card `public/og.png` is **committed**: rerun
  `scripts/build-og-image.mjs` after changing the landing copy or the palette.

## Responsive rules

Tailwind v4 defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280); the page shell is
`mx-auto max-w-6xl px-4 py-8 sm:py-12`. `sm:` carries most of the mobile→desktop
switch. The only arbitrary breakpoint in the codebase is `max-[380px]:hidden` on
the wordmark.

Target viewports for review: **1440×900**, **1024×768**, **390×844**.

## RTL / LTR rules

Ten languages; `fa` and `ar` are RTL. **`npm run lint:rtl` runs in CI and rejects
physical direction utilities** — `ml-*`, `pr-*`, `left-*`, `text-right`,
`rounded-l-*`, `border-r-*`, and an `rtl:*-reverse` bolted onto `space-x`/
`divide-x`: Tailwind v4 builds those from `margin-inline-*`/`border-inline-*`, so
they already mirror and the reverse puts the gap or rule on the wrong side.

Use logical utilities: `ms/me`, `ps/pe`, `start/end`, `text-start`/`text-end`,
`border-s/e`, `rounded-s/e`.

Numbers, amounts, addresses, hashes and code are LTR islands — mark them
`data-ltr` (defined as `direction: ltr; unicode-bidi: isolate`). Persian and
Arabic get their own digits and percent sign in **display only**; input is
normalized back to ASCII by `shared/src/digits.ts` before any amount is parsed.

Directional icons mirror with `rtl:rotate-180`; the drawer flips by retargeting
one variable (`--drawer-off`), not by duplicating keyframes.

A layout verified only in English is not verified.

## Accessibility rules

Prefer native HTML semantics over ARIA; do not add ARIA to quiet a checker.

`:focus-visible` already paints a 2px `--ice` outline globally — do not remove
it. ARIA **state** attributes are enumerated strings: write
`aria-pressed={ String(on) }`, never `aria-pressed={ on }` (a boolean renders as
`aria-pressed=""`, which announces nothing). One `h1` per page. Icon-only
controls need an `aria-label`. Dialogs carry `role="dialog"`, `aria-modal`, a
label, focus on open and Escape to close.

## Playwright rules

The **Playwright MCP server** is configured at user scope
(`npx -y @playwright/mcp@latest`). There is no Playwright package, config or
browser test suite in this repository, and none is needed for the review loop —
do not add a second one.

## Visual QA workflow

Load the `visual-qa` skill before reviewing any visible change - it holds the
whole loop: the one-origin `npm run dev` (`curl` the root before driving a
browser), the three viewports, both directions (write the `locale` cookie, then
reload - the server negotiates per request), `browser_snapshot` as well as
screenshots, and `browser_console_messages` - an unhandled rejection is a
finding.

## Testing workflow

vitest everywhere; **no second runner**. Component tests go through `renderTest`
from `@azerothjs/testing` with `fire()` for events. Vitest globals are off, so
register `afterEach(cleanup)` yourself or a portaled modal survives into the next
test. Reactive writes land on the next macrotask — await one before asserting.

```sh
npm run test:web        # application suite
npm test                # all three suites
npm run coverage        # per-workspace HTML in <workspace>/coverage
```

See `TESTING.md` for the full map.

## Performance rules

Measure before changing. Animations stay on `opacity`/`transform` (never width,
height or offsets) and `prefers-reduced-motion: reduce` disables them in
`@layer base` — anything new obeys the same rule. Trading pages are lazy routes;
keep them that way. The whitepaper page is the deliberate exception - eager,
because a lazy page cannot hydrate a loader-gated root (see Architecture) - and
the document data stays lazy through the route loader. The wallet store refreshes
on receipts and a 5s visible-tab timer, never per block — do not add block-driven
polling.

**An SSR page must hydrate from its own bytes.** The browser console is part of
the gate, not a suggestion: a `HydrationMismatchError` means the framework threw
the prerendered markup away and re-rendered the page on the client, which is the
one thing a static route exists to prevent.

## Gates before calling frontend work done

```sh
npm run lint:rtl        # physical direction utilities
npx azeroth check       # types + lint, both halves
npm run build           # client + SSR bundle + prerender
npm run test:web
```

Plus: seen in a browser at all three viewports, in both directions, with a clean
console.
