---
name: visual-qa
description: The repeatable browser QA loop for this repository - start the one-origin dev session, drive the Playwright MCP server across three viewports in both text directions, screenshot, inspect against a checklist, fix, re-run. Load after any change that alters what a page looks like, and before calling UI work finished.
---

# Visual QA loop

Writing the markup is half the job. A UI change is done when it has been *seen*,
at every size, in both directions.

```
Build -> npm run dev -> Playwright -> desktop -> tablet -> mobile
      -> LTR -> RTL -> screenshot -> inspect -> fix -> repeat
```

## Starting the application

**One process, one origin.** The kit's dev session serves the pages from the
server half with vite running inside it - there is no second port and no dev
proxy to keep in step.

```sh
npm run dev          # one origin; PORT defaults to 3000
```

Use `PORT=3001 npm run dev` if something already holds 3000. Wait until the root
answers (`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/`) before
navigating; a screenshot of a page that has not booted is a screenshot of
nothing. The dev session still runs the kit's per-request locale negotiation, so
dev agrees with production about `<html lang dir>`.

The pages that matter: `/` (landing, ISR - its live stats are in the HTML),
`/swap`, `/liquidity`, `/portfolio`, and `/whitepaper` plus a translation such as
`/whitepaper/fa`. The trading pages render client-side and need the deployment
from the API, so a dead server half shows empty states rather than content -
which is itself a state worth checking. **`/whitepaper/<unknown>` must render the
fallback with a 404 status, not an error overlay.**

## Viewports

Tailwind v4 defaults are in force (`sm` 640, `md` 768, `lg` 1024, `xl` 1280) and
the page shell is `max-w-6xl` (1152px). These three sizes exercise the real
branches:

| Name | Size | What it proves |
| --- | --- | --- |
| Desktop | 1440 × 900 | above `lg`; the shell is centred with margin to spare |
| Tablet | 1024 × 768 | exactly the `lg` boundary; two-column grids collapse here |
| Mobile | 390 × 844 | below `sm`; the nav becomes the drawer, cards go full width |

One extra worth a look when you touch the header: **375 × 812**. The wordmark is
hidden below 380px (`max-[380px]:hidden`), and that is the only arbitrary
breakpoint in the codebase.

## Driving it

Through the Playwright MCP server (already configured - do not add a second one,
and do not add a Playwright config to the repo; there is none and the project
does not need one for this loop):

```
browser_resize            { width: 1440, height: 900 }
browser_navigate          http://localhost:3000/swap
browser_snapshot                              # accessibility tree, not pixels
browser_take_screenshot   { fullPage: true }
browser_console_messages                      # errors that never reach the page
```

Switch direction by writing the cookie the framework persists, then reloading:

```
browser_evaluate  () => { document.cookie = 'locale=fa; path=/; max-age=31536000'; }
browser_navigate  <same url>
```

`en` returns to LTR. The reload is a REAL per-request negotiation: the server
stamps `<html lang dir>` and the head resolves in the chosen language, so check
that rather than trusting a client-side re-render. The header picker writes the
same cookie through `setLocale()`.

The full matrix is 3 viewports × 2 directions × the pages you touched.

Interactions worth exercising because they have no other coverage: open the
settings sheet on `/swap`, open the token picker, open the wallet sheet, open the
mobile drawer, and page through a table.

## What to look for

**Layout** - alignment, spacing rhythm, overflow, clipping, unintended wrapping,
container width, horizontal scrollbars (there should be none; wide tables scroll
inside their own `overflow-x-auto`).

**Typography** - fonts actually loaded (Unbounded for display, Plex for body and
mono, Vazirmatn for Persian), hierarchy intact, line height comfortable for
Persian, no mixed-script reflow.

**Components** - buttons, inputs, dropdowns, cards, tables, dialogs, nav, tabs,
tooltips: all still recognisably from the same system.

**States** - default, hover, focus (tab through it - the `--ice` outline must be
visible on every control), active, disabled, loading, success, error, empty.

**Responsive** - the three sizes above, plus long text (Persian labels are
wider), short text, and dynamic content (a table with 1 row and with 30).

**Console** - any error or unhandled rejection is a finding, not noise.

## Motion

Animations here are `opacity` and `transform` only (`anim-overlay`,
`anim-drawer`, `anim-pop`, `animate-rise`, `animate-shamseh`), which is what you
want - no width/height/top/left transitions, no forced synchronous layout.

`prefers-reduced-motion: reduce` already disables all of them in `@layer base`.
Check it holds:

```
browser_resize / emulate reduced motion, then confirm the drawer and modal
appear without animating.
```

Anything new must obey the same rule and stay on compositor-friendly properties.

## Accessibility pass

`browser_snapshot` returns the accessibility tree - read it rather than guessing
from pixels. Confirm:

- one `h1` per page and a sensible heading order;
- every control has an accessible name (icon-only buttons need `aria-label`);
- toggles report `aria-pressed="true"`/`"false"` as strings, not `""`;
- dialogs are `role="dialog"` + `aria-modal="true"` + labelled, focus moves in
  on open and Escape closes;
- inputs have labels or `aria-label`;
- links are links and buttons are buttons.

Prefer native semantics over ARIA. Do not add ARIA attributes to make a checker
quiet - fix the element instead.

## Closing the loop

A finding is not fixed until the same shot is taken again and is clean. Then run
the project's own gates:

```sh
npm run lint:rtl
npx azeroth check
npm run build
npm run test:web
```
