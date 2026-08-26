// UniswapV3 math, bigint end to end - the Q64.96 half of this exchange.
//
// A V3 pool's balances are NOT its price: liquidity sits inside tick ranges and
// the price lives in a single Q64.96 square root, `sqrtPriceX96`. A pool holding
// 10 WNURA and 3000 USDT is not quoting 300 - the balances say only what the
// range happens to hold at this instant. Every price, tick and position amount
// is computed here, which is why they all live in one file.
//
// The tick and liquidity routines are ports of the audited Solidity (TickMath,
// SqrtPriceMath, LiquidityAmounts) with the same rounding, so a number this file
// computes and a number the pool computes agree to the wei - a mint quoted with
// looser math would ask the position manager for an amount it then refuses.

import { WAD, pow10, sqrtBigint } from './math.ts';

export const Q96 = 1n << 96n;
export const Q192 = Q96 * Q96;
const MAX_UINT256 = (1n << 256n) - 1n;

// The tick range a V3 pool can address: 1.0001^887272 covers roughly 2^128,
// which is the whole representable price space.
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

/** Fee tiers are parts per MILLION on V3 (500 = 0.05%), not basis points. */
export const FEE_PPM = 1_000_000n;

// The tick spacings the canonical factory enables. A pool at fee f may only have
// its bounds on multiples of spacing[f] - a range picked off this grid reverts.
export const FEE_TIERS: ReadonlyArray<{ fee: number; tickSpacing: number }> = [
    { fee: 100, tickSpacing: 1 },
    { fee: 500, tickSpacing: 10 },
    { fee: 3000, tickSpacing: 60 },
    { fee: 10_000, tickSpacing: 200 }
];

export function tickSpacingForFee(fee: number): number
{
    return FEE_TIERS.find((tier) => tier.fee === fee)?.tickSpacing ?? 60;
}

function mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint
{
    const product = a * b;
    const quotient = product / denominator;
    return product % denominator === 0n ? quotient : quotient + 1n;
}

