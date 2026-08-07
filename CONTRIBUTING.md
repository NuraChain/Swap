# Contributing

## Setup

Node >= 24. `npm install` at the root wires all four workspaces
(`application`, `server`, `contracts`, `shared`). The full local loop is in the
README's Quickstart. There is no in-app signer: wallet flows are exercised with
a real wallet extension against the local chain - `npm run fund -- 0xYourAddress`
(contracts workspace) funds your own MetaMask address with local BNB and tokens.

## Before you open a PR

Run the same gates CI runs:

```sh
npx azeroth check                 # types + lint, both app halves
npx azeroth test                  # server + application suites
npm test --workspace shared
cd contracts && npx hardhat test
npx azeroth build                 # client, SSR bundle, prerender
```

## Ground rules

- The vendored UniswapV2 sources under `contracts/contracts/{core,periphery}`
  are not edited - ever. The one sanctioned change (the init-code hash) is
  written by `contracts/scripts/write-init-code-hash.ts`. Provenance lives in
  `contracts/VENDORED.md`.
- Every user-facing string goes through the typed dictionary in
  `application/src/lib/i18n.ts`, in BOTH languages - a missing Persian key is a
  compile error by design.
- RTL: logical utilities only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`);
  numbers, addresses, and charts sit in `data-ltr` islands.
- On-chain amounts are bigint end to end; raw amounts never pass through
  `Number` (see `shared/src/math.ts`).
- New UI takes its parts from `application/src/components/ui/` before inventing
  local ones.

## Icon and coin sprites

`application/scripts/build-icons.mjs`, `build-coins.mjs` and `build-wallets.mjs`
generate `public/icons.svg`, `public/coins.svg` and `public/wallets/*.svg` from
lucide-static, cryptocurrency-icons and @web3icons/core. Edit the lists there and
rerun; the outputs are committed so the app needs no CDN and the CSP stays closed.

Adding a wallet to the connect roster: append it to `WALLET_BRANDS` in
`application/src/lib/wallet/brands.ts` with its EIP-6963 rdns and install URL. If
we do not ship its official vector, set `icon: null` - a neutral glyph is correct,
lending it another brand's logo is not.
