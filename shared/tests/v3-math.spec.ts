import { describe, expect, it } from 'vitest';

import { WAD } from '../src/math.ts';
import {
    FEE_TIERS,
    MAX_SQRT_RATIO,
    MAX_TICK,
    MIN_SQRT_RATIO,
    MIN_TICK,
    Q96,
    counterpartAmount,
    getAmount0Delta,
    getAmount1Delta,
    getAmountsForLiquidity,
    getLiquidityForAmounts,
    getSqrtRatioAtTick,
    getTickAtSqrtRatio,
    nearestUsableTick,
    priceImpactBpsFromMid,
    priceWadFromSqrtX96,
    priceWadToTick,
    rawPriceWadFromSqrtX96,
    tickSpacingForFee,
    tickToPriceWad
} from '../src/v3-math.ts';

describe('getSqrtRatioAtTick', () =>
{
    // The three fixed points of the audited TickMath. If a constant were
    // mistyped these are the first values to move.
    it('pins the boundaries the Solidity library pins', () =>
    {
        expect(getSqrtRatioAtTick(0)).toBe(Q96);
        expect(getSqrtRatioAtTick(MIN_TICK)).toBe(MIN_SQRT_RATIO);
        expect(getSqrtRatioAtTick(MAX_TICK)).toBe(MAX_SQRT_RATIO);
    });

    it('is strictly increasing in the tick', () =>
    {
        let previous = getSqrtRatioAtTick(-500);
        for (let tick = -499; tick <= 500; tick++)
        {
            const current = getSqrtRatioAtTick(tick);
            expect(current > previous).toBe(true);
            previous = current;
        }
    });

    it('steps by 1.0001 per tick', () =>
    {
        // (ratio(1)/ratio(0))^2 is 1.0001 - the tick base - to 12 places.
        const ratio = Number(getSqrtRatioAtTick(1)) / Number(getSqrtRatioAtTick(0));
        expect(ratio * ratio).toBeCloseTo(1.0001, 12);
    });

    it('refuses a tick outside the range', () =>
    {
        expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow(RangeError);
        expect(() => getSqrtRatioAtTick(MIN_TICK - 1)).toThrow(RangeError);
    });
});

describe('getTickAtSqrtRatio', () =>
{
    it('inverts getSqrtRatioAtTick exactly', () =>
    {
        for (const tick of [MIN_TICK, -887000, -100_000, -60, -1, 0, 1, 60, 100_000, 887000, MAX_TICK])
        {
            expect(getTickAtSqrtRatio(getSqrtRatioAtTick(tick))).toBe(tick);
        }
    });

    // The contract's definition: the GREATEST tick whose ratio is still at or
    // below the price. A price one wei under a boundary belongs to the tick below.
    it('floors a price between two ticks', () =>
    {
        const boundary = getSqrtRatioAtTick(4242);
        expect(getTickAtSqrtRatio(boundary + 1n)).toBe(4242);
        expect(getTickAtSqrtRatio(boundary - 1n)).toBe(4241);
    });

    it('refuses a price outside the range', () =>
    {
        expect(() => getTickAtSqrtRatio(MIN_SQRT_RATIO - 1n)).toThrow(RangeError);
        expect(() => getTickAtSqrtRatio(MAX_SQRT_RATIO + 1n)).toThrow(RangeError);
    });
});

describe('priceWadFromSqrtX96', () =>
{
    it('reads 1.0 at tick zero when the decimals match', () =>
    {
        expect(priceWadFromSqrtX96(Q96, 18, 18)).toBe(WAD);
    });

    // The USDC/WETH shape: 6-decimal token0 against an 18-decimal token1. The
    // raw ratio is tiny; the decimals adjustment is what makes it a price.
    it('folds in the decimals gap', () =>
    {
        const price = priceWadFromSqrtX96(Q96, 6, 18);
        expect(price).toBe(WAD / 10n ** 12n);
    });

    it('is zero for an uninitialized pool', () =>
    {
        expect(priceWadFromSqrtX96(0n, 18, 18)).toBe(0n);
    });

    it('round-trips a price through the tick grid', () =>
    {
        // 1500 token1 per token0, both 18 decimals. Ticks are 1.0001 apart, so
        // the round trip lands within one tick - never further.
        const price = 1500n * WAD;
        const tick = priceWadToTick(price, 18, 18);
        const back = tickToPriceWad(tick, 18, 18);
        expect(back <= price).toBe(true);
        expect(back > (price * 9999n) / 10_000n).toBe(true);
    });
});