// TickMath.getSqrtRatioAtTick, constant for constant. The magic numbers are
// 1.0001^(-2^n) in Q128.128; multiplying the ones selected by the bits of |tick|
// walks the exponent in log time, and the final shift lands it in Q64.96.
export function getSqrtRatioAtTick(tick: number): bigint
{
    const absTick = BigInt(tick < 0 ? -tick : tick);
    if (absTick > BigInt(MAX_TICK))
    {
        throw new RangeError(`tick ${ tick } is outside the representable range`);
    }
    let ratio = (absTick & 0x1n) !== 0n
        ? 0xfffcb933bd6fad37aa2d162d1a594001n
        : 0x100000000000000000000000000000000n;
    const factors: Array<[bigint, bigint]> = [
        [0x2n, 0xfff97272373d413259a46990580e213an],
        [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
        [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
        [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
        [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
        [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
        [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
        [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
        [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
        [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
        [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
        [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
        [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
        [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
        [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
        [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
        [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
        [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
        [0x80000n, 0x48a170391f7dc42444e8fa2n]
    ];
    for (const [bit, factor] of factors)
    {
        if ((absTick & bit) !== 0n)
        {
            ratio = (ratio * factor) >> 128n;
        }
    }
    if (tick > 0)
    {
        ratio = MAX_UINT256 / ratio;
    }
    // Q128.128 -> Q64.96, rounding UP so the ratio never lands below the tick it
    // names: the pool's own conversion rounds the same way, and a sqrt price a
    // single wei short of a boundary is a different tick.
    return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

// The inverse: the greatest tick whose ratio is still at or below this price.
// The Solidity version does it with a hand-unrolled log2; a binary search over
// the 21-bit tick space costs 21 forward conversions, needs no float anywhere,
// and cannot disagree with getSqrtRatioAtTick because it only ever calls it.
export function getTickAtSqrtRatio(sqrtPriceX96: bigint): number
{
    if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO)
    {
        throw new RangeError('sqrt price is outside the representable range');
    }
    let low = MIN_TICK;
    let high = MAX_TICK;
    while (low < high)
    {
        const middle = Math.ceil((low + high) / 2);
        if (getSqrtRatioAtTick(middle) <= sqrtPriceX96)
        {
            low = middle;
        }
        else
        {
            high = middle - 1;
        }
    }
    return low;
}

/**
 * Snaps a tick to the pool's grid; bounds off the grid are rejected on mint.
 *
 * The clamp is to the outermost tick that is BOTH inside the representable range
 * and on the grid - not to MIN_TICK/MAX_TICK themselves, which are prime-ish
 * numbers no spacing divides. Clamping to those produced the one range every
 * position UI reaches for first, full range, as a pair of bounds the pool
 * rejects.
 */
export function nearestUsableTick(tick: number, tickSpacing: number): number
{
    const rounded = Math.round(tick / tickSpacing) * tickSpacing;
    const lowest = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
    const highest = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
    return Math.min(highest, Math.max(lowest, rounded));
}

// Price of token0 in token1 units as 1e18 fixed point - the scale every pool
// row, chart and USD price map in this repo carries.
export function priceWadFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): bigint
{
    if (sqrtPriceX96 <= 0n)
    {
        return 0n;
    }
    return (sqrtPriceX96 * sqrtPriceX96 * WAD * pow10(decimals0)) / (Q192 * pow10(decimals1));
}

/** The inverse, for turning a typed price bound back into a tick. */
export function sqrtX96FromPriceWad(priceWad: bigint, decimals0: number, decimals1: number): bigint
{
    if (priceWad <= 0n)
    {
        return MIN_SQRT_RATIO;
    }
    const squared = (priceWad * Q192 * pow10(decimals1)) / (WAD * pow10(decimals0));
    const root = sqrtBigint(squared);
    return root < MIN_SQRT_RATIO ? MIN_SQRT_RATIO : root > MAX_SQRT_RATIO ? MAX_SQRT_RATIO : root;
}

export function tickToPriceWad(tick: number, decimals0: number, decimals1: number): bigint
{
    return priceWadFromSqrtX96(getSqrtRatioAtTick(tick), decimals0, decimals1);
}

export function priceWadToTick(priceWad: bigint, decimals0: number, decimals1: number): number
{
    return getTickAtSqrtRatio(sqrtX96FromPriceWad(priceWad, decimals0, decimals1));
}

// Raw output units per raw input unit, 1e18 fixed point - decimals deliberately
// NOT applied. Price impact compares two raw amounts from the same pool, so the
// decimals cancel; folding them in here would only add a rounding step.
export function rawPriceWadFromSqrtX96(sqrtPriceX96: bigint, zeroForOne: boolean): bigint
{
    if (sqrtPriceX96 <= 0n)
    {
        return 0n;
    }
    return zeroForOne
        ? (sqrtPriceX96 * sqrtPriceX96 * WAD) / Q192
        : (Q192 * WAD) / (sqrtPriceX96 * sqrtPriceX96);
}

// Price impact in basis points against the fee-free mid price, so the number on
// screen measures the pool moving - never the fee being charged.
export function priceImpactBpsFromMid(
    amountIn: bigint,
    amountOut: bigint,
    midPriceRawWad: bigint,
    feePpm: number
): number
{
    if (amountIn <= 0n || amountOut <= 0n || midPriceRawWad <= 0n)
    {
        return 0;
    }
    const feeAdjustedIn = (amountIn * (FEE_PPM - BigInt(feePpm))) / FEE_PPM;
    const midOut = (feeAdjustedIn * midPriceRawWad) / WAD;
    if (midOut <= amountOut)
    {
        return 0;
    }
    return Number(((midOut - amountOut) * 10_000n) / midOut);
}

// SqrtPriceMath.getAmount0Delta: the token0 a range holds between two prices.
export function getAmount0Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint
{
    const [lower, upper] = sqrtA > sqrtB ? [sqrtB, sqrtA] : [sqrtA, sqrtB];
    if (lower <= 0n || liquidity <= 0n)
    {
        return 0n;
    }
    const numerator1 = liquidity << 96n;
    const numerator2 = upper - lower;
    return roundUp
        ? mulDivRoundingUp(mulDivRoundingUp(numerator1, numerator2, upper), 1n, lower)
        : (numerator1 * numerator2) / upper / lower;
}

// SqrtPriceMath.getAmount1Delta: the token1 side of the same range.
export function getAmount1Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint
{
    const [lower, upper] = sqrtA > sqrtB ? [sqrtB, sqrtA] : [sqrtA, sqrtB];
    if (liquidity <= 0n)
    {
        return 0n;
    }
    return roundUp
        ? mulDivRoundingUp(liquidity, upper - lower, Q96)
        : (liquidity * (upper - lower)) / Q96;
}

export function getLiquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint
{
    const [lower, upper] = sqrtA > sqrtB ? [sqrtB, sqrtA] : [sqrtA, sqrtB];
    if (upper <= lower)
    {
        return 0n;
    }
    const intermediate = (lower * upper) / Q96;
    return (amount0 * intermediate) / (upper - lower);
}

export function getLiquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint
{
    const [lower, upper] = sqrtA > sqrtB ? [sqrtB, sqrtA] : [sqrtA, sqrtB];
    if (upper <= lower)
    {
        return 0n;
    }
    return (amount1 * Q96) / (upper - lower);
}

// LiquidityAmounts.getLiquidityForAmounts. Below its range a position is pure
// token0, above it pure token1, and inside it the binding side is whichever runs
// out first - which is why the in-range case takes the MINIMUM rather than
// trusting the amount the user typed on either side.
export function getLiquidityForAmounts(
    sqrtPrice: bigint,
    sqrtLower: bigint,
    sqrtUpper: bigint,
    amount0: bigint,
    amount1: bigint
): bigint
{
    const [lower, upper] = sqrtLower > sqrtUpper ? [sqrtUpper, sqrtLower] : [sqrtLower, sqrtUpper];
    if (sqrtPrice <= lower)
    {
        return getLiquidityForAmount0(lower, upper, amount0);
    }
    if (sqrtPrice < upper)
    {
        const from0 = getLiquidityForAmount0(sqrtPrice, upper, amount0);
        const from1 = getLiquidityForAmount1(lower, sqrtPrice, amount1);
        return from0 < from1 ? from0 : from1;
    }
    return getLiquidityForAmount1(lower, upper, amount1);
}

// LiquidityAmounts.getAmountsForLiquidity - what a position of this size is
// worth at this price. Rounds DOWN, matching the burn side of the pool: a
// withdrawal estimate that rounded up would promise a wei the pool will not pay.
export function getAmountsForLiquidity(
    sqrtPrice: bigint,
    sqrtLower: bigint,
    sqrtUpper: bigint,
    liquidity: bigint
): { amount0: bigint; amount1: bigint }
{
    const [lower, upper] = sqrtLower > sqrtUpper ? [sqrtUpper, sqrtLower] : [sqrtLower, sqrtUpper];
    if (sqrtPrice <= lower)
    {
        return { amount0: getAmount0Delta(lower, upper, liquidity, false), amount1: 0n };
    }
    if (sqrtPrice < upper)
    {
        return {
            amount0: getAmount0Delta(sqrtPrice, upper, liquidity, false),
            amount1: getAmount1Delta(lower, sqrtPrice, liquidity, false)
        };
    }
    return { amount0: 0n, amount1: getAmount1Delta(lower, upper, liquidity, false) };
}

// The counterpart amount a mint will actually take, given one side and a range.
// Out of range only ONE token is deposited - a UI that keeps asking for both
// would have the user approve a token the position manager never pulls.
export function counterpartAmount(
    sqrtPrice: bigint,
    sqrtLower: bigint,
    sqrtUpper: bigint,
    known: { side: 0 | 1; amount: bigint }
): bigint
{
    if (known.amount <= 0n)
    {
        return 0n;
    }
    const liquidity = known.side === 0
        ? getLiquidityForAmounts(sqrtPrice, sqrtLower, sqrtUpper, known.amount, MAX_UINT256)
        : getLiquidityForAmounts(sqrtPrice, sqrtLower, sqrtUpper, MAX_UINT256, known.amount);
    if (liquidity <= 0n)
    {
        return 0n;
    }
    const amounts = getAmountsForLiquidity(sqrtPrice, sqrtLower, sqrtUpper, liquidity);
    return known.side === 0 ? amounts.amount1 : amounts.amount0;
}
