# AzerothJS Usage Skill

## Purpose

Use this skill whenever you create, edit, review, or debug code that uses AzerothJS in this repository.

This project uses **AzerothJS 2** with `.azeroth` single-file components, Vite, TypeScript, and TailwindCSS. It is **not React** and must not be treated like React.

The goal is to use AzerothJS idiomatically, preserve its fine-grained reactivity, remain SSR-safe, and follow the patterns already established in this repository.

---

## 1. Component Model

AzerothJS components live in `.azeroth` files.

Basic shape:

```azeroth
export default component Counter(props: { start?: number })
{
    state count = props.start ?? 0;
    derived doubled = count * 2;

    <button onClick={ () => count++ }>
        { doubled }
    </button>
}
```

A component body is JavaScript/TypeScript plus reactive declarations and markup. The final expression is the rendered markup.

Do not introduce:

- React
- JSX
- React hooks
- `useState`
- `useEffect`
- `useMemo`
- `useCallback`
- a second UI framework

Use AzerothJS language features instead.

---

## 2. Reactive State

### Local state

Use `state` for mutable component-local state.

```azeroth
state amount = 0;
state open = false;
state selected: TokenRef | null = null;
```

Update state directly:

```azeroth
<button onClick={ () => open = true }>
...
</button>
```

Do not create a separate setter pair for component-local state.

### Derived values

Use `derived` for values that can be calculated from other reactive values.

```azeroth
state price = 10;
state quantity = 3;

derived total = price * quantity;
```

Prefer:

```azeroth
derived canSubmit = amount > 0n && account() !== null;
```

over maintaining a second piece of state such as `canSubmit`.

Derived values should stay pure. Do not use them for side effects.

---

## 3. Effects

Use `effect` for side effects.

### Auto-tracked effect

```azeroth
effect
{
    document.title = title;
}
```

### Explicit dependencies

Prefer explicit dependencies when the dependency set is clear:

```azeroth
effect (slippageBps, deadlineMinutes)
{
    saveSettings(slippageBps, deadlineMinutes);
}
```

This repository also uses:

```azeroth
effect (value) with { skipInitial: true }
{
    persist(value);
}
```

Use effects for:

- subscriptions
- timers
- persistence
- DOM effects
- network-triggering reactions
- synchronizing an external system

Do not use an effect just to calculate another value. Use `derived`.

### Important async rule

Reactive dependency tracking does not make an `await` continuation equivalent to the original tracked scope.

Capture the reactive values before asynchronous work:

```azeroth
effect (tokenIn, tokenOut)
{
    const currentIn = tokenIn;
    const currentOut = tokenOut;

    void (async () =>
    {
        const result = await loadPair(currentIn, currentOut);
        // ...
    })();
}
```

This pattern is already used by the trading pages.

---

## 4. Batch Updates

Use `batch { ... }` when several related reactive writes must appear as one state transition.

```azeroth
batch
{
    tokenIn = nextIn;
    tokenOut = nextOut;
    amountText = '';
}
```

This is especially important when intermediate state would be invalid or would trigger expensive work.

In this project, batching is used for operations such as:

- flipping swap tokens
- updating multiple related UI settings
- changing coordinated state

---

## 5. Lifecycle

### `mount`

Use `mount { ... }` for browser-only work.

Good uses:

- `window`
- `document`
- `localStorage`
- timers
- DOM listeners
- wallet discovery
- browser APIs

Example:

```azeroth
mount
{
    const onVisibility = () => { ... };

    document.addEventListener('visibilitychange', onVisibility);

    cleanup
    {
        document.removeEventListener('visibilitychange', onVisibility);
    }
}
```

Do not access browser-only globals at module scope when a page can be rendered or imported on the server.

### `cleanup`

Every long-lived resource created by a component must have a cleanup path:

- `setInterval`
- `setTimeout`
- `addEventListener`
- subscriptions
- observers
- sockets
- external resources

Use the component `cleanup { ... }` block or the cleanup mechanism appropriate to the primitive being used.

---

## 6. Built-in Control Flow

Use AzerothJS control-flow components instead of manually rebuilding conditional rendering.

### Show

```azeroth
<Show when={ connected } fallback={ <ConnectPrompt /> }>
    <WalletPanel />
</Show>
```

### For

```azeroth
<For each={ tokens } key={ token.address } let={ token }>
    <TokenRow token={ token } />
</For>
```

Keep conditional rendering declarative.

For list rendering, use a stable key whenever identity matters.

---

## 7. Components and Props

Use typed props.

