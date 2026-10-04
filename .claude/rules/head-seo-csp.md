---
paths:
  - "application/src/lib/seo.ts"
  - "application/src/lib/i18n.ts"
  - "application/src/lib/langs.ts"
  - "application/src/App.azeroth"
  - "application/src/pages/**"
  - "application/index.html"
  - "application/vite.config.ts"
  - "application/scripts/**"
  - "server/src/main.ts"
  - "server/src/csp.ts"
  - "server/tests/csp.spec.ts"
---

# Page heads, robots and the sitemap

Moved out of the root `CLAUDE.md` so it loads only with the files it describes.
Paths without a workspace prefix are under `application/`.

The **pages own their head**, through the framework's `useHead()`: `App.azeroth`
declares the site-wide defaults (robots, `og:site_name`, the share card, the
default title) and a page overrides per key, so the nesting IS the precedence.
`src/lib/seo.ts` holds the tag factory (`pageHead`, `describe`, `ogLocale`) and
the origin/robots policy. Title, description, canonical, the ten-way `hreflang`
cluster, Open Graph, Twitter and JSON-LD are therefore written in the same run
that renders the page - serialized server-side where a crawler reads them, and
live on the client without a build step. `server/src/main.ts` passes
`locales: { supported: SUPPORTED_LOCALES }` to the kit, which is what makes the
kit stamp `<html lang>`/`dir` per request and prerender a file per language.

`scripts/build-seo.mjs` no longer splices tags into a head. It runs the
framework's prerender over `dist-server/entry.server.js` (writing `/`,
`/whitepaper` and the nine `index.<lang>.html` variants), then writes
`sitemap.xml` (with `xhtml:link` alternates) and `robots.txt` from the same
`seo.ts` policy - two artifacts that describe the whole site rather than one
page, and the sitemap needs the one fact no page knows: the origin. It runs as
part of `npm run build` (the root script, not `azeroth build` alone).

It also writes `dist/shell.html`, which the kit serves for the three
`render: 'client'` routes. That one gets the robots directive and the card only:
one file stands behind `/swap`, `/liquidity` and `/portfolio`, so a canonical or
an `og:url` there would claim one address for three.

The origin comes from `SITE_ORIGIN`, defaulting to `https://swap.nurachain.net`;
point it elsewhere on a staging host so it cannot claim production's canonical.
Anything other than the production origin also flips every page to
`noindex, nofollow` and closes `robots.txt` - staging must not compete with
production for the query.

The share card is `public/og.png`, 1200x630, rendered and **committed** by
`scripts/build-og-image.mjs`; rerun it after changing the landing copy or the
palette. It and `build-whitepaper-pdf.mjs` share one headless Chrome
(`scripts/lib/chrome.mjs`) and one set of brand pieces - the mark, the embedded
`@font-face` rules, the HTML escape (`scripts/lib/brand.mjs`), which is also
where the card's dimensions live, so the file and the `og:image:width` that
declares it cannot disagree.
Titles and the rest of the head come from `src/lib/seo.ts`, which the pages
import too - one `pageHead()` declaration is what the server serializes and what
a client-side navigation applies, so the two can never set different strings.

The **language and direction belong to the framework** (AzerothJS 2.1's i18n):
`server/src/main.ts` hands the kit `locales: { supported: SUPPORTED_LOCALES }`
for both the dev session and the production pages, the server negotiates per
request - the `locale` cookie a reader's choice writes first, then
`Accept-Language` - and stamps `<html lang dir>` before any script runs. The
client seeds from that attribute, so the two sides cannot disagree, and
`setLocale()` writes the cookie and updates the document. `src/lib/langs.ts` is
the pure-data locale table (the server half imports it, so it carries no
framework imports); `src/lib/i18n.ts` keeps only what the framework leaves to the
application - the ten dictionaries and the display formats, read off the
framework's one reactive locale so a switch redraws every string in place. The
pre-paint script in `index.html` is theme-only now, plus a one-time move of the
old `nuraswap.lang` local-storage key onto that cookie. Editing that inline
script changes its hash - `server/src/csp.ts` carries it and
`server/tests/csp.spec.ts` fails until you update it.

The CSP is tight on purpose and two build-side rules keep it that way. **A font
is never inlined**: `build.assetsInlineLimit` in `vite.config.ts` refuses every
`woff/woff2/ttf/otf`, because vite's 4 kB default turned the small Unbounded
subsets into `data:` URIs that `font-src 'self'` then blocked in production -
fix that at the build end, never by relaxing the directive. And the only
external script the policy admits is the Cloudflare Web Analytics beacon, which
the proxy injects and this repository never asks for; turn the injection off in
the Cloudflare dashboard and the two entries in `csp.ts` should come back out.
