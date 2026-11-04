# Nura Swap — Non-Custodial Decentralized Exchange on Nura Chain

**Nura Swap** is an open automated market maker (AMM) and decentralised exchange (DEX) built for [Nura Chain](https://nurachain.net). It lets users swap tokens, provide liquidity and manage liquidity positions through a Uniswap V3-style AMM while keeping control of their wallets.

Live application: **[swap.nurachain.net](https://swap.nurachain.net)**

The interface supports ten languages, including right-to-left layouts, with dark and light themes.

## Features

- **Token swaps:** exchange supported assets on Nura Chain.
- **Concentrated liquidity:** provide liquidity to Uniswap V3-style pools.
- **Liquidity management:** add, remove and track liquidity positions.
- **Self-custody:** connect with an EVM wallet and authorise transactions from the wallet.
- **Portfolio and market data:** view pool and token information from the configured chain.
- **Internationalisation:** ten languages and first-class RTL support.
- **Responsive interface:** desktop and mobile layouts with dark and light themes.

## Network

The example configuration is set up for Nura Chain:

| Setting | Value |
| --- | --- |
| Chain ID | 1020 |
| Native currency | NURA |
| JSON-RPC | [rpc.nurachain.net](https://rpc.nurachain.net) |
| Explorer | [explorer.nurachain.net](https://explorer.nurachain.net) |
| DEX | [swap.nurachain.net](https://swap.nurachain.net) |

## Technology

Nura Swap is organised into three npm workspaces:

| Workspace | Responsibility |
| --- | --- |
| application/ | Web interface, routing, rendering and SEO build |
| server/ | API, chain indexing and server-side rendering |
| shared/ | Shared types, chain data and deployment artifacts |

The project uses TypeScript, Node.js, PostgreSQL, viem and AzerothJS. The production build also generates SEO assets for the application.

## Run locally

You need Node.js 24 or newer and a PostgreSQL database.

~~~bash
git clone https://github.com/NuraChain/Swap.git
cd Swap
npm ci
cp .env.example .env
~~~

Review the configuration before starting. The server requires the chain ID, database URL, client and SSR bundle paths, proxy settings and price-feed configuration. The selected deployment artifact must exist under shared/deployments for the configured chain.

Start the development application:

~~~bash
npm run dev
~~~

Useful commands:

| Command | Purpose |
| --- | --- |
| npm run dev | Start the application in development |
| npm run check | Run project checks |
| npm run build | Build the application and generate SEO assets |
| npm test | Run the application and shared tests |
| npm run verify | Run RTL linting, checks, build and tests |
| npm start | Start the production server |

## Deployment

A Dockerfile is included at the repository root. Configure the chain and database before deployment, and set TRUST_PROXY correctly when the server runs behind nginx, Caddy or another reverse proxy. Price-feed settings control whether live USD prices for bridged assets are fetched from external providers.

## Links

- [Nura Chain](https://nurachain.net)
- [Nura Chain Explorer](https://explorer.nurachain.net)
- [Nura Wallet](https://github.com/NuraChain/Wallet)
- [Nura Swap source code](https://github.com/NuraChain/Swap)

## License

Licensed under the [MIT License](LICENSE).
