# Testing

Three suites, one runner. Everything is [vitest](https://vitest.dev); there is no
second framework to learn and nothing to start before running them - no database
to provision, no chain to boot, no network at all.

```sh
npm test              # every suite (server + application via azeroth, then shared)
npm run verify        # the full gate CI runs: rtl lint, types, lint, build, tests
```

## One suite at a time

| Command | Suite | What it covers |
| --- | --- | --- |
| `npm run test:shared` | `shared/` | AMM maths, V3 tick and liquidity maths, digit normalization, the deployment artifacts, and the property/fuzz laws over all of it |
| `npm run test:server` | `server/` | the indexer end to end, the SQLite data layer, USD pricing, token metadata, the market API, and the production HTTP edge |
| `npm run test:web` | `application/` | chain access, i18n, formatting, the V3 client, components, and page-level journeys |

Add `-- <pattern>` to narrow, and `-- -t "<name>"` to run one test:

```sh
npm run test:server -- tests/live.spec.ts
npm run test:web -- -t "leaks no unhandled rejection"
```

## Coverage

```sh
npm run coverage      # all three suites; per-workspace HTML in <workspace>/coverage
```

Each workspace measures `src/` only. `server/src/main.ts` is excluded on purpose:
it is a boot script, not a module - importing it starts an indexer, opens a
database and binds a port. What it composes is covered through
`server/tests/pipeline.spec.ts`, which assembles the same pipeline by hand.

The application figure is the lowest of the three and always will be: a large
share of the page components is wallet-signing flow, unreachable without a wallet
extension driving it. The calldata those flows produce is covered separately and
exactly, in `application/tests/v3.spec.ts`.

## What lives where

```
shared/tests/
  math.spec.ts          V2 quote, impact, slippage, decimal scaling
  v3-math.spec.ts       tick <-> price, range amounts, liquidity round trips
  digits.spec.ts        Persian and Arabic numerals in, ASCII amounts out
  deployments.spec.ts   the committed artifacts, validated field by field
  properties.spec.ts    seeded property and fuzz laws over all three libraries

server/tests/
  db.spec.ts            inserts, constraints, bigint fidelity, injection-proof binding
  indexer.spec.ts       log decoding (plus fuzz), event application, candles
  live.spec.ts          the indexer's restart, reorg and failure paths, end to end
  pricing.spec.ts       USD derivation, TVL, volume, fee APR
  erc20.spec.ts         token metadata, including the shapes that answer nothing
  app.spec.ts           every market API route: shape, status, and hostile input
  pipeline.spec.ts      security headers, CSP, and rate limiting as production wires them
  csp.spec.ts           the policy itself, and the inline script hash it pins
  fake-chain.ts         the scriptable EVM the indexer tests run against

application/tests/
  chain.spec.ts         deployment loading, ABI fragments, explorer links
  v3.spec.ts            the V3 calldata builders, decoded and checked
  v3-client.spec.ts     pool discovery, the Quoter and SwapRouter probes, positions
  i18n.spec.ts          ten dictionaries, one shape; flags, direction, numerals
  format.spec.ts        every number and address a person reads
  theme.spec.ts         the stored preference, including when storage throws
  toast.spec.ts         the transaction queue, on a frozen clock
  components.spec.ts    controls: mount, click, type, assert
  pages.spec.ts         page journeys against a stubbed API, outage states included
  pages-v3.spec.ts      the same pages on a chain that carries V3
  token-trust.spec.ts   a coin brand is earned by address, never by symbol
  tx-errors.spec.ts     revert strings a trader has to be told correctly
  app.spec.ts           routing and the not-found fallback
  ssr-safety.spec.ts    the whole page graph imports without a DOM
```

## Determinism

Nothing here touches the network, the clock, or the developer's machine.

- **No chain.** `server/tests/fake-chain.ts` encodes real logs with viem and hands
  them to the real decoder; only the transport is replaced. The application tests
  mock `publicClient` the same way. A test that resolved DNS would be a test that
  fails on a plane.
- **No sleeps.** The indexer's polling loop runs on vitest's fake timers, advanced
  a poll at a time until the asserted state arrives or a bounded budget expires.
  The toast queue is tested the same way.
- **No random seeds.** The fuzz and property suites use a seeded generator, so a
  failure reproduces from the seed printed in the message.
- **No shared state.** Every database is `:memory:` and closed in `afterEach`;
  every mounted component is unmounted; module-level caches (the deployment
  promise, the V3 flavour probes, the theme's storage read) are isolated by
  re-importing the module under test.

## Adding a test

Match the suite's conventions rather than importing new machinery:

- Put pure logic in `shared/` and test it there - it needs no environment.
- Server behaviour goes through `app.handle(new Request(...))` or a real
  `IndexerDb(':memory:')`; neither needs a socket or a file.
- Component behaviour goes through `renderTest` from `@azerothjs/testing`, with
  `fire()` for events. Vitest globals are off in this project, so register
  `afterEach(cleanup)` yourself - without it a portaled modal survives into the
  next test.
- Reactive writes land on the next macrotask, so assert after awaiting one.
