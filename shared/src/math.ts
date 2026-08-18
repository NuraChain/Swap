// All Nura Swap quote and pricing math, bigint end to end. Raw on-chain amounts
// never pass through Number: an 18-decimal reserve overflows the float mantissa
// long before it overflows a pool.

export const FEE_NUMERATOR = 997n;
export const FEE_DENOMINATOR = 1000n;
export const WAD = 10n ** 18n;
export const BPS = 10_000n;

export function pow10(exponent: number): bigint
{
    return 10n ** BigInt(exponent);
}

// Mirrors UniswapV2Library.getAmountOut. Returns 0n instead of reverting on an
// empty pool so callers can render "no route" without try/catch.
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint
{
    if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n)
    {
        return 0n;
    }
    const amountInWithFee = amountIn * FEE_NUMERATOR;
    return (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
}

// Mirrors UniswapV2Library.getAmountIn (rounds up). 0n when unachievable.
export function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint
{
    if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= amountOut)
    {
        return 0n;
    }
    const numerator = reserveIn * amountOut * FEE_DENOMINATOR;
    const denominator = (reserveOut - amountOut) * FEE_NUMERATOR;
    return numerator / denominator + 1n;
}

// Mirrors UniswapV2Library.quote - the add-liquidity ratio fill.
export function quote(amountA: bigint, reserveA: bigint, reserveB: bigint): bigint
{
    if (amountA <= 0n || reserveA <= 0n || reserveB <= 0n)
    {
        return 0n;
    }
    return (amountA * reserveB) / reserveA;
}

// Price impact of a swap in basis points, measured against the fee-free mid
// price. Comparing against the raw execution price would report the 0.3% fee as
// phantom impact on every quote.
export function priceImpactBps(amountIn: bigint, amountOut: bigint, reserveIn: bigint, reserveOut: bigint): number
{
    if (amountIn <= 0n || amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n)
    {
        return 0;
    }
    const feeAdjustedIn = (amountIn * FEE_NUMERATOR) / FEE_DENOMINATOR;
    const midOut = (feeAdjustedIn * reserveOut) / reserveIn;
    if (midOut <= amountOut)
    {
        return 0;
    }
    return Number(((midOut - amountOut) * BPS) / midOut);
}

export function minOutForSlippage(amountOut: bigint, slippageBps: number): bigint
{
    return (amountOut * (BPS - BigInt(slippageBps))) / BPS;
}

export function maxInForSlippage(amountIn: bigint, slippageBps: number): bigint
{
    return (amountIn * (BPS + BigInt(slippageBps))) / BPS;
}

// Integer sqrt (Babylonian), the Pair's first-mint LP formula companion.
export function sqrtBigint(value: bigint): bigint
{
    if (value < 0n)
    {
        throw new RangeError('sqrt of negative');
    }
    if (value < 2n)
    {
        return value;
    }
    let x = value;
    let y = (x + 1n) / 2n;
    while (y < x)
    {
        x = y;
        y = (x + value / x) / 2n;
    }
    return x;
}

// Normalizes a raw token amount to 1e18 fixed point regardless of decimals.
export function scaleToWad(amount: bigint, decimals: number): bigint
{
    if (decimals === 18)
    {
        return amount;
    }
    if (decimals < 18)
    {
        return amount * pow10(18 - decimals);
    }
    return amount / pow10(decimals - 18);
}

// Price of the base token in quote units as 1e18 fixed point.
export function priceFromReserves(
    reserveBase: bigint,
    baseDecimals: number,
    reserveQuote: bigint,
    quoteDecimals: number
): bigint
{
    if (reserveBase <= 0n || reserveQuote <= 0n)
    {
        return 0n;
    }
    return (scaleToWad(reserveQuote, quoteDecimals) * WAD) / scaleToWad(reserveBase, baseDecimals);
}

// USD value (1e18 fixed point) of a raw token amount, given a 1e18 USD price.
export function usdValue(amount: bigint, decimals: number, priceUsdWad: bigint): bigint
{
    return (scaleToWad(amount, decimals) * priceUsdWad) / WAD;
}