describe('rawPriceWadFromSqrtX96', () =>
{
    it('inverts with the direction', () =>
    {
        const sqrtPrice = getSqrtRatioAtTick(20_000);
        const forward = rawPriceWadFromSqrtX96(sqrtPrice, true);
        const backward = rawPriceWadFromSqrtX96(sqrtPrice, false);
        // forward * backward is 1e36 to within the truncation of two divisions.
        const product = (forward * backward) / WAD;
        expect(product > (WAD * 9_999_999n) / 10_000_000n).toBe(true);
        expect(product < (WAD * 10_000_001n) / 10_000_000n).toBe(true);
    });
});

describe('priceImpactBpsFromMid', () =>
{
    it('reports zero when the fill matches the fee-free mid', () =>
    {
        // 1000 in at mid 1.0 with a 0.3% fee fills 997 - that is the fee, not impact.
        expect(priceImpactBpsFromMid(1000n, 997n, WAD, 3000)).toBe(0);
    });

    it('charges the shortfall below the mid, fee excluded', () =>
    {
        // Half of what the fee-free mid would give is 5000 bps of impact.
        expect(priceImpactBpsFromMid(1000n, 500n, WAD, 0)).toBe(5000);
    });

    it('is zero for an empty or nonsensical quote', () =>
    {
        expect(priceImpactBpsFromMid(0n, 100n, WAD, 500)).toBe(0);
        expect(priceImpactBpsFromMid(100n, 0n, WAD, 500)).toBe(0);
        expect(priceImpactBpsFromMid(100n, 100n, 0n, 500)).toBe(0);
    });
});

describe('range amounts', () =>
{
    const lower = getSqrtRatioAtTick(-600);
    const upper = getSqrtRatioAtTick(600);
    const current = getSqrtRatioAtTick(0);

    it('holds only token0 below its range and only token1 above it', () =>
    {
        const below = getAmountsForLiquidity(getSqrtRatioAtTick(-1200), lower, upper, 10n ** 18n);
        expect(below.amount1).toBe(0n);
        expect(below.amount0 > 0n).toBe(true);

        const above = getAmountsForLiquidity(getSqrtRatioAtTick(1200), lower, upper, 10n ** 18n);
        expect(above.amount0).toBe(0n);
        expect(above.amount1 > 0n).toBe(true);
    });

    it('holds both sides in range, and symmetrically around tick zero', () =>
    {
        const inside = getAmountsForLiquidity(current, lower, upper, 10n ** 18n);
        expect(inside.amount0 > 0n).toBe(true);
        expect(inside.amount1 > 0n).toBe(true);
        // A range centred on tick 0 with equal decimals is balanced; allow a
        // wei-level gap from the two roundings.
        const gap = inside.amount0 > inside.amount1 ? inside.amount0 - inside.amount1 : inside.amount1 - inside.amount0;
        expect(gap < inside.amount0 / 1_000_000n + 2n).toBe(true);
    });

    it('round-trips liquidity through the amounts it implies', () =>
    {
        const liquidity = getLiquidityForAmounts(current, lower, upper, 10n ** 18n, 10n ** 18n);
        expect(liquidity > 0n).toBe(true);
        const amounts = getAmountsForLiquidity(current, lower, upper, liquidity);
        // Rounding is toward the pool, so the amounts never EXCEED what was offered.
        expect(amounts.amount0 <= 10n ** 18n).toBe(true);
        expect(amounts.amount1 <= 10n ** 18n).toBe(true);
    });

    it('takes the binding side when the two amounts do not match the range', () =>
    {
        // Ten times more token1 than the range can use: the liquidity is set by
        // token0, and the deposit takes only the token1 that pairs with it.
        const liquidity = getLiquidityForAmounts(current, lower, upper, 10n ** 18n, 10n ** 19n);
        const amounts = getAmountsForLiquidity(current, lower, upper, liquidity);
        expect(amounts.amount1 < 10n ** 19n).toBe(true);
    });

    it('deltas grow with liquidity and vanish on an empty position', () =>
    {
        expect(getAmount0Delta(lower, upper, 0n, true)).toBe(0n);
        expect(getAmount1Delta(lower, upper, 0n, true)).toBe(0n);
        expect(getAmount0Delta(lower, upper, 10n ** 18n, true) >= getAmount0Delta(lower, upper, 10n ** 18n, false)).toBe(true);
        expect(getAmount1Delta(lower, upper, 10n ** 18n, true) >= getAmount1Delta(lower, upper, 10n ** 18n, false)).toBe(true);
    });

    it('argument order does not change a delta', () =>
    {
        expect(getAmount0Delta(upper, lower, 10n ** 18n, false)).toBe(getAmount0Delta(lower, upper, 10n ** 18n, false));
        expect(getAmount1Delta(upper, lower, 10n ** 18n, false)).toBe(getAmount1Delta(lower, upper, 10n ** 18n, false));
    });
});