```azeroth
export default component Button(props: {
    variant?: ButtonVariant;
    disabled?: boolean;
    busy?: boolean;
    children?: Child;
})
{
    ...
}
```

For reusable children, import the `Child` type:

```ts
import type { Child } from 'azerothjs';
```

Prefer small composable components over large components containing unrelated concerns.

Before creating a component in this repository:

1. Find the nearest existing component.
2. Reuse it if possible.
3. Extend it with an optional prop when practical.
4. Create a new component only when reuse is genuinely wrong.

This repository already has shared UI components for buttons, inputs, modals, tooltips, token selectors, wallet controls, loading states, and similar patterns.

---

## 8. Markup and Events

Use normal HTML semantics with AzerothJS bindings.

Examples:

```azeroth
<input
    value={ amountText }
    onInput={ (event) => amountText = event.currentTarget.value }
/>

<button
    disabled={ busy }
    onClick={ submit }
>
    Submit
</button>
```

Prefer native HTML elements over unnecessary abstractions.

Do not add ARIA merely to satisfy a checker. Use semantic HTML first.

For accessibility state, this project uses string values where required:

```azeroth
aria-pressed={ String(active) }
```

Icon-only controls need an accessible label.

---

## 9. Portals

Use `Portal` for UI that must escape local stacking contexts.

Examples in this project:

- modals
- tooltips
- overlays

```azeroth
import { Portal } from 'azerothjs';

<Portal>
    <div class="fixed inset-0">
        ...
    </div>
</Portal>
```

Do not duplicate overlay markup just to solve z-index or stacking-context problems.

---

## 10. Reactive State in TypeScript

For shared state outside a component, use AzerothJS reactive primitives.

```ts
import { createSignal } from 'azerothjs';

const [accountSignal, setAccount] = createSignal<Address | null>(null);

export const account = accountSignal;
```

This is the pattern used by the wallet store, theme state, toast state, chain/deployment state, and other shared modules.

For effects in normal TypeScript, use the runtime primitive:

```ts
import { createEffect, onCleanup } from 'azerothjs';
```

Use `createSignal` for shared reactive state; do not invent an unrelated global store unless the existing architecture requires it.

---

## 11. Routing

AzerothJS routing is data-driven.

The project keeps one route table in `application/src/routes.ts`:

```ts
import type { PageRoute } from '@azerothjs/kit';

export const routes: PageRoute[] = [
    { path: '/', component: Landing, render: 'static' },
    { path: '/swap', lazy: () => import('./pages/swap.azeroth'), render: 'client' }
];
```

The same route definition is shared by the application routing and server/SSR integration.

Use:

```ts
import { RouterProvider, Routes, createRouter } from 'azerothjs';
```

and:

```azeroth
<RouterProvider router={ router }>
    <Routes fallback={ ... } />
</RouterProvider>
```

Use the appropriate router helpers such as:

- `useQuery()`
- `useNavigate()`
- `useRoute()`
- `useParams()`

Do not create a second routing system beside the repository route table.

---

## 12. Lazy Routes and Rendering Mode

Choose the route rendering mode based on the page's requirements.

Project pattern:

- static content -> `render: 'static'`
- wallet/live-chain pages -> `render: 'client'`
- server-required pages -> use the server rendering mode when justified

Trading pages in this project are lazy because they depend on wallet and live chain state.

Keep trading functionality out of the initial static bundle unless there is a concrete reason to load it immediately.

---

## 13. SSR Safety

This project prerenders and evaluates page modules outside the browser.

Therefore module-scope code must be safe without:

- `window`
- `document`
- `localStorage`
- injected wallet providers
- other browser-only globals

Bad:

```ts
const saved = localStorage.getItem('key');
```

Good:

```ts
mount
{
    const saved = window.localStorage.getItem('key');
}
```

or guard the access explicitly when the module truly needs to support both environments.

Also avoid starting network polling, wallet discovery, or other browser activity at import time.

---

## 14. Async and Stale Work

A reactive effect can start more than one asynchronous operation.

When old results must not overwrite newer state, use a generation/token check.

Project pattern:

```ts
let lookupGeneration = 0;

effect (tokenIn, tokenOut)
{
    lookupGeneration++;
    const generation = lookupGeneration;

    void (async () =>
    {
        const result = await findPool();

        if (generation !== lookupGeneration)
        {
            return;
        }

        applyResult(result);
    })();
}
```

Use this for:

- pool discovery
- quotes
- search requests
- rapidly changing inputs
- route-dependent async lookups

---

## 15. API Usage in This Project

The server API is declared once and consumed through AzerothJS HTTP tooling.

