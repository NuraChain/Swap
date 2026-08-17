# Contributing

## Setup

Node >= 24. `npm install` at the root wires all three workspaces
(`application`, `server`, `shared`). The exchange contracts live in their own
repository - you need it checked out to run the local chain and produce the
deployment artifact this repo reads from `shared/deployments/<chainId>.json`.
The full local loop is in the README's Quickstart. There is no in-app signer:
wallet flows are exercised with a real wallet extension against the local chain -
`npm run fund -- 0xYourAddress` (contracts repo) funds your own MetaMask address
with local BNB and tokens.

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
- Every user-facing string goes through the typed dictionary in
  `application/src/lib/i18n.ts`, in BOTH languages - a missing Persian key is a
  compile error by design.
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
cryptocurrency-icons, @web3icons/core and circle-flags. Edit the lists there and
rerun; the outputs are committed so the app needs no CDN and the CSP stays closed.

Flag codes are ISO 3166-1 alpha-2 COUNTRIES, and the country-to-language pairing
is editorial - the flag is a recognition aid next to the endonym, never the label
itself.

Adding a wallet to the connect roster: append it to `WALLET_BRANDS` in
`application/src/lib/wallet/brands.ts` with its EIP-6963 rdns and install URL. If
we do not ship its official vector, set `icon: null` - a neutral glyph is correct,
lending it another brand's logo is not.
