// Shared numeric helpers for Nura Swap, bigint end to end. Raw on-chain amounts
// never pass through Number: an 18-decimal amount overflows the float mantissa
// long before it overflows a pool. Uniswap V3 pricing and liquidity maths live
// next door in v3-math.ts; this module carries only protocol-neutral utilities.

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
/** The ERC-20 "approve everything" amount, shared by every approve flow. */
export const MAX_UINT256 = (1n << 256n) - 1n;

export function pow10(exponent: number): bigint
{
    return 10n ** BigInt(exponent);
}

export function minOutForSlippage(amountOut: bigint, slippageBps: number): bigint
{
    return (amountOut * (BPS - BigInt(slippageBps))) / BPS;
}

export function maxInForSlippage(amountIn: bigint, slippageBps: number): bigint
{
    return (amountIn * (BPS + BigInt(slippageBps))) / BPS;
}

// Integer sqrt (Babylonian). v3-math's sqrtX96FromPriceWad needs a square root
// that never loses a unit of precision to Number.
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

// USD value (1e18 fixed point) of a raw token amount, given a 1e18 USD price.
export function usdValue(amount: bigint, decimals: number, priceUsdWad: bigint): bigint
{
    return (scaleToWad(amount, decimals) * priceUsdWad) / WAD;
}
