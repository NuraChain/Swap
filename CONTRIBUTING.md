# Contributing

## Setup

Node >= 24. `npm install` at the root wires all three workspaces
(`application`, `server`, `shared`). This repo targets ONE chain - Nura Chain
(id 1020) - and its deployment artifact is committed at
`shared/deployments/1020.json`, so nothing needs deploying to run the app: the
server indexes the public RPC and the browser reads the same chain directly.
The exchange contracts live in their own repository; you only need it checked
out to deploy new contracts, which rewrites that artifact. There is no in-app
signer - wallet flows are exercised with a real wallet extension against Nura
Chain, so an address with a little NURA for gas is the price of testing them.

## Before you open a PR

Run the same gates CI runs:

```sh
npx azeroth check                 # types + lint, both app halves
npx azeroth test                  # server + application suites
npm test --workspace shared
npx azeroth build                 # client, SSR bundle, prerender
```

## Ground rules

- The ABI fragments in `application/src/lib/chain.ts` and
  `server/src/indexer/decode.ts` are hand-declared, not generated from build
  output - that is what keeps this repo free of a Solidity toolchain. Change one
  only to match a deployed contract, and keep both sides in step.
- The deployment artifact is the only contract-side input: its shape is pinned by
  `shared/src/deployments.ts` and validated by `server/src/schemas.ts`. Contract
  changes reach this repo as a new artifact, never as an import.
- Every user-facing string goes through the typed dictionaries in
  `application/src/lib/locales/`, in ALL TEN languages - `en.ts` is the source of
  truth and every other locale is typed `Dict`, so a missing key anywhere is a
  compile error by design. Adding a language: write `locales/<code>.ts`, add its
  row to `LANGS` in `src/lib/i18n.ts`, add its flag to `FLAGS` in
  `scripts/build-flags.mjs`, and extend the language regex in the pre-paint
  script in `index.html` (which then needs a new `THEME_SCRIPT_HASH` - the CSP
  spec prints the value).
- RTL: logical utilities only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`);
  numbers, addresses, and charts sit in `data-ltr` islands.
- On-chain amounts are bigint end to end; raw amounts never pass through
  `Number` (see `shared/src/math.ts`).
- New UI takes its parts from `application/src/components/ui/` before inventing
  local ones.

## Icon, coin and flag sprites

`application/scripts/build-icons.mjs`, `build-coins.mjs`, `build-wallets.mjs` and
`build-flags.mjs` generate `public/icons.svg`, `public/coins.svg`,
`public/wallets/*.svg` and `public/flags/*.svg` from lucide-static,
cryptocurrency-icons, @web3icons/core and flag-icons. Edit the lists there and
rerun; the outputs are committed so the app needs no CDN and the CSP stays closed.

Flag codes are ISO 3166-1 alpha-2 COUNTRIES, and the country-to-language pairing
is editorial - the flag is a recognition aid next to the endonym, never the label
itself.

Adding a wallet to the connect roster: append it to `WALLET_BRANDS` in
`application/src/lib/wallet/brands.ts` with its EIP-6963 rdns and install URL. If
we do not ship its official vector, set `icon: null` - a neutral glyph is correct,
lending it another brand's logo is not.
