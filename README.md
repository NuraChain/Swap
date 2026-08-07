<div align="center">

# NuraSwap

**An open automated market maker. Your keys, your trades.**

Swap tokens, provide liquidity, and track your portfolio on a UniswapV2-class AMM -
self-custody end to end, bilingual (English / فارسی) with first-class RTL, dark and
light themes.

<div dir="rtl">

**نوراسواپ - بازارساز خودکار متن‌باز. کلیدها و معامله‌ها از آنِ شما.**

مبادله توکن، تأمین نقدینگی و پیگیری دارایی‌ها روی یک AMM از خانواده UniswapV2؛
امانت‌داری کاملاً شخصی، دوزبانه با پشتیبانی کامل راست‌به‌چپ و دو پوسته تیره و روشن.

</div>

[![Built with AzerothJS](https://img.shields.io/badge/built%20with-AzerothJS-5fb3e8)](https://github.com/AzerothJS/AzerothJS)
[![Node >= 24](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![License: MIT + GPL-3.0](https://img.shields.io/badge/license-MIT%20%2B%20GPL--3.0-blue)](#license)

</div>

---

## What this is

A complete, production-shaped DEX in one repository:

- **Swap** - router-quoted trades with live price impact, slippage and deadline
  control, an approve-then-swap flow, BNB wrap/unwrap, a price chart, and recent
  trades. High-impact trades demand explicit confirmation.
- **Liquidity** - pools table (TVL, 24h volume, fee APR), your positions, add
  liquidity with ratio auto-fill and a first-provider price warning, remove with
  a percent slider. Every flow shows a summary before the wallet prompt.
- **Portfolio** - holdings with USD values, LP positions, and your own on-chain
  activity.
- **Wallets** - every EIP-6963 injected wallet (MetaMask, Rabby, Trust, ...),
  silent session restore, address identicons.
- **The exchange itself** - the canonical UniswapV2 core and periphery, vendored
  verbatim (0.30% fee, audited math untouched) with the pair init-code hash
  regenerated for this build and proven by tests.

## Architecture

```
contracts/     the exchange: vendored UniswapV2 + NURA/mock tokens (Hardhat + viem)
shared/        bigint AMM math, digit normalization, typed deployment artifacts
server/        indexer + market API: chain watcher -> sqlite -> REST (@azerothjs/http)
application/   the site: compiled .azeroth components on vite (AzerothJS)
```

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

### Development (local chain)

Four processes, one terminal each, in this order:

```sh
npm install                          # once, at the repository root

# terminal 1 - the chain (keep it running)
cd contracts && npx hardhat node

# terminal 2 - deploy + seed the exchange (in contracts/)
npm run deploy:local && npm run seed:local

# terminal 3 - the indexer + API on :3000 (in server/)
node src/main.ts

# terminal 4 - the app on :5173 (in application/)
npm run dev
```

| Port | What |
| --- | --- |
| 8545 | hardhat chain (chain id 31337) |
| 3000 | indexer + `/api/market/*` |
| 5173 | the app (vite, proxies `/api` to 3000) |

### Production build

```sh
npx azeroth build                    # client + SSR bundle + prerendered landing
cd server && NODE_ENV=production node src/main.ts
```

One origin serves everything on :3000 - pages, API, and the strict CSP. Set
`CHAIN_ID` to pick the deployment artifact (default 31337; `97` after a testnet
deploy). The VPS story (Caddy, systemd, `deploy/deploy.sh`) is further down.

Open http://localhost:5173 and connect a real wallet extension - there is no
built-in signer, on purpose. The full walkthrough:

1. Install [MetaMask](https://metamask.io/download/) (or any EIP-6963 wallet -
   the connect sheet lists the ones we can name, with install links).
2. Click "Connect wallet" and pick your wallet. On first use the app offers to
   add the "NuraSwap localhost" network (chain id 31337) in one click - accept.
3. Fund your own address from the deployer (a fresh account has no local BNB
   for gas):

   ```sh
   cd contracts && npm run fund -- 0xYourAddress
   ```

   This sends local BNB, mints every mock token, and transfers NURA. It works
   on dev chains only and never touches a real network.
4. Swap, add liquidity, use the faucet - every flow runs against your wallet,
   exactly as it will in production.

Note for hardhat restarts: MetaMask caches nonces per chain id. After you
restart `hardhat node`, clear them via Settings > Advanced > Clear activity
tab data, or transactions will fail with a nonce mismatch.

## Tests

| Suite | Where | Runs |
| --- | --- | --- |
| Contracts | `contracts/` | `npx hardhat test` - init-hash proof, LP mint/burn, swap math, guard reverts |
| Shared math | `shared/` | `npm test` - quote/impact/decimals math, Persian digit normalization |
| Server | `server/` | `npm test` - indexer core, candles, API via `app.handle()` |
| Application | `application/` | `npm test` - render tests + the SSR-safety import gate |

`npm test` at the root runs all four suites. `npm run verify` is the full gate -
RTL lint, types and lint, build, then every test - and is what CI runs:

```sh
npm run verify
```

`npx azeroth check` alone runs the type and lint gates for both app halves;
`npx azeroth build` produces the client bundle, the SSR bundle, and the
prerendered landing page.

## Deploy: BSC testnet

```sh
cd contracts
cp .env.example .env            # set DEPLOYER_PRIVATE_KEY (faucet-funded)
npm run deploy:testnet          # writes shared/deployments/97.json
npm run seed:testnet            # optional: starter liquidity + trades
```

Then point the server at the testnet: `CHAIN_ID=97` in `server/.env`. The
frontend needs no configuration - it receives the active deployment from the
server.

## Deploy: production (VPS)

Production is ONE origin: the server serves the API, the SSR pages, and the
built client. No CORS, no separate static host.

```sh
npx azeroth build                                  # client + SSR bundle + prerender
cd server
NODE_ENV=production CHAIN_ID=97 DATA_DIR=/var/lib/nuraswap node src/main.ts
```

Or the container:

```sh
docker build -f server/Dockerfile -t nuraswap .    # from the repo ROOT
docker run -p 3000:3000 -e NODE_ENV=production -e CHAIN_ID=97 \
  -v /var/lib/nuraswap:/data -e DATA_DIR=/data nuraswap
```

Put a TLS reverse proxy in front (Caddy shown; nginx works the same way):

```
nuraswap.example {
    reverse_proxy 127.0.0.1:3000
}
```

`/api/healthz` answers orchestrator probes. `/api/market/stats` reports
`blocksBehind` - alert when it grows. Mainnet is a configuration exercise, not a
code change: add a chain profile in `contracts/scripts/chains.ts`, deploy, commit
the artifact - but do not deploy pooled-funds contracts to mainnet without an
independent audit.

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
  to be `mUSDT` gets the generic monogram and an explicit warning - it can never
  borrow the real mark. Pinned by `application/tests/token-trust.spec.ts`.
- Production responses carry a strict CSP (`server/src/csp.ts`): no
  `unsafe-inline` or `unsafe-eval` for scripts, `object-src`/`frame-ancestors`
  denied, and `connect-src` derived from the active deployment so the chain RPC
  is reachable without widening the policy by hand. The one inline script - the
  pre-paint theme setter - is allowed by SHA-256 hash, and a test recomputes that
  hash from the built HTML so it cannot drift silently.

## License

- `application/`, `server/`, `shared/`: [MIT](LICENSE)
- `contracts/`: [GPL-3.0](contracts/LICENSE) - required by the vendored Uniswap
  V2 sources; see `contracts/VENDORED.md` for exact provenance and local
  modifications.

---

<div align="center">

[Built with AzerothJS](https://github.com/AzerothJS/AzerothJS)

</div>