Client code uses the shared manifest/client:

```ts
import { createClient, readManifest } from '@azerothjs/http/api/shared';
```

The project creates:

```ts
createClient<Api>(manifest, { baseUrl: '/api' })
```

Prefer the existing typed API client over handwritten `fetch()` calls for endpoints already exposed by the project API.

The server uses `@azerothjs/http` and `@azerothjs/schema` for the HTTP boundary and validation.

Keep external wire data schema-validated and preserve bigint-safe values as strings at the API boundary where the existing schema requires it.

---

## 16. Existing Nura Swap Patterns to Follow

When working on this repository, these patterns are intentional:

### Deployment state

Use the shared deployment signal and `ensureDeployment()`.

Do not duplicate chain configuration in each page.

### Wallet state

Use the existing wallet store.

The store already handles:

- EIP-6963 discovery
- connection state
- account changes
- chain changes
- balances
- transaction state
- polling
- transaction toasts

Do not create a second wallet state system in a page.

### Refreshes

Wallet balances use receipt-driven refreshes plus a visible-tab timer.

Do not introduce per-block UI polling just because blocks exist.

### Transactions

Use the existing transaction wrapper (`sendTx`) instead of reimplementing:

- pending state
- receipt waiting
- success/failure handling
- explorer links
- balance refresh
- transaction epoch updates

### Shared UI

Use existing UI components before writing raw equivalents.

---

## 17. Testing

Use the repository's existing AzerothJS testing stack.

Component tests use:

```ts
renderTest(...)
```

and event helpers such as `fire()`.

The project uses Vitest and does not enable Vitest globals.

For component tests:

- clean up mounted components
- clean up portals
- wait for the next macrotask after reactive writes when necessary
- test loading, error, empty, success, and interaction states

Do not introduce another test runner.

---

## 18. Common Mistakes

### Do not write React-style components

Wrong:

```ts
function Swap() {
    const [amount, setAmount] = useState('');
}
```

Right:

```azeroth
export default component Swap()
{
    state amount = '';
    ...
}
```

### Do not duplicate derived state

Wrong:

```azeroth
state total = 0;
effect (price, quantity)
{
    total = price * quantity;
}
```

Right:

```azeroth
derived total = price * quantity;
```

### Do not touch browser APIs at module scope

Wrong:

```ts
const theme = localStorage.getItem('theme');
```

Right:

```azeroth
mount
{
    theme = window.localStorage.getItem('theme') ?? 'system';
}
```

### Do not leak listeners or timers

Every subscription needs cleanup.

### Do not create a second router

Use `application/src/routes.ts`.

### Do not create a second global state library

Use AzerothJS signals and the repository's existing stores.

### Do not let async stale results overwrite current state

Capture inputs and guard the result with a generation/token when requests can overlap.

### Do not use effects for pure calculations

Use `derived`.

### Do not use raw `fetch()` where the typed API client already exists

Use the existing API contract.

---

## 19. Style and Repository Rules

AzerothJS usage is coupled to the existing project conventions.

Remember:

- `.azeroth` for components
- TypeScript for supporting logic
- four-space indentation
- Allman braces
- single quotes
- explicit types where the repository expects them
- TailwindCSS 4 in CSS-first mode
- no React
- no JSX
- no second component framework
- no new state library without architectural justification

For visual work, read the repository's design-system skill before changing UI.

For RTL UI, follow the repository's logical-direction rules rather than physical left/right utilities.

---

## 20. Preferred Decision Order

When implementing a feature:

1. Check whether existing AzerothJS state/components already solve it.
2. Use `state` for local mutable state.
3. Use `derived` for calculations.
4. Use `effect` for side effects.
5. Use `batch` for coordinated writes.
6. Use `mount` for browser-only lifecycle work.
7. Add cleanup for every long-lived resource.
8. Reuse the existing route/API/wallet/store architecture.
9. Guard async results against stale work.
10. Keep SSR safety intact.

When uncertain, inspect the nearest existing implementation in this repository and follow its established AzerothJS pattern before inventing a new abstraction.

---

## References

- Project implementation: NuraChain/Swap
- AzerothJS: https://github.com/AzerothJS/AzerothJS
- AzerothJS runtime package: https://github.com/AzerothJS/AzerothJS/tree/main/packages/azerothjs
- AzerothJS router documentation: https://github.com/AzerothJS/AzerothJS/blob/main/packages/azerothjs/docs/router.md
- AzerothJS compiler documentation: https://github.com/AzerothJS/AzerothJS/tree/main/packages/compiler
