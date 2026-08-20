// CLIENT-SAFE: the application imports this file, so it may import only the
// schema package. Wire shapes for the market API. Raw on-chain amounts cross as
// decimal strings (bigint-safe); USD figures cross as numbers (display precision).

import { array, boolean, enumOf, number, object, string, type Infer } from '@azerothjs/schema';

const tokenShape = {
    address: string(),
    symbol: string(),
    name: string(),
    decimals: number({ int: true })
};
export const tokenRef = object(tokenShape);
export type TokenRef = Infer<typeof tokenRef>;

export const tokenWithPrice = object({
    ...tokenShape,
    priceUsd: number()
});
export type TokenWithPrice = Infer<typeof tokenWithPrice>;

export const stats = object({
    chainId: number({ int: true }),
    pairCount: number({ int: true }),
    // The factory's swapFee, in bps. On the wire because the fee is the chain's
    // to decide and the client would otherwise print a number of its own.
    swapFeeBps: number({ int: true }),
    tvlUsd: number(),
    volume24hUsd: number(),
    indexedBlock: number({ int: true }),
    blocksBehind: number({ int: true })
});
export type Stats = Infer<typeof stats>;

const poolShape = {
    address: string(),
    token0: tokenRef,
    token1: tokenRef,
    reserve0: string(),
    reserve1: string(),
    priceWad: string(),
    tvlUsd: number(),
    volume24hUsd: number(),
    feeAprBps: number({ int: true })
};
export const pool = object(poolShape);
export type Pool = Infer<typeof pool>;

export const candle = object({
    hourStart: number({ int: true }),
    open: string(),
    high: string(),
    low: string(),
    close: string(),
    volume0: string(),
    volume1: string()
});
export type Candle = Infer<typeof candle>;

export const poolDetail = object({
    ...poolShape,
    candles: array(candle)
});
export type PoolDetail = Infer<typeof poolDetail>;

export const txItem = object({
    txHash: string(),
    kind: enumOf(['swap', 'mint', 'burn']),
    timestamp: number({ int: true }),
    account: string(),
    pairAddress: string(),
    tokenA: tokenRef,
    amountA: string(),
    tokenB: tokenRef,
    amountB: string()
});
export type TxItem = Infer<typeof txItem>;

export const deploymentInfo = object({
    chainId: number({ int: true }),
    networkName: string(),
    rpcUrl: string(),
    explorerUrl: string().nullable(),
    faucet: boolean(),
    contracts: object({
        factory: string(),
        router: string(),
        wnura: string(),
        multicall3: string()
    }),
    // UniswapV3, or null on a chain that carries the V2 factory alone. The app
    // reads this to decide whether the protocol switch exists at all - a missing
    // block hides the V3 half rather than pointing it at a zero address.
    v3: object({
        factory: string(),
        swapRouter: string(),
        quoter: string(),
        positionManager: string(),
        tickLens: string()
    }).nullable(),
    tokens: array(tokenRef)
});
export type DeploymentInfo = Infer<typeof deploymentInfo>;
