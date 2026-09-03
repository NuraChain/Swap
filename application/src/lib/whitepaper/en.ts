// The whitepaper, English - the source text every translation is made from.
// The facts in here are the artifact's and the chain's: addresses come from
// shared/deployments/1020.json, the tier table from the factory's own
// feeAmountTickSpacing answers, and the protocol-fee state from the pools'
// slot0. Re-check all three when the exchange is redeployed.
//
// House style: short sentences, everyday words, and a picture before a term.
// Anything a newcomer cannot follow on the first read belongs in the glossary,
// not in the middle of a paragraph.

import { callout, facts, formula, h3, ol, p, steps, table, ul } from './model.ts';
import type { Whitepaper } from './model.ts';

export const en: Whitepaper = {
    meta:
    {
        title: 'Nura Swap',
        subtitle: 'Whitepaper',
        version: 'Whitepaper v1.1',
        date: 'September 2026',
        covers: 'Describes application release 1.3.0 on Nura Chain (chain id 1020).',
        abstractTitle: 'In short',
        disclaimerTitle: 'Please read this',
        disclaimer: 'This paper explains how Nura Swap works and what the project hopes to build next. It is not financial advice, it is not an offer to sell anything, and it promises no profit. Trading and putting money into a pool both carry real risk, and you can lose everything you put in. The plans described here are intentions, not promises, and they can change.'
    },
    abstract: [
        'Nura Swap is a trading machine that lives on Nura Chain. It swaps one token for another, and nobody stands in the middle: no company holds your money, no clerk approves you, and no account is opened. Your own wallet keeps your coins the whole time.',
        'The trick is a pool. A pool is a shared pot holding two kinds of token, and it sets its own price from what is in it. People who put tokens into the pot earn a small fee from every trade that uses it. That is the whole idea; the rest of this paper is the detail.',
        'Nura Swap is built from three pieces: contracts on the chain that do the actual swapping, a small server that collects prices and history, and this website, which you can read in ten languages. Part I explains how the machine works. Part II explains how the project plans to pay for itself and grow.'
    ],
    parts: [
        {
            id: 'protocol',
            label: 'Part I',
            title: 'How the exchange works',
            lede: 'Start with the pot of tokens, and everything else follows.',
            sections: [
                {
                    id: 'introduction',
                    title: 'Why a chain needs a swap machine',
                    blocks: [
                        p('A new chain is a bit like a new town. Coins exist, but there is nowhere to trade them, so nobody can tell what they are worth. Somebody has to open a shop.'),
                        p('The old way to open that shop is an order book: a big list of people asking to buy and people asking to sell. It only works if someone is standing on the other side of your trade right when you want it, and it usually needs a company to hold everyone’s money while the list is matched up. On a young chain there is rarely anyone on the other side, and trusting a company with your coins is exactly what a blockchain is meant to avoid.'),
                        p('Nura Swap does it the other way round. Instead of matching two people, it keeps a pot with two kinds of token in it. You trade with the pot. Put one token in, take the other one out, and the pot works out the price by itself. It is always open, it never says no, and it never holds anything that belongs to you for longer than the second your trade takes.'),
                        p('The maths inside the pot is not ours. Nura Swap runs UniswapV3, the most used and most checked code of its kind, exactly as written. What this project built is everything around it for this chain: the setup, the price data, the website in ten languages, and the plan in Part II.')
                    ]
                },
                {
                    id: 'nura-chain',
                    title: 'Nura Chain in one page',
                    blocks: [
                        p('Nura Chain is the network everything here runs on. It writes a new block roughly every three seconds, and once a block is written it is done - there is no waiting to see whether it sticks. So a swap is finished the moment its block appears. It understands the same language as Ethereum, so wallets and tools made for Ethereum work here without changes.'),
                        facts(
                            { label: 'Chain id', value: '1020', mono: true },
                            { label: 'Its coin', value: 'NURA (18 decimals)', mono: true },
                            { label: 'Wrapped version', value: 'WNURA, always 1:1', mono: true },
                            { label: 'How blocks are agreed', value: 'CometBFT - once written, a block is final' },
                            { label: 'New block every', value: '≈ 3 s', mono: true },
                            { label: 'Connection point', value: 'https://rpc.nurachain.net', mono: true },
                            { label: 'Block explorer', value: 'https://explorer.nurachain.net', mono: true },
                            { label: 'Tokens at launch', value: 'WNURA, Bridge BNB, Bridge USDT' }
                        ),
                        p('NURA is the coin of the chain, and it pays the small fee every transaction costs. But a pool can only hold tokens of the ERC-20 kind, and NURA itself is not one - much as a cloakroom takes coats, not people. So NURA gets a ticket called WNURA: hand over one NURA, get one WNURA, and swap it back whenever you like. The website does this inside the trade, so you only ever see NURA. Pools hold the WNURA version.'),
                        p('Two tokens arrive from other chains through a bridge: Bridge BNB and Bridge USDT. Each one is a claim on the real thing, locked away on its home chain - think of a cloakroom ticket again, but for a coin that lives somewhere else. They matter for two reasons. They bring in value from outside, and because a dollar token is worth about a dollar anywhere, they give the chain its first honest yardstick for what everything else is worth.')
                    ]
                },
                {
                    id: 'principles',
                    title: 'The rules we hold ourselves to',
                    blocks: [
                        ul(
                            'Your coins stay yours. Nothing moves until your wallet signs for it. The website holds no deposits, no keys and no login.',
                            'The rules cannot be changed. The contracts have no update button and no off switch - not for us, not for anyone. What they do today they will do in ten years.',
                            'Borrowed maths, checked by thousands. The pricing is UniswapV3’s, copied number for number into our website and our server, so the figure you read matches the figure the pool will use.',
                            'Prices come from the pool itself, never from guessing. Counting what a pool holds tells you very little about what it is charging, so every price here is asked of the pool directly.',
                            'Your limits are enforced by the contract, not by us. You say the worst price you accept and the time you give it. If either is broken the trade simply does not happen.',
                            'Everything is public. The website, the server and the maths are open source, and the file listing every contract address sits in the repository for anyone to read.',
                            'Written for the people who use it. Ten languages, two of them right-to-left, with local numerals. A page is not finished until it has been checked in Persian as carefully as in English.'
                        )
                    ]
                },
                {
                    id: 'concentrated-liquidity',
                    title: 'How a pool decides the price',
                    blocks: [
                        p('Picture a pot with two kinds of token in it, say NURA and dollars. When you take NURA out, you must put dollars in. NURA becomes scarcer inside the pot, so the pot starts asking more for the next one. Buy a lot and the price climbs as you go. That is the whole pricing rule: whichever token is running low gets more expensive.'),
                        p('The old design spread a pot’s money across every price that could ever happen, from almost zero to almost infinity. Most of it sat in prices nobody will ever trade at - like stocking a shop with sizes nobody wears. Nura Swap lets you choose a price range instead and put your money only there. Inside your range your money works far harder. Outside it, your money sits still and waits.'),
                        h3('Prices sit on a ladder'),
                        p('Prices here are not a smooth line, they are rungs on a ladder. Each rung is one hundredth of a percent above the one below it, so tiny that you would never notice, and the ranges people choose always start and end on a rung. Rungs are called ticks. The pool keeps its price as a square root, stored as a whole number, because computers add whole numbers perfectly and never lose a fraction along the way.'),
                        formula('price(i) = 1.0001^i          sqrtPriceX96 = √price × 2^96', 'Rung number i means a price of 1.0001 multiplied by itself i times. Every rung is a 0.01% step, whether the price is small or large.'),
                        h3('Depth is what really matters'),
                        p('Add up everyone whose range covers the price right now, and you get the pool’s depth at that price - the number the pool calls L. Depth decides how much a trade shifts the price:'),
                        formula('x · y = L²          Δ√P = Δy / L          Δ(1/√P) = Δx / L', 'Bigger L, smaller move. The pool works out your exact output from your input and the depth, then keeps going onto the next rung when it runs past the edge of somebody’s range.'),
                        p('So the size of a pool is not what counts - where the money is put matters more. A small pot with everything packed tightly around the price can take a big trade without flinching. A larger pot with money scattered everywhere cannot.'),
                        h3('Where the fee goes'),
                        p('Every trade pays a small fee, and the fee is shared out among the people whose range covered the price at that moment, in proportion to how much each of them put there. If your range did not cover the price, you earn nothing from that trade. The pool keeps a running total instead of paying everyone one by one, which is why a swap costs the same whether ten people or ten thousand are supplying the pot. Your fees wait in the pool until you come and collect them.'),
                        table(
                            ['If your range is', 'Your money works about', 'What that means'],
                            [
                                ['±2% wide', '100× harder', 'Earns the most - but the price escapes it quickly'],
                                ['±10% wide', '21× harder', 'A common choice for a pair that moves slowly'],
                                ['±50% wide', '5× harder', 'Wide enough to survive most surprises'],
                                ['The whole ladder', 'Just as hard as before', 'Never stops earning, never earns much']
                            ],
                            [0, 1]
                        ),
                        p('The comparison is against putting the same money across the whole ladder, and it only holds while the price stays inside your range. That is the trade-off in one line: the narrower you go, the more you earn, and the sooner you stop.')
                    ]
                },
                {
                    id: 'swap',
                    title: 'What happens when you swap',
                    blocks: [
                        p('A swap is one transaction, prepared by the website and signed by you. You do not have to trust the website for it to be safe: every number that matters is either read from the chain or checked by the contract before your tokens move.'),
                        steps(
                            { title: 'Connect your wallet', text: 'Almost any browser wallet works - MetaMask, Rabby, Trust and others - and Nura Wallet connects through its own link. Connecting only lets the site read what you already hold. Nothing can move without your signature.' },
                            { title: 'Get a price', text: 'A pair can have up to four pools, each charging a different fee. The site asks every one of them what you would get, and offers the best answer. The question is put to the chain, not to us, so the number you see is the number the pool will really give you.' },
                            { title: 'Set your limits', text: 'You choose the worst price you will accept and how long the offer stays good. The site also shows how much your own trade pushes the price. If that push is bigger than 15%, it stops and asks you to confirm on purpose.' },
                            { title: 'Give permission', text: 'The first time you spend a particular token, you grant permission for that amount. We ask for the exact amount by default. You can grant unlimited permission if you prefer, and we explain plainly what that means before you do.' },
                            { title: 'Send it', text: 'One transaction takes your token, swaps it and hands back the other one. If the result would be worse than your limit, or you ran out of time, the whole thing is cancelled: your tokens never leave your wallet, and you lose only the tiny network fee.' }
                        ),
                        h3('Swapping NURA itself'),
                        p('When one side of your trade is NURA, the website turns it into WNURA on the way in, or back into NURA on the way out, inside the same transaction, and returns any leftover dust. Going between NURA and WNURA is not a trade at all - it is one for one, with no fee and no pool involved.'),
                        h3('If something goes wrong'),
                        p('Every refusal the contract can give is turned into a sentence you can act on. Cancel the signature, and nothing was sent. If the price moved past your limit, we say so and suggest trading less or widening the limit. If time ran out, nothing was spent. And a token we cannot vouch for is labelled before you can trade it, because anyone at all can create a token and give it any name they like.')
                    ]
                },
                {
                    id: 'liquidity',
                    title: 'Putting your money into a pool',
                    blocks: [
                        p('When you supply a pool you get a receipt, and that receipt is itself a token you own. It records which pool, which price range and how much. Only the holder can change it or collect from it, and it can be handed to somebody else exactly like any other token.'),
                        steps(
                            { title: 'Pick a pool', text: 'A pair can have up to four pools, one per fee level. Two tokens that stay close together suit the cheap levels. Wild or thinly traded pairs suit 0.30% and 1.00%, where the bigger fee pays you back for the bigger risk.' },
                            { title: 'Pick your price range', text: 'Choose the lowest and highest price you want to cover, or take the whole ladder. The site snaps both ends to real rungs, shows where the price is now, and warns you if your range sits entirely to one side of it - because then you are really placing an order, not supplying a market.' },
                            { title: 'Put the money in', text: 'If your range covers the current price, the pool needs both tokens, in a ratio your range decides. Type one amount and the site works out the other. You approve both, see a summary, and then one transaction does it.' },
                            { title: 'Earn and manage', text: 'While the price is inside your range you collect a share of every trade. You can add more, take some or all of it back, or collect what you have earned, whenever you want. Taking your money out collects the earnings too.' }
                        ),
                        callout('Whoever goes first sets the price', 'If a pool does not exist yet, the first deposit creates it - and the price that deposit implies becomes the pool’s price. Get it wrong and traders will happily take the difference off you within minutes. The site says this plainly and asks you to type the opening price yourself.'),
                        h3('The catch, in plain words'),
                        p('Supplying a pool means you end up holding more of whichever token everybody else is selling. If the price runs out of your range, you are left holding just one of the two, and you stop earning until it comes back. Compared with simply keeping both tokens and doing nothing, you can end up worse off after a big move, even counting the fees you earned. The fees are your payment for taking that on. Whether they add up to enough depends on the pair, your range, and how much trading happens.')
                    ]
                },
                {
                    id: 'fees',
                    title: 'The fee, and who gets it',
                    blocks: [
                        p('There are four fee levels, and the level belongs to the pool rather than to the pair. The same two tokens can have a pool at each level, and the site quotes all of them before choosing.'),
                        table(
                            ['Fee', 'On a $1,000 trade', 'Rungs between range ends', 'Suits'],
                            [
                                ['0.01%', '$0.10', '1', 'Two tokens that barely move apart'],
                                ['0.05%', '$0.50', '10', 'Dollar tokens and big pairs'],
                                ['0.30%', '$3.00', '60', 'Most pairs'],
                                ['1.00%', '$10.00', '200', 'New, wild or thinly traded tokens']
                            ],
                            [0, 1, 2]
                        ),
                        p('Today every penny of that fee goes to the people supplying the pool. The Uniswap design also allows a protocol fee - a slice of that fee, between a tenth and a quarter of it, redirected to whoever owns the factory contract. It is switched off on every pool, and what we intend to do with it is set out in Part II. Neither the website nor the server charges anything of its own on top.')
                    ]
                },
                {
                    id: 'architecture',
                    title: 'How the whole thing is built',
                    blocks: [
                        p('Three pieces, and one small file joining them.'),
                        table(
                            ['Piece', 'What it does', 'Where it lives'],
                            [
                                ['The contracts', 'Hold the pools, do the swaps, keep track of who supplied what', 'On Nura Chain - unchangeable'],
                                ['The server', 'Watches the contracts and keeps the history: prices, charts, volume, recent trades', 'One small machine'],
                                ['The website', 'Everything you see and click', 'Your browser - the front page and this paper are built ahead of time']
                            ]
                        ),
                        h3('The file that ties it together'),
                        p('The contracts are developed in a separate repository. The only thing this project takes from it is one small file listing the chain, the addresses and the tokens. The server reads that file and passes it to your browser, so no address is baked into the website. If the exchange is ever redeployed, one file changes and everything follows.'),
                        h3('What we ask the chain directly'),
                        p('Anything your trade depends on is read live from the chain, never from our server: the pool’s price, the quote, your balances, your permissions, your positions. They are asked in one bundle so a page loads quickly. The site also checks which version of each contract is actually deployed instead of assuming, because a wrong assumption would quietly produce a broken transaction.'),
                        h3('The server, and why it exists'),
                        p('Some things are nice to have but no trade depends on them: the list of pools, the price chart, how much was traded yesterday, your own history. Those come from our server. It follows the contracts as they emit their events, saves them, and prices each hour of the chart from what the trades themselves reported. Because a block on this chain is final immediately, it never waits. If the chain is ever reset or the exchange redeployed it notices and starts again from the beginning. It also reports how far behind it has fallen, and the site shows a banner when that gets noticeable.'),
                        h3('Prices in dollars'),
                        p('Dollar figures are there to help you read the page, and are never used to execute a trade. The dollar token counts as a dollar. A bridged token is worth whatever it is worth on its home chain, which no pool here can know, so that price comes from outside. Everything else is priced through the deepest pool that connects it to one of those two, in two passes, so a token that only trades against NURA still gets a price. Totals like value locked only count tokens that trace back to a real anchor - otherwise a pool could declare itself rich on a price it made up.'),
                        h3('What the server answers'),
                        table(
                            ['Ask it for', 'And you get'],
                            [
                                ['/api/market/stats', 'Pool count, total value locked, volume over 24 hours, how current it is'],
                                ['/api/market/pools', 'Every pool: its tokens, holdings, price, size, volume and fee return'],
                                ['/api/market/pools/:address', 'One pool, plus 72 hours of chart'],
                                ['/api/market/tokens', 'Every token with a dollar price, and whether that price is anchored'],
                                ['/api/market/txs', 'Recent trades and deposits, filterable by wallet'],
                                ['/api/market/deployment', 'The address file described above'],
                                ['/api/healthz', 'Whether the server is alive']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'application',
                    title: 'The website',
                    blocks: [
                        p('The website is the part you actually touch. It is built to be checked rather than believed - all of it is open source, and it never asks you to trust it with anything.'),
                        ul(
                            'Swap: prices from every fee level, the effect of your own trade, your limits, permission then trade, NURA handled automatically, a chart and recent trades.',
                            'Liquidity: the pools at each fee level with their price and size; your positions with their range and whether they are earning; add, remove and collect, each with a summary before your wallet asks.',
                            'Portfolio: what you hold and what it is worth, your positions, and your own history on the chain.',
                            'Wallets: every browser wallet, quiet reconnection when you come back, the Nura Wallet link, and one button to add Nura Chain - which never switches your network behind your back.',
                            'Ten languages: English, Persian, Arabic, Spanish, Portuguese, Hindi, Chinese, Russian, French and Turkish. Persian and Arabic read right to left, with their own numerals; amounts and addresses always stay in their normal direction.',
                            'A light and a dark theme, a clear outline on whatever you have selected with the keyboard, and calmer motion if your device asks for it.',
                            'The front page and this paper are built ahead of time so they open instantly; the trading pages load when you go to them, and run in your browser, where your wallet is.'
                        )
                    ]
                },
                {
                    id: 'security',
                    title: 'Safety, and what can still go wrong',
                    blocks: [
                        h3('What the contracts guarantee'),
                        ul(
                            'The maths is UniswapV3’s, unchanged. We did not touch the pool, the router or the position code - it is copied in and pinned to a fixed version.',
                            'There is no update button and no administrator over your money. The factory owner can add a fee level and switch on the protocol fee. It cannot reach into a pool or into your position.',
                            'Your price limit and your deadline are checked by the contract. Even if this website were replaced by a hostile copy, those limits would still hold.'
                        ),
                        h3('What the website does'),
                        ul(
                            'There is no key anywhere in the site. Every transaction is signed by your own wallet, in testing and in production alike.',
                            'Strict rules about what the page may load, one address for the site and its data, and limits on how often the server can be called.',
                            'Unknown tokens are labelled before you can trade them, a large price move needs a deliberate confirmation, and unlimited permission is never the default.',
                            'Everything is open source, with tests that check our maths against the original contracts, our server against a scripted chain, and our pages against a stand-in server.'
                        ),
                        callout('An honest word about audits', 'The Uniswap code has been audited many times over the years. This particular deployment of it on Nura Chain has not yet been audited from end to end by an outside firm. That audit is on the roadmap in Part II. Until it is done, please treat this exchange as what it is: pooled money in contracts on a young chain.'),
                        h3('Risks that do not go away'),
                        ul(
                            'A bug nobody has found yet - in the contracts, the chain or a wallet.',
                            'Market risk: the catch described above for suppliers, price movement for traders, and thin trading in a young market.',
                            'Bridge risk: a bridged token is only as good as the bridge holding the real thing.',
                            'Token risk: anyone can create a token and call it anything. A pool existing says nothing about whether the token in it is honest.',
                            'Ordinary breakage: our server or the chain connection can fall behind or stop. Trading carries on, but the numbers on the page may be stale.'
                        )
                    ]
                }
            ]
        },
        {
            id: 'business',
            label: 'Part II',
            title: 'The plan',
            lede: 'Who this is for, how it pays for itself, and what gets built next.',
            sections: [
                {
                    id: 'vision',
                    title: 'What we are trying to do',
                    blocks: [
                        p('Where we want to end up: Nura Chain has a market of its own - somewhere every token on the chain can be priced and traded by anyone, from anywhere, with nobody in the middle.'),
                        p('How we get there: build and run the exchange the chain relies on. The most trusted contracts, the best price data, and a site people can read in their own language - paid for by a fee that is small, visible and enforced by the contract rather than by us.'),
                        p('Nura Swap is plumbing. It succeeds when other things are built on top of it: wallets that quote through it, new tokens that launch on it, apps that read their prices from it.')
                    ]
                },
                {
                    id: 'market',
                    title: 'Who this is for',
                    blocks: [
                        p('Nura Chain is at the stage where its economy is still forming. The coin has holders, the bridge brings BNB and USDT across, and more tokens will arrive as projects launch. All of them need the same thing first: somewhere to trade. Whoever provides that first tends to keep it, because trading attracts money, money attracts trading, and the two together attract everything that would be a nuisance to move later.'),
                        h3('Four kinds of people'),
                        table(
                            ['Who', 'What they need', 'What they get here'],
                            [
                                ['People holding NURA', 'A way to move between NURA, dollars and bridged coins without opening an account anywhere', 'Swaps straight from their own wallet, in their own language, with limits the contract enforces'],
                                ['People with idle tokens', 'A return on tokens that are just sitting there, without losing control of them', 'Supply a pool, choose the range and the fee level, collect earnings whenever they like'],
                                ['New projects on Nura Chain', 'A market for their token on day one, with nobody to ask for permission', 'Anyone can create a pool at any fee level; it is listed and charted automatically'],
                                ['Wallets and other apps', 'Prices and swaps they can build on', 'A public data service, a quoter and router on the chain, and a website they may copy or embed']
                            ]
                        ),
                        h3('Why here, and why now'),
                        ul(
                            'Nobody is here yet. There is no established exchange to displace, and the community already speaks the languages the site ships in.',
                            'The bridge is the front door. BNB and USDT arriving on Nura Chain need somewhere to meet NURA, and this is that place.',
                            'Nura Wallet ships a connector for this exchange, so the chain’s own wallet brings its users straight here.'
                        )
                    ]
                },
                {
                    id: 'value',
                    title: 'How the project pays for itself',
                    blocks: [
                        p('An exchange like this creates value in three places at once. People with idle tokens earn something on them. Traders get a price without needing anyone to take the other side. And the whole chain gets a number for what things are worth. Nura Swap takes a share of the first of those, through one switch built into the contracts.'),
                        h3('The protocol fee'),
                        p('Uniswap’s design lets the factory owner turn on a protocol fee for a pool: between a tenth and a quarter of the fee that trade was already paying. It comes out of the fee, not on top of it, so the trader pays exactly the same either way - the slice simply goes elsewhere. It piles up inside the pool, in the tokens being traded, until it is collected. Today it is off, on every pool.'),
                        p('The plan is to leave it off while the exchange is still gathering liquidity, then turn it on slowly - deepest pools first, at the smallest setting - once suppliers are earning properly, and only after saying so in advance. Every change is a public transaction from a known address, and anyone can watch it happen on the explorer.'),
                        h3('What that adds up to'),
                        table(
                            ['If a day’s trading is', 'Suppliers earn', 'The project’s slice', 'Over a year'],
                            [
                                ['$100,000', '$300', '$60', '$21,900'],
                                ['$1,000,000', '$3,000', '$600', '$219,000'],
                                ['$10,000,000', '$30,000', '$6,000', '$2,190,000']
                            ],
                            [0, 1, 2, 3]
                        ),
                        p('These are illustrations at the 0.30% fee level with a one-fifth slice, not forecasts - the real figure depends on which pools carry the trading. The shape is the point. Income grows with trading, it costs suppliers a fraction of what they earn and traders nothing at all, and it needs no token, no subscription and nobody’s deposits to work.'),
                        h3('Other ways in'),
                        ul(
                            'Helping new projects launch properly - choosing the fee level, setting up the first pool, running a rewards campaign - charged per project.',
                            'Running the price data as a service for wallets and dashboards, while the server itself stays free for anyone to run themselves.',
                            'Grants from Nura Chain for infrastructure the chain needs and this project is well placed to build: routing, price feeds, analytics.'
                        ),
                        callout('There is no Nura Swap token', 'This project has no token of its own and does not need one. NURA pays for transactions, fees arrive in whatever was traded, and the protocol fee is collected the same way. There is no sale, no presale and no airdrop planned. If that ever changed it would be announced on the project’s own channels - never by somebody else, and never in a private message.')
                    ]
                },
                {
                    id: 'go-to-market',
                    title: 'How we grow it',
                    blocks: [
                        steps(
                            { title: 'Launch - already done', text: 'The exchange live on Nura Chain with WNURA, Bridge BNB and Bridge USDT; the server and its data; the site in ten languages; the Nura Wallet connector; release 1.3.0.' },
                            { title: 'Bring in the first suppliers', text: 'Teach people, in Persian and English, what a range actually is and how to read a position - and work with Nura Chain on rewards for the two pools the market is built on: NURA against USDT, and NURA against BNB.' },
                            { title: 'Meet every new project', text: 'Talk to each team launching a token on Nura Chain before they launch: the right fee level, a first pool, a listing and a chart from day one.' },
                            { title: 'Get built into everything else', text: 'Put our quoter and our data in front of wallets, explorers and dashboards, so this exchange’s price becomes the chain’s price, and its router the normal way to swap.' },
                            { title: 'Grow up', text: 'Deepen the pools, add tokens as the bridge grows, switch on the protocol fee, and spend it on the roadmap.' }
                        ),
                        h3('Where we reach people'),
                        ul(
                            'The chain’s own places: Nura Wallet, the explorer, and the Nura Chain community on Telegram, Discord, X and Instagram.',
                            'Documentation and this paper, in the languages the community actually reads.',
                            'Being open source is itself a channel: a site anyone can copy makes it cheap to build on this exchange.'
                        )
                    ]
                },
                {
                    id: 'roadmap',
                    title: 'What comes next',
                    blocks: [
                        p('A direction, not a promise. Things move as the chain and the community do. What has actually shipped is recorded in the changelog, which is public.'),
                        table(
                            ['When', 'What'],
                            [
                                ['Done - Q3 2026', 'The exchange itself; swap, liquidity and portfolio pages; the data server; ten languages including right-to-left; the Nura Wallet connector; an installable app'],
                                ['Q4 2026', 'An outside audit of this deployment; trading through two pools at once when that gives a better price; more history and returns per pool; this paper in more languages'],
                                ['First half of 2027', 'Switching on the protocol fee, and the policy for doing it; a rewards programme with Nura Chain; ranges used as simple limit orders; better tools for managing positions; more bridged tokens as the bridge adds them'],
                                ['Second half of 2027', 'A toolkit for wallets and apps to build on; moving the owner key behind a multi-signature account with published signers; offering the pool prices as a feed other apps on Nura Chain can rely on']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'governance',
                    title: 'Who can change what',
                    blocks: [
                        p('The contracts cannot be changed, so there is very little to govern. One key - the factory owner - has exactly two powers: adding a new fee level, and switching the protocol fee on a pool. It cannot stop a pool, take money, alter a fee level that already exists, or touch anyone’s position. Both powers are used in public, on the chain, where anyone can see them.'),
                        facts(
                            { label: 'The owner key', value: '0x4ac0d9300422b408bA2AbF47995C87cF32763712', mono: true },
                            { label: 'It can', value: 'Add a fee level; switch the protocol fee on a pool' },
                            { label: 'It cannot', value: 'Pause anything, change the code, or move a single token' }
                        ),
                        p('The website and the server are released through the public repository with a changelog, and every release has to pass the same checks before it ships. The server reports whether it is healthy and how current it is, so problems show up quickly. Support and announcements go through the channels listed at the end of this paper - and nowhere else.')
                    ]
                },
                {
                    id: 'metrics',
                    title: 'How to tell if it is working',
                    blocks: [
                        p('You do not have to take our word for any of this. The front page shows the money in the pools, the last day’s trading and the number of pools, live. Every figure below comes from the same public data, and anyone can read it.'),
                        table(
                            ['What we watch', 'Why it matters'],
                            [
                                ['Money in the pools', 'How big a trade the market can take without lurching'],
                                ['Trading in the last 24 hours', 'How busy it is - and what any future fee grows with'],
                                ['Pools and tokens listed', 'How much of the chain is actually tradable'],
                                ['Suppliers, and how many are in range', 'Whether the people funding the pools are doing well'],
                                ['What suppliers earned', 'Whether supplying a pool is worth it'],
                                ['Wallets and apps built on it', 'Whether the exchange has become part of the furniture']
                            ]
                        )
                    ]
                },
                {
                    id: 'risks',
                    title: 'What could go wrong with the plan',
                    blocks: [
                        ul(
                            'Slow growth. A chain’s economy can take longer to form than anyone hoped, and there is no income from trading that never happens.',
                            'Competition. Anyone can copy this code and open a rival. The defence is depth, integrations and trust - not secrecy, which open source rules out anyway.',
                            'The bridge. The first outside value arrives across it, so trouble at the bridge is trouble for the tokens priced through it.',
                            'Regulation. Rules for exchanges like this differ by country and keep changing. We can adapt how the project operates; we cannot adapt the contracts, because nobody can.',
                            'The key. Until the owner key sits behind a multi-signature account, someone stealing it could switch on the protocol fee. They still could not move a single token.',
                            'Security. An undiscovered bug in the contracts, the chain or a wallet could cost people money. The audit on the roadmap reduces that risk. Nothing removes it.'
                        )
                    ]
                },
                {
                    id: 'contracts',
                    title: 'Appendix A: The addresses',
                    blocks: [
                        p('This is what is live on Nura Chain right now, taken from the file described earlier. If you ever interact with one of these directly, check it on the explorer first.'),
                        table(
                            ['What it is', 'Address'],
                            [
                                ['Factory - creates the pools', '0x88E8bB62E1654e695043FD5416D5E5415AFFd39b'],
                                ['Router - does the swaps', '0x98b52fB699F1F91494b2937fECf109f8E09570Ae'],
                                ['Quoter - answers "what would I get?"', '0x4b6f7C7d1337F6C6A624677688EA8035c3Ed6782'],
                                ['Position manager - your receipts', '0xcf00BFaA3c292205D38d37f9086c4F3838339Fbb'],
                                ['Tick lens - reads the ladder', '0xbFdA09e0D89ABa201491F81dcD0993Fd223e66A0'],
                                ['WNURA - NURA as a token', '0xf0a4eC07916feBa4432121Ed5969887D9b939cD0'],
                                ['Multicall - many questions at once', '0xf58884FCf45d8F5Cc8A73c618D23EB27b732CA24'],
                                ['Bridge BNB', '0xD4221Ad9772BF5bA7423a044bBBEe6af2154A5Fc'],
                                ['Bridge USDT', '0x4E0DB0B1Da408faF5637202CF48b0bc7733bE6dC'],
                                ['The owner key', '0x4ac0d9300422b408bA2AbF47995C87cF32763712']
                            ],
                            [1]
                        ),
                        facts(
                            { label: 'Chain id', value: '1020', mono: true },
                            { label: 'Deployed at block', value: '124110', mono: true },
                            { label: 'Decimals', value: '18 - on every listed token', mono: true }
                        )
                    ]
                },
                {
                    id: 'glossary',
                    title: 'Appendix B: Words used in this paper',
                    blocks: [
                        table(
                            ['Word', 'What it means'],
                            [
                                ['AMM', 'Automated market maker: a contract that quotes a price from what it holds, instead of matching buyers with sellers.'],
                                ['Pool', 'One contract holding two tokens at one fee level. A pair of tokens can have up to four.'],
                                ['Fee level', 'What a pool charges on each trade: 0.01%, 0.05%, 0.30% or 1.00%.'],
                                ['Tick', 'One rung on the price ladder. Each rung is 0.01% above the one below.'],
                                ['Tick spacing', 'How many rungs apart a fee level lets you set the ends of a range: 1, 10, 60 or 200.'],
                                ['sqrtPriceX96', 'The pool’s price, kept as a square root and stored as a whole number so nothing is rounded away.'],
                                ['Liquidity (L)', 'How much money is behind the price - the pool’s depth at the rung it is on.'],
                                ['Position', 'Your receipt for supplying a pool: which pool, which range, how much.'],
                                ['In range', 'The price is between the two ends of your range, so you hold both tokens and are earning fees.'],
                                ['Price impact', 'How far your own trade pushes the price, before the fee.'],
                                ['Slippage tolerance', 'The worst price you are willing to accept. Past it, the contract cancels the trade.'],
                                ['Deadline', 'The time after which the contract refuses to run your trade at all.'],
                                ['Quoter', 'A contract that pretends to do a swap and reports what you would get, without doing it.'],
                                ['Router', 'The contract that carries out swaps, wrapping and unwrapping NURA when needed.'],
                                ['Position manager', 'The contract that issues, changes and closes positions, and pays out their fees.'],
                                ['WNURA', 'NURA in token form, exchangeable one for one, because pools can only hold tokens.'],
                                ['Protocol fee', 'An optional slice of the trading fee that the factory owner can redirect to the project.'],
                                ['Impermanent loss', 'Ending up with less than if you had simply held your two tokens and done nothing.'],
                                ['TVL', 'Total value locked: what everything in the pools is worth, counting only prices we can anchor.'],
                                ['Indexer', 'Our server: it follows the contracts and keeps the history the site shows.']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'links',
                    title: 'Appendix C: Where to find us',
                    blocks: [
                        table(
                            ['What', 'Where'],
                            [
                                ['Source code - website, server and maths', 'https://github.com/NuraChain/Swap'],
                                ['Nura Chain connection point', 'https://rpc.nurachain.net'],
                                ['Block explorer', 'https://explorer.nurachain.net'],
                                ['X', 'https://x.com/nurachainnet'],
                                ['Discord', 'https://discord.gg/8BMAXTdXQg'],
                                ['Telegram', 'https://t.me/nurachain'],
                                ['Instagram', 'https://www.instagram.com/nura.chain/']
                            ],
                            [1]
                        ),
                        ol(
                            'Adams, Zinsmeister, Salem, Keefer, Robinson - Uniswap v3 Core (2021). The paper this exchange’s maths comes from.',
                            'The Nura Swap repository - README, CHANGELOG and TESTING, for the parts of the system described here.'
                        )
                    ]
                }
            ]
        }
    ]
};
