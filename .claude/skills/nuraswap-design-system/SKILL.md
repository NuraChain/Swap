---
name: nuraswap-design-system
description: The design system of THIS repository - its tokens, surface and control classes, component inventory, and the reuse-before-create rule. Load before writing or changing any .azeroth component, any Tailwind class list, or anything in styles.css. Triggers on - build a component, add a page, restyle, spacing, colour, typography, card, button, badge, modal, table, form, empty state, loading state, error state, hover, focus, disabled.
---

# Nura Swap design system

This project already has a deliberate visual language. Your job is to extend it,
never to re-invent it. Before adding anything, read `application/src/styles.css` -
it is the single source of truth and it is only ~330 lines.

## The stack you are working in

AzerothJS 2 (`.azeroth` single-file components, compiled by `@azerothjs/compiler`)
on Vite 8, with **TailwindCSS 4 in CSS-first mode**. There is no
`tailwind.config.js` and there must not be one: tokens are declared with
`@theme inline` inside `application/src/styles.css`.

This is **not React**. There are no hooks. A component is:

```
export default component Name(props: { ... })
{
    state x = 0;               // reactive local state
    derived y = x * 2;         // computed
    effect (x) { ... }         // reruns when a listed dep changes
    mount { ... }  cleanup { ... }
    <div>markup goes last, as the component body's final expression</div>
}
```

Control flow in markup is `<Show when={} fallback={} let={}>` and
`<For each={} key={} let={}>`. Never import React, never add JSX tooling.

## Tokens - use these names, not raw colours

Declared as CSS variables under `:root` and exposed to Tailwind through
`@theme inline`. Every one resolves through `light-dark()`, so a token is
automatically correct in both themes. **Never hardcode a hex value in a
component.**

| Role | Token | Tailwind utility |
| --- | --- | --- |
| Page background | `--bg` | `bg-bg` |
| Panel / header / footer | `--panel` | `bg-panel` |
| Raised surface inside a card | `--raised` | `bg-raised` |
| Primary text | `--ink` | `text-ink` |
| Secondary text | `--faint` | `text-faint` |
| Brand accent | `--ice` (`--ice-hi` / `--ice-lo` / `--ice-ink`) | `text-ice` `bg-ice` |
| On-chain numbers | `--val` | `text-val` |
| Up / positive | `--rise` | `text-rise` |
| Down / negative | `--fall` | `text-fall` |
| Hairline | `--line` / `--line-strong` | `border-line` |

`--val` is reserved for **amounts, prices and stats**. It is the one colour that
means "this is a number off the chain". Do not spend it on decoration.

Fonts are three roles, each with Vazirmatn as the second family so Persian
glyphs fall through per-glyph with no `lang`-scoped switch:

- `font-display` - Unbounded. Headings and the wordmark only.
- `font-sans` - IBM Plex Sans. Default body.
- `font-mono` - IBM Plex Mono. Every number, address and hash.

Shadows are `--shadow-card` and `--shadow-pop`; use the `.card` / `.card-pop`
classes rather than reaching for them directly.

## Surface and control classes

Defined in `@layer components` in `styles.css`. Prefer these over rebuilding the
same look out of utilities:

- `.card` - the standard bordered surface with a vertical wash.
- `.card-pop` - the raised variant for modals and the swap card.
- `.btn-ice` - the primary action. Gradient, pressed-glass, has hover/active/disabled built in.
- `.btn-ghost` - the secondary action. Border that turns `--ice` on hover.
- `.eyebrow` - the small uppercase section label.
- `.anim-overlay` / `.anim-drawer` / `.anim-pop` - overlay choreography; the
  shared parent gets `.is-closing` to play the exit, then unmounts.

Button and badge variants live as **full literal class strings** in
`application/src/components/ui/variants.ts`. That is a Tailwind scanner
constraint, not a style preference - a composed class name like
`` `btn-${kind}` `` is invisible to the scanner and will not be emitted.

## Component inventory - check here before creating anything

```
ui/       badge  button  empty-state  flag  icon  input  modal
          pagination  shamseh  skeleton  toasts  tooltip
market/   add-chain-button  add-liquidity  add-v3-liquidity  amount-field
          connect-button  faucet-button  fee-tier-select  manage-v3-position
          positions-grid  price-chart  protocol-switch  remove-liquidity
          token-icon  token-select  tx-list  v3-positions-grid
          wallet-menu  wallet-modal
layout/   footer  header  indexer-banner  language-modal
```

The order of operations is fixed:

```
Existing component -> Reuse -> Extend with a prop -> Create new only if justified
```

Concretely, before you write a new component: `ls application/src/components/**`
and read the two or three nearest neighbours. A "new" amount input, icon button,
empty state, modal, or pager almost certainly exists already. If you extend one,
add an **optional** prop with a safe default so no existing call site changes.

## Spacing, radius, layout

- Page shell: `mx-auto max-w-6xl px-4 py-8 sm:py-12`. Keep it.
- Card padding: `p-4 sm:p-5` for the swap card, `p-5` for content cards,
  `p-3.5` for the small detail lists inside them.
- Radius: `rounded-xl` for panels inside cards, `rounded-lg` for controls,
  `rounded-full` for pills and token marks. `.card` sets its own `1rem`.
- Gaps: `gap-2` inside a control row, `gap-3`/`gap-4` between related blocks,
  `gap-6`/`gap-10` between page sections.

Use the scale that is already there. Reach for an arbitrary value like
`p-[13px]` only when no step fits, and say why in a comment.

## States - every interactive element needs all of them

Default, hover, focus, active, disabled, loading, and where the data can be
absent: empty and error. The project has parts for most of them:

- Loading on a button: `<Button busy>` swaps in the spinning shamseh and disables
  the button **without collapsing its width**.
- Empty: `<EmptyState title hint>` with optional action children.
- Error / pending / success: the toast queue (`lib/toast.ts`), driven by `sendTx`.
- Skeleton: `ui/skeleton.component.azeroth`.

Focus is already handled globally - `:focus-visible` paints a 2px `--ice` outline
with a 2px offset in `@layer base`. Do not remove it, and do not add
`outline-none` without replacing it with something at least as visible.

## Hard rules

1. No new UI framework, component library, or CSS-in-JS. Tailwind v4 + the
   classes above is the system.
2. No `tailwind.config.js`. Tokens go in `@theme inline` in `styles.css`.
3. No hex colours in components. Add a token first if one is genuinely missing.
4. ARIA state attributes are **strings**: `aria-pressed={ String(active) }`,
   not `aria-pressed={ active }` - a boolean renders as `aria-pressed=""`, which
   tells a screen reader nothing.
5. Physical direction utilities are banned; see the `rtl-bidi-ui` skill.
6. Run `npm run lint:rtl` and `npx azeroth check` before you call a UI change done.
