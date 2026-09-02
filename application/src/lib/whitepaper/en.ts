// The whitepaper, English - the source text every translation is made from.
// The facts in here are the artifact's and the chain's: addresses come from
// shared/deployments/1020.json, the tier table from the factory's own
// feeAmountTickSpacing answers, and the protocol-fee state from the pools'
// slot0. Re-check all three when the exchange is redeployed.

import { callout, facts, formula, h3, ol, p, steps, table, ul } from './model.ts';
import type { Whitepaper } from './model.ts';

export const en: Whitepaper = {
    meta:
    {
        title: 'Nura Swap',
        subtitle: 'Whitepaper',
        version: 'Whitepaper v1.0',
        date: 'September 2026',
        covers: 'Describes application release 1.2.1 on Nura Chain (chain id 1020).',
        abstractTitle: 'Abstract',
        disclaimerTitle: 'Disclaimer',
        disclaimer: 'This document describes how Nura Swap works and how the project intends to develop. It is not investment advice, not an offer to sell any asset, and not a guarantee of any outcome. Trading and providing liquidity on an automated market maker carry risk, including the loss of the full amount deposited. Nothing here is a commitment on behalf of the project: the roadmap and the business plan are stated intentions, and they can change.'
    },
    abstract: [
        'Nura Swap is an open, non-custodial automated market maker (AMM) on Nura Chain, the EVM-compatible network whose native coin is NURA. It runs the concentrated-liquidity design of UniswapV3: every trade settles on-chain against liquidity that providers have placed inside price ranges of their choosing, and the price of each trade is computed by the pool itself rather than by an order book or a market maker.',
        "The exchange is three parts. A set of immutable smart contracts holds the pools and executes swaps and liquidity changes. An open-source indexer follows the contracts' event stream and serves market data - pools, prices, candles, volume, transactions - over a small REST API. A web application, available in ten languages with full right-to-left support, is the window onto both: it reads quotes and balances straight from the chain and hands every transaction to the visitor's own wallet for signature. The site never holds funds, keys or sessions.",
        'This paper explains the mechanism in enough depth to reason about it - how prices, ticks, ranges and fees interact, what a swap actually does, what a liquidity position is and how it earns - and then sets out the business plan: who the exchange serves, how it creates and captures value, the protocol fee that is its revenue lever, how it goes to market on Nura Chain, and what it intends to build next.'
    ],
    parts: [
        {
            id: 'protocol',
            label: 'Part I',
            title: 'How the exchange works',
            lede: 'The mechanism, from the chain it runs on to the last byte of a swap.',
            sections: [
                {
                    id: 'introduction',
                    title: 'Why an automated market maker on Nura Chain',
                    blocks: [
                        p('A new chain needs a place where its assets can find a price and change hands from the first day, without anyone having to list them, custody them or make a market in them. Order-book exchanges cannot do that: they need a counterparty on the other side of every trade and an operator to hold deposits. An automated market maker replaces both with a pool - a contract that holds two tokens and quotes a price from what it holds.'),
                        p("Nura Swap is that venue for Nura Chain. Anyone can create a pool for any pair of ERC-20 tokens at any of four fee tiers; anyone can add liquidity to it and earn the fees it collects; anyone with a wallet can trade against it. There is no account to open, no approval to wait for and no party in the middle. The rules are the contract's rules, and the contract cannot be changed."),
                        p('The design is not new, and that is the point. Nura Swap runs the UniswapV3 core and periphery contracts - the most used and most audited concentrated-liquidity code in the industry - with the mathematics untouched. What this project adds is everything around them for this chain: the deployment, the indexer, the market data, the application in ten languages, and the plan set out in the second half of this paper.')
                    ]
                },
                {
                    id: 'nura-chain',
                    title: 'Nura Chain in brief',
                    blocks: [
                        p('Nura Chain is an EVM-compatible network built on CometBFT consensus. Its blocks arrive roughly every three seconds and are final when committed: there are no forks and no confirmation depth to wait for, so a swap is settled the moment its block is committed. Contracts, wallets and tooling written for Ethereum work unchanged.'),
                        facts(
                            { label: 'Chain id', value: '1020', mono: true },
                            { label: 'Native coin', value: 'NURA (18 decimals)', mono: true },
                            { label: 'Wrapped form', value: 'WNURA, 1:1', mono: true },
                            { label: 'Consensus', value: 'CometBFT - a committed block is final' },
                            { label: 'Block time', value: '≈ 3 s', mono: true },
                            { label: 'RPC', value: 'https://rpc.nurachain.net', mono: true },
                            { label: 'Explorer', value: 'https://explorer.nurachain.net', mono: true },
                            { label: 'Launch assets', value: 'WNURA, Bridge BNB, Bridge USDT' }
                        ),
                        p("NURA pays for gas and is the chain's base asset. Because a pool can only hold ERC-20 tokens, NURA trades through its wrapped form, WNURA, which is worth exactly one NURA and can be minted or redeemed one-for-one at any time. The application does this wrapping inside the swap itself, so a trader sees and spends NURA; positions, which live in the pool, hold WNURA."),
                        p('Two bridged assets are live at launch: Bridge BNB and Bridge USDT, each a claim on the corresponding asset held on its origin chain. They give the exchange its first external reference prices, and they are the on-ramp: value enters Nura Chain across the bridge and meets NURA in a pool.')
                    ]
                },
                {
                    id: 'principles',
                    title: 'Design principles',
                    blocks: [
                        ul(
                            "Self-custody, end to end. Funds move only when the owner's wallet signs a transaction. The site holds nothing: no deposits, no keys, no sessions on a server.",
                            'Immutable rules. The pools, the router and the position manager have no upgrade path and no pause switch. What the contract does today is what it will do in ten years.',
                            "Proven mathematics. The tick and liquidity arithmetic is UniswapV3's, ported bit-for-bit to the indexer and the application, so a number the site shows and a number the pool computes agree to the wei.",
                            "Prices come from the pool, never from balances. A concentrated pool's holdings say what its ranges contain, not what it is quoting; every price in the system is read from the pool's own price slot.",
                            "Bounds are enforced by the contract. A trader's slippage limit and deadline are parameters of the transaction; if either is breached, the swap reverts and nothing but gas is spent.",
                            'Open by default. The application, the indexer and the maths are published under the MIT licence, and the deployment artifact that names every contract is committed to the repository.',
                            'Built for its readers. Ten languages, two of them right-to-left, with native numerals where the language has them. A layout is not finished until it has been verified in Persian as carefully as in English.'
                        )
                    ]
                },
                {
                    id: 'concentrated-liquidity',
                    title: 'Concentrated liquidity: how a pool prices',
                    blocks: [
                        p('A classic AMM spreads its liquidity across every price from zero to infinity, so most of the capital in a pool sits at prices that will never trade. UniswapV3 lets a provider place liquidity inside a chosen price range. Within that range the pool behaves like a constant-product market with far more capital than it actually holds; outside it, the position is idle and holds only one of the two tokens.'),
                        h3('Price, ticks and the square root'),
                        p("The pool stores its price as a square root in 64.96 fixed-point form - sqrtPriceX96 - rather than as a plain ratio. The square root makes the swap arithmetic exact and cheap, and the fixed point keeps it in integers. Price space is divided into ticks: tick i corresponds to a price of 1.0001 to the power i, so one tick is a move of one basis point. A position's bounds are always ticks, and each fee tier snaps them to a spacing of its own."),
                        formula('price(i) = 1.0001^i          sqrtPriceX96 = √price × 2^96', 'Ticks are a logarithmic grid: one tick, at any price, is one basis point.'),
                        h3('Liquidity and virtual reserves'),
                        p("Each position contributes an amount of liquidity, L, to every tick between its bounds. At the current price the pool's active liquidity is the sum of every position whose range contains that price, and a trade moves the price along a constant-product curve of those virtual reserves:"),
                        formula('x · y = L²          Δ√P = Δy / L          Δ(1/√P) = Δx / L', 'Within one tick range, the output is a closed-form function of the input and the active liquidity. When the price reaches a tick where liquidity changes, the pool crosses it and continues with the new L.'),
                        p('This is why depth, not balance, decides how far a trade moves the price. A pool with a small balance but liquidity concentrated tightly around the price can absorb a large trade with little impact; a pool with the same balance spread over the whole range cannot.'),
                        h3('How fees accrue'),
                        p("Every swap pays the pool's fee tier on its input, and that fee is credited to the positions that were in range at the moment of the trade, in proportion to their share of the active liquidity. The pool tracks fee growth per unit of liquidity globally and at every tick, so a position's earnings are computed when it is touched rather than paid out on every trade - which keeps the cost of a swap constant no matter how many providers there are. Fees stay in the pool until the owner collects them."),
                        table(
                            ['Range around the current price', 'Liquidity per unit of capital', 'Note'],
                            [
                                ['±2%', '≈ 100×', 'Earns the most while the price stays inside; falls out of range quickly'],
                                ['±10%', '≈ 21×', 'A common choice for a pair that trends slowly'],
                                ['±50%', '≈ 5×', 'Wide enough to survive most moves'],
                                ['Full range', '1×', 'Never out of range - the classic constant-product position']
                            ],
                            [0, 1]
                        ),
                        p('The multipliers are relative to a full-range position of the same value and hold while the price stays inside the range. Concentration is a trade-off: a tighter range earns more per unit of capital and goes idle sooner.')
                    ]
                },
                {
                    id: 'swap',
                    title: 'The life of a swap',
                    blocks: [
                        p('A swap is one transaction against one pool, prepared by the application and signed by the trader. Nothing in it depends on the site being honest: every number that matters is either read from the chain or enforced by the router.'),
                        steps(
                            { title: 'Connect', text: 'The visitor connects a browser wallet. Any wallet that announces itself over EIP-6963 works - MetaMask, Rabby, Trust and the rest - and Nura Wallet connects over its own deep link. The site reads balances and allowances; nothing moves without a signature.' },
                            { title: 'Quote', text: "For the chosen pair and amount, the application asks the on-chain Quoter to simulate the swap in every fee tier that has a pool, and offers the tier that returns the most. The quote is the pool's own arithmetic, so it is exactly what the swap will produce if the pool has not moved." },
                            { title: 'Bound', text: "From the quote and the trader's slippage tolerance it derives a minimum output; from the chain's clock and the chosen deadline, an expiry. It also shows the price impact - how far this trade itself moves the pool - and demands an explicit confirmation above 15%." },
                            { title: 'Approve', text: 'An ERC-20 input needs a one-time allowance for the router. The default approval is exact; an unlimited one is offered as an opt-in, with a plain explanation of what it means.' },
                            { title: 'Settle', text: 'The router pulls the input, swaps it against the pool and delivers the output to the trader in one transaction. If the output would be below the minimum, or the deadline has passed, the transaction reverts: the input never leaves the wallet and only gas is spent.' }
                        ),
                        h3('Native NURA'),
                        p('When one side of the trade is NURA itself, the router wraps it on the way in or unwraps it on the way out inside the same transaction, refunding any dust. Between NURA and WNURA there is no pool to cross: the application calls the wrapper contract directly, one-for-one, with no fee.'),
                        h3('What can go wrong, and what the trader is told'),
                        p('Every revert the router can produce is translated into a sentence. A declined signature says nothing was sent. An output below the minimum says the price moved past the slippage limit and suggests a smaller trade or a wider limit. An expired deadline says nothing was spent. A token the exchange cannot vouch for is marked as such before it can be traded: anyone can deploy a token with any name, and the interface says so.')
                    ]
                },
                {
                    id: 'liquidity',
                    title: 'Providing liquidity',
                    blocks: [
                        p('A liquidity position is an NFT minted by the position manager. It records the pool, the two tick bounds and the amount of liquidity, and it is owned like any other token: it can be transferred, and only its owner can change it or collect its fees.'),
                        steps(
                            { title: 'Choose a pool and a tier', text: 'A pair has up to four pools, one per fee tier. Stable pairs suit the lowest tiers; volatile or thin pairs suit 0.30% and 1.00%, where the fee compensates for the risk of holding the range.' },
                            { title: 'Set the range', text: "Pick a minimum and a maximum price, or full range. The application snaps both to the tier's tick spacing, shows where the current price sits, and warns when the range lies entirely on one side of it - in which case the deposit takes only one token." },
                            { title: 'Deposit', text: 'For a range that straddles the price, the pool needs both tokens in a ratio fixed by the range and the current price; the application computes the second amount from the first. Both tokens are approved for the position manager, then minted in one transaction, with a summary shown first.' },
                            { title: 'Earn and manage', text: "While the price is inside the range, the position earns its share of every trade's fee. The owner can add to it, withdraw part or all of it, and collect earned fees at any time. Withdrawing collects the fees as well." }
                        ),
                        callout('The first provider sets the price', 'A pool that does not yet exist is created by the first deposit, at the price that deposit implies. If that price is away from the market, arbitrage takes the difference from the first provider. The application says this before the wallet prompt and asks for the opening price explicitly.'),
                        h3('Impermanent loss, stated plainly'),
                        p('Holding a range means holding more of whichever token the market is selling. If the price leaves the range, the position holds only that token and stops earning until the price returns. Compared with holding the two tokens unchanged, a position can be worth less after a large move, even net of fees. Fees are the compensation for taking that exposure; whether they are enough depends on the pair, the range and the volume.')
                    ]
                },
                {
                    id: 'fees',
                    title: 'Fee tiers and who receives the fee',
                    blocks: [
                        p('The factory enables the four canonical tiers. A tier is a property of a pool, not of a pair: the same pair can have a pool at each tier, and the swap card quotes them all.'),
                        table(
                            ['Tier', 'Fee on input', 'Tick spacing', 'Typical use'],
                            [
                                ['0.01%', '100 ppm', '1', 'Two assets that track each other very closely'],
                                ['0.05%', '500 ppm', '10', 'Stable and major pairs'],
                                ['0.30%', '3 000 ppm', '60', 'Most pairs'],
                                ['1.00%', '10 000 ppm', '200', 'Volatile, thin or new tokens']
                            ],
                            [0, 1, 2]
                        ),
                        p('At the time of writing, the whole fee of every trade goes to the liquidity providers of the pool that served it. UniswapV3 includes a protocol fee that the factory owner can switch on per pool, taking between one tenth and one quarter of the liquidity fee; it is off on every pool, and its intended use is the subject of the business plan in Part II. Neither the application nor the indexer takes any fee of its own.')
                    ]
                },
                {
                    id: 'architecture',
                    title: 'Architecture',
                    blocks: [
                        p('The exchange is three layers with one seam between them.'),
                        table(
                            ['Layer', 'What it is', 'Where it runs'],
                            [
                                ['Contracts', 'UniswapV3 factory, pools, swap router, quoter, position manager and tick lens; the WNURA wrapper; multicall', 'Nura Chain - immutable'],
                                ['Indexer and market API', "A chain watcher that follows the contracts' events into SQLite and serves market data over REST", 'One small server process'],
                                ['Application', 'The site: compiled AzerothJS components on Vite, TailwindCSS and TypeScript', "The visitor's browser; the landing page and this paper are prerendered"]
                            ]
                        ),
                        h3('The seam: the deployment artifact'),
                        p('The contracts live in their own repository. The one thing this project takes from it is a typed deployment artifact: the chain id, the RPC and explorer URLs, the address of every contract, the token list and the block the exchange was deployed at. The server loads it at start and serves it to the browser, so the application bundle carries no addresses at all, and a redeployment of the exchange is a change to one file.'),
                        h3('Reading the chain'),
                        p("Everything a trade depends on is read live from the chain, not from the indexer: the pool's price slot, the Quoter, balances and allowances, position state - batched through multicall so a page loads in a handful of requests. The application also probes rather than assumes which contract flavour is deployed (Quoter or QuoterV2, SwapRouter or SwapRouter02) and which tiers the factory enables, because a hard-coded guess would silently mis-encode a call on any deployment that differs from the canonical one."),
                        h3('The indexer'),
                        p("The market data that a trade does not need in order to be correct - the pool list, hourly candles, volume, total value locked, a wallet's own history - comes from the indexer. It tails the factory's PoolCreated events and each pool's Swap, Mint and Burn events, prices candles from the post-trade sqrtPriceX96 that every swap reports, and refreshes each pool's balances and price on its own schedule. Because a committed block is final, it waits zero confirmations; a chain-identity guard detects a reset or a redeployment and re-indexes from the artifact's start block. The API reports how far behind the chain it is, and the application shows a banner when that lag grows."),
                        h3('Pricing in dollars'),
                        p('USD figures are for display and never for execution. The stablecoin anchors at one dollar; a bridged asset is worth what it bridges, which no pool on this chain can know, so it is seeded from an external price feed. Every other token prices through the deepest pool that connects it to an anchored one, in two passes, so a token that pairs only against WNURA still resolves. Money totals - TVL, volume - sum only over anchored prices: a pool cannot be counted as valuable on the strength of a rate it set itself.'),
                        h3('The market API'),
                        table(
                            ['Endpoint', 'Answers'],
                            [
                                ['/api/market/stats', 'Pool count, TVL, 24-hour volume, indexed block and lag'],
                                ['/api/market/pools', 'Every pool with its tokens, holdings, price, TVL, volume and fee APR'],
                                ['/api/market/pools/:address', 'One pool with 72 hours of hourly candles'],
                                ['/api/market/tokens', 'The token registry with USD prices, and whether each is anchored'],
                                ['/api/market/txs', 'Recent swaps and liquidity events, filterable by account'],
                                ['/api/market/deployment', 'The active deployment artifact'],
                                ['/api/healthz', 'Liveness for orchestrators']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'application',
                    title: 'The application',
                    blocks: [
                        p('The site is the part of the exchange a person touches, and it is built to be trusted on inspection rather than on reputation.'),
                        ul(
                            'Swap: quotes across every tier, live price impact, slippage and deadline control, approve-then-swap, NURA wrap and unwrap, a price chart and recent trades.',
                            'Liquidity: pools per tier with price and TVL; positions with their range and in-range state; mint, increase, decrease and collect, each with a summary before the wallet prompt.',
                            "Portfolio: holdings with USD values, positions, and the wallet's own on-chain activity.",
                            "Wallets: every EIP-6963 wallet, silent session restore, the Nura Wallet deep-link connector, and a one-prompt 'Add Nura Chain' that never switches networks behind the visitor's back.",
                            'Ten languages: English, Persian, Arabic, Spanish, Portuguese, Hindi, Chinese, Russian, French and Turkish. Persian and Arabic are laid out right-to-left and shown in their own numerals; amounts, addresses and hashes stay left-to-right islands in every language.',
                            'Light and dark themes, visible keyboard focus everywhere, native semantics over ARIA, and reduced-motion support.',
                            'The landing page and this document are prerendered at build; the trading pages load lazily and render in the browser, where the wallet is.'
                        )
                    ]
                },
                {
                    id: 'security',
                    title: 'Security and risk controls',
                    blocks: [
                        h3('What the contracts guarantee'),
                        ul(
                            'The AMM is UniswapV3 with the audited mathematics untouched, vendored and pinned in the contracts repository. Nura Swap has not modified the pool, router or position-manager logic.',
                            "No upgradeability and no administrator over user funds. The factory owner can enable fee tiers and set the protocol fee; it cannot touch a pool's balances or a position.",
                            'Slippage and deadline are enforced by the router. The interface can be wrong, compromised or replaced, and the bound still holds.'
                        ),
                        h3('What the application does'),
                        ul(
                            "There is no in-app signer. Every transaction is signed by the visitor's own wallet, in development and production alike.",
                            'A strict content-security policy, one origin for pages and API, and rate limiting on the server.',
                            'Unknown tokens are labelled before they can be traded; high price impact demands a confirmation; unlimited approvals are opt-in and explained.',
                            'Everything is open source under MIT, with a test suite that checks the maths against the Solidity reference, the indexer against a scripted chain, and the pages against a stubbed API.'
                        ),
                        callout('An honest note on audits', 'The Uniswap code has been audited many times; this deployment of it on Nura Chain has not yet been independently audited as a whole. That audit is on the roadmap in Part II, and until it is done the project asks visitors to treat the exchange as what it is: pooled-funds contracts on a young chain.'),
                        h3('Risks that remain'),
                        ul(
                            'Smart-contract risk: an undiscovered defect in the contracts, the chain or a wallet.',
                            'Market risk: impermanent loss for providers, price impact for traders, and thin liquidity in a new market.',
                            'Bridge risk: a bridged asset is a claim on the bridge; its value depends on the bridge honouring it.',
                            "Token risk: anyone can deploy a token with any name; a pool's existence says nothing about the token in it.",
                            'Operational risk: the indexer or the RPC can lag or fail. The exchange keeps working, but market data may be stale.'
                        )
                    ]
                }
            ]
        },
        {
            id: 'business',
            label: 'Part II',
            title: 'The business plan',
            lede: 'Who the exchange serves, how it creates and captures value, and what it will build.',
            sections: [
                {
                    id: 'vision',
                    title: 'Vision and mission',
                    blocks: [
                        p('Vision: Nura Chain has a native market - a place where every asset on the chain can be priced and traded by anyone, from anywhere, with nobody in the middle.'),
                        p('Mission: build and operate the reference exchange for Nura Chain - the most trusted contracts, the best market data, and an interface its users can read in their own language - and make it sustainable through a fee that is transparent, contract-enforced and small.'),
                        p('Nura Swap is infrastructure. It succeeds when other things are built on top of it: wallets that quote through it, tokens that launch on it, applications that read its prices.')
                    ]
                },
                {
                    id: 'market',
                    title: 'Market and opportunity',
                    blocks: [
                        p('Nura Chain is at the stage where its economy is being formed. The native coin has holders, the bridge brings BNB and USDT across, and new tokens will follow as projects deploy. Each of these needs the same thing first: a venue. Whoever provides the reference venue for a chain tends to keep it, because liquidity attracts trades, trades attract liquidity, and both attract the integrations that make switching costly.'),
                        h3('Who the exchange serves'),
                        table(
                            ['Segment', 'What they need', 'What Nura Swap gives them'],
                            [
                                ['Holders and traders of NURA', 'A way to move between NURA, stable value and bridged assets without an exchange account', 'On-chain swaps from their own wallet, in their language, with contract-enforced limits'],
                                ['Liquidity providers', 'Yield on idle assets, with control over exposure', 'Concentrated positions with a chosen range and tier; fees collected on demand'],
                                ['Token issuers on Nura Chain', 'A market for their token from day one, without a listing process', 'Permissionless pool creation at any tier; the indexer lists and charts the pool automatically'],
                                ['Wallets and applications', 'Prices and swaps they can build on', 'A public market API, a quoter and router on chain, and an open front-end to fork or embed']
                            ]
                        ),
                        h3('Why now, and why here'),
                        ul(
                            'First mover on a new chain: no incumbent to displace, and a community that speaks the languages the application already ships in.',
                            'The bridge is the on-ramp: BNB and USDT entering Nura Chain need a pool to meet NURA in, and that pool is here.',
                            "Nura Wallet ships a connector for this exchange, so the chain's own wallet leads its users to it."
                        )
                    ]
                },
                {
                    id: 'value',
                    title: 'Value creation and value capture',
                    blocks: [
                        p('An AMM creates value in three places: providers earn fees on capital they would otherwise hold idle, traders get execution without a counterparty or a custodian, and the ecosystem gets a price for every asset that has a pool. Nura Swap captures a share of that value through one lever built into the contracts.'),
                        h3('The protocol fee'),
                        p('UniswapV3 lets the factory owner enable a protocol fee on each pool: a fraction, between one tenth and one quarter, of the liquidity fee that every swap already pays. It is taken from the fee, not added to the trade, so a trader pays exactly the same whether it is on or off. It accrues in the pool in the tokens traded and is collected by the owner. It is off today on every pool.'),
                        p("The intended policy is to keep it off while the exchange is bootstrapping liquidity, and to turn it on gradually - starting with the deepest pools, at the lowest setting - once fee income to providers is established and the community has been told in advance. Every change to the fee is a public transaction from the factory owner's address, visible on the explorer."),
                        h3('What the numbers look like'),
                        table(
                            ['Daily volume', 'Liquidity fees at 0.30%', 'Protocol share at 1/5', 'Per year'],
                            [
                                ['$100,000', '$300', '$60', '$21,900'],
                                ['$1,000,000', '$3,000', '$600', '$219,000'],
                                ['$10,000,000', '$30,000', '$6,000', '$2,190,000']
                            ],
                            [0, 1, 2, 3]
                        ),
                        p('Illustrative only: the blended fee depends on which tiers carry the volume, and the protocol share on the setting chosen per pool. The point of the table is its shape. Revenue scales with volume, it costs providers a fraction of their fee and traders nothing, and the exchange needs no token, no subscription and no custody to earn it.'),
                        h3('Other lines'),
                        ul(
                            'Integration and liquidity services for token issuers - designing a launch pool, seeding a range, running an incentive campaign - priced per engagement.',
                            'The market API as a hosted service for wallets and analytics products, with the open-source indexer always available to self-host.',
                            'Ecosystem grants from Nura Chain for infrastructure the chain needs and the exchange is positioned to build: routing, oracles, analytics.'
                        ),
                        callout('No token', "Nura Swap has no token of its own and needs none: NURA pays for gas, fees accrue in the tokens traded, and the protocol fee is collected in kind. No token sale, presale or airdrop is planned. Any future change to this position would be announced through the project's official channels, never through a third party.")
                    ]
                },
                {
                    id: 'go-to-market',
                    title: 'Go-to-market',
                    blocks: [
                        steps(
                            { title: 'Launch - done', text: 'The V3 exchange on Nura Chain with WNURA, Bridge BNB and Bridge USDT; the indexer and API; the application in ten languages; the Nura Wallet connector; release 1.2.1.' },
                            { title: 'Liquidity', text: 'Onboard the first providers with education in Persian and English - how ranges work, how to read a position - and work with Nura Chain on incentives for the pools that anchor the market: NURA against USDT and BNB.' },
                            { title: 'Ecosystem', text: 'Meet every project deploying a token on Nura Chain before it launches: a pool at the right tier, a seeded range, a listing in the token registry and a chart on day one.' },
                            { title: 'Integrations', text: "Put the quoter and the API in front of wallets, explorers and dashboards, so the exchange's price is the chain's price and its router is the default way to swap." },
                            { title: 'Scale', text: 'Deepen liquidity, widen the asset list as the bridge grows, turn on the protocol fee, and reinvest in the roadmap.' }
                        ),
                        h3('Channels'),
                        ul(
                            "The chain's own surfaces: Nura Wallet, the explorer, and the Nura Chain community on Telegram, Discord, X and Instagram.",
                            'Documentation and this paper in the languages the community reads.',
                            'Open source as distribution: a front-end anyone can fork lowers the cost of building on the exchange.'
                        )
                    ]
                },
                {
                    id: 'roadmap',
                    title: 'Roadmap',
                    blocks: [
                        p('Directional, not contractual. Items move as the chain and the community do; what has actually shipped is recorded in the changelog.'),
                        table(
                            ['When', 'What'],
                            [
                                ['Shipped - Q3 2026', 'UniswapV3 exchange; swap, liquidity and portfolio pages; indexer and market API; ten languages with right-to-left; Nura Wallet connector; installable web app'],
                                ['Q4 2026', 'Independent audit of the Nura Chain deployment; multi-hop routing through WNURA in the swap card; pool analytics with fee and APR history; this paper in further languages'],
                                ['H1 2027', 'Protocol-fee activation policy and first activations; liquidity incentive programme with Nura Chain; single-sided range positions as limit orders; position dashboards; more bridged assets as the bridge adds them'],
                                ['H2 2027', 'Integration SDK for wallets and applications; the factory owner key under a multi-signature account with published signers; TWAP price oracle exposure for lending and pricing on Nura Chain']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'governance',
                    title: 'Governance and operations',
                    blocks: [
                        p('The contracts are immutable, so governance is small by construction. One key - the factory owner - holds exactly two powers: enabling a new fee tier, and setting the protocol fee on a pool. It cannot pause a pool, move funds, change a tier that exists, or alter a position. Both powers are exercised by public transactions.'),
                        facts(
                            { label: 'Factory owner', value: '0x4ac0d9300422b408bA2AbF47995C87cF32763712', mono: true },
                            { label: 'Can', value: 'Enable fee tiers; set the protocol fee per pool' },
                            { label: 'Cannot', value: 'Pause, upgrade, seize or move funds' }
                        ),
                        p('The application and the indexer are released through the public repository with a versioned changelog; every release passes the same gate - type checks, lint, build and the three test suites - in continuous integration. The server exposes health and lag endpoints for monitoring and is meant to run behind a TLS proxy under a service manager. Support and announcements run through the community channels listed at the end.')
                    ]
                },
                {
                    id: 'metrics',
                    title: 'What success looks like',
                    blocks: [
                        p('The exchange publishes its own scorecard: the landing page shows value locked, 24-hour volume and pool count live from the API, and every figure below can be read from the same endpoints by anyone.'),
                        table(
                            ['Metric', 'Why it matters'],
                            [
                                ['Total value locked', 'Depth: how large a trade the market can absorb'],
                                ['24-hour volume', 'Activity, and the base the protocol fee scales with'],
                                ['Pools and listed tokens', 'Breadth of the market'],
                                ['Providers and positions in range', 'Health of the supply side'],
                                ['Fee income to providers', 'Whether providing liquidity pays'],
                                ['Integrations', 'Wallets and applications quoting through the exchange']
                            ]
                        )
                    ]
                },
                {
                    id: 'risks',
                    title: 'Risks to the plan',
                    blocks: [
                        ul(
                            "Adoption: a chain's economy can grow more slowly than planned, and the exchange earns nothing on volume that does not happen.",
                            'Competition: a second AMM on Nura Chain can fork the same open code. The defence is liquidity, integrations and trust, not secrecy.',
                            'Bridge dependence: the first external value arrives across a bridge; a bridge incident affects the assets priced through it.',
                            'Regulation: rules for decentralised exchanges differ by jurisdiction and change. The project will adapt its operations, not the contracts, which it cannot change.',
                            'Key management: until the owner key sits under a multi-signature account, its compromise could set a protocol fee - never move funds.',
                            'Security: an undiscovered defect in the contracts, the chain or a wallet could cause loss. The audit on the roadmap reduces this risk but does not remove it.'
                        )
                    ]
                },
                {
                    id: 'contracts',
                    title: 'Appendix A: Contracts and addresses',
                    blocks: [
                        p('The live deployment on Nura Chain, as recorded in the committed artifact. Verify every address on the explorer before interacting with it directly.'),
                        table(
                            ['Contract', 'Address'],
                            [
                                ['V3 factory', '0x88E8bB62E1654e695043FD5416D5E5415AFFd39b'],
                                ['Swap router', '0x98b52fB699F1F91494b2937fECf109f8E09570Ae'],
                                ['Quoter', '0x4b6f7C7d1337F6C6A624677688EA8035c3Ed6782'],
                                ['Position manager', '0xcf00BFaA3c292205D38d37f9086c4F3838339Fbb'],
                                ['Tick lens', '0xbFdA09e0D89ABa201491F81dcD0993Fd223e66A0'],
                                ['WNURA - wrapped NURA', '0xf0a4eC07916feBa4432121Ed5969887D9b939cD0'],
                                ['Multicall3', '0xf58884FCf45d8F5Cc8A73c618D23EB27b732CA24'],
                                ['Bridge BNB', '0xD4221Ad9772BF5bA7423a044bBBEe6af2154A5Fc'],
                                ['Bridge USDT', '0x4E0DB0B1Da408faF5637202CF48b0bc7733bE6dC'],
                                ['Factory owner', '0x4ac0d9300422b408bA2AbF47995C87cF32763712']
                            ],
                            [1]
                        ),
                        facts(
                            { label: 'Chain id', value: '1020', mono: true },
                            { label: 'Deployment block', value: '124110', mono: true },
                            { label: 'Token decimals', value: '18 - every listed token', mono: true }
                        )
                    ]
                },
                {
                    id: 'glossary',
                    title: 'Appendix B: Glossary',
                    blocks: [
                        table(
                            ['Term', 'Meaning'],
                            [
                                ['AMM', 'Automated market maker: a contract that quotes a price from the assets it holds instead of matching orders.'],
                                ['Pool', 'One contract holding two tokens at one fee tier. A pair can have up to four.'],
                                ['Fee tier', 'The fee a pool charges on every swap, in parts per million: 100, 500, 3 000 or 10 000.'],
                                ['Tick', 'A point on the logarithmic price grid; price(i) = 1.0001^i. Position bounds are ticks.'],
                                ['Tick spacing', 'The grid a tier allows bounds on: 1, 10, 60 or 200 ticks.'],
                                ['sqrtPriceX96', "The pool's price, stored as a square root in 64.96 fixed point."],
                                ['Liquidity (L)', 'The size of a position within its range; the constant of its virtual constant-product curve.'],
                                ['Position', 'An NFT recording a pool, two tick bounds and an amount of liquidity.'],
                                ['In range', "The current price lies between a position's bounds, so it holds both tokens and earns fees."],
                                ['Price impact', 'How far a trade itself moves the pool price, fee excluded.'],
                                ['Slippage tolerance', 'The worst price a trader accepts; the router reverts beyond it.'],
                                ['Deadline', 'The time after which the router refuses to execute the transaction.'],
                                ['Quoter', 'A contract that simulates a swap and returns its output without executing it.'],
                                ['Router', 'The contract that executes swaps, wrapping and unwrapping NURA as needed.'],
                                ['Position manager', 'The contract that mints, changes and burns positions, and collects their fees.'],
                                ['WNURA', 'NURA wrapped as an ERC-20 token, redeemable one-for-one.'],
                                ['Protocol fee', 'An optional fraction of the liquidity fee that the factory owner can direct to the protocol.'],
                                ['Impermanent loss', 'The shortfall of a position against simply holding its tokens after a price move.'],
                                ['TVL', 'Total value locked: the USD value of everything the pools hold, priced through anchors only.'],
                                ['Indexer', "The server process that follows the contracts' events and serves market data."]
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'links',
                    title: 'Appendix C: Links and references',
                    blocks: [
                        table(
                            ['Resource', 'Where'],
                            [
                                ['Application, indexer and maths - source', 'https://github.com/NuraChain/Swap'],
                                ['Nura Chain RPC', 'https://rpc.nurachain.net'],
                                ['Explorer', 'https://explorer.nurachain.net'],
                                ['X', 'https://x.com/nurachainnet'],
                                ['Discord', 'https://discord.gg/8BMAXTdXQg'],
                                ['Telegram', 'https://t.me/nurachain'],
                                ['Instagram', 'https://www.instagram.com/nura.chain/']
                            ],
                            [1]
                        ),
                        ol(
                            'Adams, Zinsmeister, Salem, Keefer, Robinson - Uniswap v3 Core (2021).',
                            'Nura Swap repository - README, CHANGELOG and TESTING for the application half described here.'
                        )
                    ]
                }
            ]
        }
    ]
};