describe('counterpartAmount', () =>
{
    const lower = getSqrtRatioAtTick(-600);
    const upper = getSqrtRatioAtTick(600);

    it('asks for the second token only while the price is inside the range', () =>
    {
        const inRange = counterpartAmount(getSqrtRatioAtTick(0), lower, upper, { side: 0, amount: 10n ** 18n });
        expect(inRange > 0n).toBe(true);

        // Price below the range: the position is pure token0, so depositing
        // token0 needs no token1 at all.
        const below = counterpartAmount(getSqrtRatioAtTick(-1200), lower, upper, { side: 0, amount: 10n ** 18n });
        expect(below).toBe(0n);
    });

    it('works from either side', () =>
    {
        const from1 = counterpartAmount(getSqrtRatioAtTick(0), lower, upper, { side: 1, amount: 10n ** 18n });
        expect(from1 > 0n).toBe(true);
    });

    it('is zero for a zero deposit', () =>
    {
        expect(counterpartAmount(getSqrtRatioAtTick(0), lower, upper, { side: 0, amount: 0n })).toBe(0n);
    });
});

describe('tick spacing', () =>
{
    it('snaps to the pool grid and stays inside the range', () =>
    {
        expect(nearestUsableTick(59, 60)).toBe(60);
        expect(nearestUsableTick(-59, 60)).toBe(-60);
        expect(nearestUsableTick(29, 60)).toBe(0);
        expect(nearestUsableTick(MAX_TICK, 60)).toBeLessThanOrEqual(MAX_TICK);
        expect(nearestUsableTick(MIN_TICK, 60)).toBeGreaterThanOrEqual(MIN_TICK);
    });

    // The bound a full-range position asks for. Clamping to MIN_TICK/MAX_TICK
    // themselves lands OFF the grid at every spacing, and a mint on an off-grid
    // bound reverts - so the clamp has to stop at the last usable multiple.
    it('stays on the grid at the extremes', () =>
    {
        for (const spacing of [1, 10, 60, 200])
        {
            const low = nearestUsableTick(MIN_TICK, spacing);
            const high = nearestUsableTick(MAX_TICK, spacing);
            // Integer division, not `% === 0`: a negative multiple leaves -0,
            // and -0 is not 0 to a strict equality matcher.
            expect(Number.isInteger(low / spacing)).toBe(true);
            expect(Number.isInteger(high / spacing)).toBe(true);
            expect(low).toBeGreaterThanOrEqual(MIN_TICK);
            expect(high).toBeLessThanOrEqual(MAX_TICK);
        }
    });

    it('keeps every snapped tick on the grid', () =>
    {
        for (const tick of [-887_000, -60_001, -1, 0, 1, 4243, 60_001, 887_000])
        {
            expect(Number.isInteger(nearestUsableTick(tick, 60) / 60)).toBe(true);
            expect(Number.isInteger(nearestUsableTick(tick, 200) / 200)).toBe(true);
        }
    });

    it('knows the canonical factory tiers', () =>
    {
        expect(FEE_TIERS.map((tier) => tier.fee)).toEqual([100, 500, 3000, 10_000]);
        expect(tickSpacingForFee(500)).toBe(10);
        expect(tickSpacingForFee(3000)).toBe(60);
        // An unenabled fee is not a crash - it falls back to the common spacing.
        expect(tickSpacingForFee(1234)).toBe(60);
    });
});
