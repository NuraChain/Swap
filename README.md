<div align="center">

# Nura Swap

**An open automated market maker. Your keys, your trades.**

Swap tokens, provide liquidity, and track your portfolio on a UniswapV2-class AMM -
self-custody end to end, in ten languages with first-class RTL, dark and light
themes.

[![Built with AzerothJS](https://img.shields.io/badge/built%20with-AzerothJS-5fb3e8)](https://github.com/AzerothJS/AzerothJS)
[![Node >= 24](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](#license)
[![Version 1.1.0](https://img.shields.io/badge/version-1.1.0-5fb3e8)](CHANGELOG.md)

</div>

---

## What this is

The application half of a production-shaped DEX - the exchange contracts live in
their own repository:

- **Swap** - router-quoted trades with live price impact, slippage and deadline
  control, an approve-then-swap flow, NURA wrap/unwrap, a price chart, and recent
  trades. High-impact trades demand explicit confirmation. A **V2/V3 switch** sits
  in the card header where the chain carries both: V3 quotes every fee tier
  through the Quoter, trades the best by default, and lets a trader pin one.
- **Liquidity** - pools table (TVL, 24h volume, fee APR), your positions, add
  liquidity with ratio auto-fill and a first-provider price warning, remove with
  a percent slider. Every flow shows a summary before the wallet prompt. The same
  switch turns the page over to **V3**: pools per fee tier, position NFTs with
  their price range and in/out-of-range state, mint with a range (or full range),
  add to a position, withdraw from one, and collect its fees.
- **Portfolio** - holdings with USD values, LP positions, and your own on-chain
  activity.
- **Wallets** - every EIP-6963 injected wallet (MetaMask, Rabby, Trust, ...),
  silent session restore, address identicons.
- **The exchange itself** - UniswapV2 core and periphery, and optionally
  UniswapV3 alongside it, with the audited math
  untouched, save for one deliberate change: the swap fee is a factory parameter
  in basis points (`swapFee`, retunable by `feeToSetter` up to `MAX_SWAP_FEE`)
  instead of the hardcoded 997/1000. Nothing in this repo assumes a fee - the
  server reads it at boot, serves it on `/api/market/stats`, and the swap card
  prints what the factory says. It lives in the **contracts repository**; this
  repo consumes its deployment artifact.

## Architecture

```
shared/        bigint AMM math (V2 reserves and V3 Q64.96 ticks), digit normalization,
               typed deployment artifacts
server/        indexer + market API: chain watcher -> sqlite -> REST (@azerothjs/http)
application/   the site: compiled .azeroth components on vite (AzerothJS)
```

The exchange runs on **Nura Chain** (chain id 1020, Cosmos EVM):

| | |
| --- | --- |
| RPC | `https://rpc.nurachain.net` |
| Explorer | `https://explorer.nurachain.net` |
| Native coin | NURA (18 decimals), wrapped as WNURA |

The seam with the contracts repository is one file: its deploy script writes a
typed artifact (chain id, RPC, factory/router/WNURA/multicall addresses, token
list, start block) that this repo reads from `shared/deployments/1020.json`
via `shared/src/deployments.ts`. UniswapV3 is an OPTIONAL `v3` block in that same
artifact (factory, swapRouter, quoter, positionManager, tickLens); an artifact
written before V3 existed stays valid unedited, the API serves `v3: null`, and
the app hides its V3 half rather than pointing it at a zero address. Nothing here imports Solidity or an ABI built
from it - the ABI fragments the app and indexer need are declared inline
(`application/src/lib/chain.ts`, `server/src/indexer/decode.ts`).

The V3 half is read entirely in the browser - `factory.getPool`, `slot0`, the
Quoter, and the position manager, over multicall3. The indexer does not follow V3
events, so V3 pools show their live price and what they hold, and say so where a
V2 pool would show 24h volume and fee APR. Two contract flavours are probed
rather than assumed: Quoter vs QuoterV2, and SwapRouter vs SwapRouter02.

The server tails the chain (`PairCreated`, `Sync`, `Swap`, `Mint`, `Burn`),
survives chain resets via a chain-identity guard, and serves `/api/market/*`
(stats, pools, candles, tokens with USD prices, transactions, the active
deployment). The browser reads quotes and balances straight from the chain and
signs with the user's wallet - the site never holds funds or keys.

## How to run

### Prerequisites

- Node.js >= 24 (`node --version`)
- A browser wallet extension for the trading flows -
  [MetaMask](https://metamask.io/download/) or any EIP-6963 wallet
- An address holding a little NURA for gas, to sign anything

Nothing else: the deployment artifact for Nura Chain is committed, so there is
no chain to start and no contract to deploy before the app runs.

### Development

Two processes, one terminal each:

```sh
npm install                          # once, at the repository root

# terminal 1 - the indexer + API on :3000 (in server/)
node src/main.ts

# terminal 2 - the app on :4001 (in application/)
npm run dev
```

The server reads `shared/deployments/1020.json`, indexes Nura Chain from the
factory's deployment block, and exits with "no deployment artifact for this
chain" if `CHAIN_ID` names a chain with no artifact next to it.

| Port | What |
| --- | --- |
| 3000 | indexer + `/api/market/*` |
| 4001 | the app (vite, proxies `/api` to 3000) |

The chain itself is remote - `https://rpc.nurachain.net`, read by both the
indexer and the browser.

### Production build

```sh
npx azeroth build                    # client + SSR bundle + prerendered landing
cd server && NODE_ENV=production node src/main.ts
```

One origin serves everything on :3000 - pages, API, and the strict CSP.
`CHAIN_ID` picks the deployment artifact and defaults to 1020. The VPS story
(Caddy, systemd, `deploy/deploy.sh`) is further down.

Open http://localhost:4001 and connect a real wallet extension - there is no
built-in signer, on purpose. The full walkthrough:

1. Install [MetaMask](https://metamask.io/download/) (or any EIP-6963 wallet -
   the connect sheet lists the ones we can name, with install links).
2. Click "Connect wallet" and pick your wallet. The "Add Nura Chain to wallet"
   button in the header registers the network (chain id 1020, the RPC and
   explorer above) in one prompt - the app never switches your wallet behind
   your back.
3. Hold some NURA in that address: every transaction pays gas in it, and a
   fresh account has none. This chain has no faucet in the app (`faucet` is
   false in the artifact); fund the address the way you fund any real chain.
4. Swap, add liquidity, remove it - every flow runs against your own wallet.

## Tests

| Suite | Where | Runs |
| --- | --- | --- |
| Shared math | `shared/` | `npm test` - V2 quote/impact/decimals math, V3 tick and liquidity math, Persian digit normalization |
| Server | `server/` | `npm test` - indexer core, candles, API via `app.handle()` |
| Application | `application/` | `npm test` - render tests, the V3 calldata builders, and the SSR-safety import gate |

The contract suite (init-hash proof, LP mint/burn, swap math, guard reverts) runs
in the contracts repository.

`npm test` at the root runs all three suites, and each has its own entry point
(`npm run test:shared`, `test:server`, `test:web`). `npm run coverage` measures
all three. `npm run verify` is the full gate - RTL lint, types and lint, build,
then every test - and is what CI runs:

```sh
npm run verify
```

The suites need nothing running: no chain, no database, no network. The indexer
tests drive a scripted EVM (`server/tests/fake-chain.ts`) that encodes real logs
for the real decoder, the databases are `:memory:`, and the clock is frozen where
timing matters. [TESTING.md](TESTING.md) maps every spec file to what it defends
and explains how to add one.

`npx azeroth check` alone runs the type and lint gates for both app halves;
`npx azeroth build` produces the client bundle, the SSR bundle, and the
prerendered landing page.

## Redeploying the exchange

The addresses in `shared/deployments/1020.json` are the live ones; you only redo
this if the contracts themselves change. In the contracts repository:

```sh
cp .env.example .env            # set DEPLOYER_PRIVATE_KEY (funded with NURA)
npm run deploy -- --network nura
```

Commit the artifact it writes over `shared/deployments/1020.json` - addresses,
`startBlock`, and the token list in one file. Wipe the indexer database for that
chain (`data/1020.db`) so it re-indexes against the new factory, or let the
chain-identity guard notice the mismatch and do it for you. The frontend needs
no configuration either way: it receives the active deployment from the server.

## Deploy: production (VPS)

Production is ONE origin: the server serves the API, the SSR pages, and the
built client. No CORS, no separate static host.

```sh
npx azeroth build                                  # client + SSR bundle + prerender
cd server
NODE_ENV=production CHAIN_ID=1020 DATA_DIR=/var/lib/nuraswap node src/main.ts
```

`deploy/nuraswap.service` runs that same command under systemd, and
`deploy/deploy.sh` ships a build to the box. `scripts/service-install.sh` is the
same unit generated for wherever the repo actually sits - it resolves the node
binary and the paths itself, then `scripts/service-{start,stop,restart,status}.sh`
drive it. Both install one unit named `nuraswap`; the checked-in file is the
hardened, fixed-path version, the generator is the portable one.

Put a TLS reverse proxy in front (Caddy shown; nginx works the same way):

```
nuraswap.example {
    reverse_proxy 127.0.0.1:3000
}
```

Set `TRUST_PROXY=true` whenever something is in front. The rate limiter buckets
per client address, and behind a proxy every request arrives from the proxy - so
without this the 2000/min budget is ONE bucket shared by every visitor, which any
single client can exhaust for everybody. Leave it `false` when the server is
exposed directly: there the forwarded header is client-supplied fiction.

`/api/healthz` answers orchestrator probes. `/api/market/stats` reports
`blocksBehind` - alert when it grows. Nura Chain is CometBFT under the EVM, so a
committed block is final: the indexer waits zero confirmations and a growing
`blocksBehind` means the RPC or the loop is unwell, never a fork. Note that these
are pooled-funds contracts on a live chain - do not put them in front of users'
money without an independent audit.

## Security posture

- The AMM is the canonical UniswapV2 source, vendored verbatim with pinned
  compilers; the only functional edit is the regenerated init-code hash, proven
  by a CREATE2 test on every run.
- Slippage and deadline bounds are enforced by the router contract, not the UI.
- There is no in-app signer of any kind: every transaction is signed by the
  user's own wallet extension, in development and production alike.
- The site is a stateless window onto the contracts: no accounts, no sessions,
  no custody.
- Coin brands are a trust signal and are earned by **address** from the served
  deployment, never by the symbol a token declares. An imported token claiming
  to be `USDT` gets the generic monogram and an explicit warning - it can never
  borrow the real mark. Pinned by `application/tests/token-trust.spec.ts`.
- Production responses carry a strict CSP (`server/src/csp.ts`): no
  `unsafe-inline` or `unsafe-eval` for scripts, `object-src`/`frame-ancestors`
  denied, and `connect-src` derived from the active deployment so the chain RPC
  is reachable without widening the policy by hand. The one inline script - the
  pre-paint theme setter - is allowed by SHA-256 hash, and a test recomputes that
  hash from the built HTML so it cannot drift silently.

## Changelog

Every notable change is in [CHANGELOG.md](CHANGELOG.md); the current release
is 1.0.0.

## License

[MIT](LICENSE) - `application/`, `server/`, `shared/`.

The exchange contracts are licensed separately (GPL-3.0, required by the
vendored Uniswap V2 sources) in the contracts repository, alongside their
provenance notes.

---

<div align="center">

[Built with AzerothJS](https://github.com/AzerothJS/AzerothJS)

</div>
