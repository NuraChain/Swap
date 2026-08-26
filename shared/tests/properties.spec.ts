// Property and fuzz coverage for the pure libraries every price on screen
// is computed from. The hand-written specs next to this file pin the values that
// matter; these pin the LAWS - the things that must hold for inputs nobody
// thought to write down, which is where a rounding direction or an overflow
// hides.
//
// The generator is a seeded LCG rather than a property-testing dependency: the
// inputs here are bigints in known ranges, the seeds are fixed, and a failure
// reports the exact operands. Nothing is left to a random seed on CI.

import { describe, expect, it } from 'vitest';

import {
    WAD,
    maxInForSlippage,
    minOutForSlippage,
    pow10,
    scaleToWad,
    sqrtBigint,
    usdValue
} from '../src/math.ts';
import { formatTokenAmount, normalizeDigits, parseTokenAmount } from '../src/digits.ts';
import {
    MAX_SQRT_RATIO,
    MAX_TICK,
    MIN_SQRT_RATIO,
    MIN_TICK,
    counterpartAmount,
    getAmount0Delta,
    getAmount1Delta,
    getAmountsForLiquidity,
    getLiquidityForAmounts,
    getSqrtRatioAtTick,
    getTickAtSqrtRatio,
    nearestUsableTick,
    priceWadFromSqrtX96,
    sqrtX96FromPriceWad
} from '../src/v3-math.ts';

const ROUNDS = 250;

function lcg(seed: number): () => number
{
    let state = seed >>> 0;
    return (): number =>
    {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

/** A bigint in [1, max], log-uniform so dust and whales both show up. */
function bigBetween(next: () => number, maxBits: number): bigint
{
    const bits = 1 + Math.floor(next() * maxBits);
    let value = 1n;
    for (let bit = 0; bit < bits; bit++)
    {
        value = value * 2n + (next() < 0.5 ? 0n : 1n);
    }
    return value;
}

function intBetween(next: () => number, low: number, high: number): number
{
    return low + Math.floor(next() * (high - low + 1));
}

describe('slippage bounds', () =>
{
    it('never widen the wrong way', () =>
    {
        const next = lcg(9);
        for (let round = 0; round < ROUNDS; round++)
        {
            const amount = bigBetween(next, 80);
            const bps = intBetween(next, 0, 5000);
            expect(minOutForSlippage(amount, bps) <= amount).toBe(true);
            expect(maxInForSlippage(amount, bps) >= amount).toBe(true);
            expect(minOutForSlippage(amount, 0)).toBe(amount);
            expect(maxInForSlippage(amount, 0)).toBe(amount);
        }
    });
});

describe('sqrtBigint', () =>
{
    it('is the exact integer square root of everything it is given', () =>
    {
        const next = lcg(10);
        for (let round = 0; round < ROUNDS; round++)
        {
            const value = bigBetween(next, 200);
            const root = sqrtBigint(value);
            expect(root * root <= value, `${ root }^2 > ${ value }`).toBe(true);
            expect((root + 1n) * (root + 1n) > value, `${ root }+1 squared still fits ${ value }`).toBe(true);
        }
    });
});

describe('decimal scaling', () =>
{
    it('keeps ordering and magnitude across any decimals', () =>
    {
        const next = lcg(11);
        for (let round = 0; round < ROUNDS; round++)
        {
            const decimals = intBetween(next, 0, 24);
            const amount = bigBetween(next, 70);
            const scaled = scaleToWad(amount, decimals);
            const twice = scaleToWad(amount * 2n, decimals);
            expect(twice >= scaled).toBe(true);
            if (decimals <= 18)
            {
                // Scaling up is exact - no information is lost going to 1e18.
                expect(scaled).toBe(amount * pow10(18 - decimals));
            }
        }
    });

    it('values twice the tokens at no less than twice the price', () =>
    {
        const next = lcg(13);
        for (let round = 0; round < 120; round++)
        {
            const decimals = intBetween(next, 0, 18);
            const amount = bigBetween(next, 50);
            const price = bigBetween(next, 60);
            const single = usdValue(amount, decimals, price);
            expect(usdValue(amount * 2n, decimals, price) >= single * 2n - 1n).toBe(true);
        }
    });
});

describe('digit handling fuzz', () =>
{
    const ALPHABET = '0123456789.٫٬۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩,- eE+xX';

    it('never throws, whatever a keyboard produces', () =>
    {
        const next = lcg(15);
        for (let round = 0; round < 600; round++)
        {
            const length = intBetween(next, 0, 24);
            let input = '';
            for (let index = 0; index < length; index++)
            {
                input += ALPHABET[Math.floor(next() * ALPHABET.length)];
            }
            expect(() => normalizeDigits(input), input).not.toThrow();
            expect(() => parseTokenAmount(input, intBetween(next, 0, 18)), input).not.toThrow();
        }
    });

    it('rejects rather than guessing whenever it cannot parse', () =>
    {
        const next = lcg(16);
        for (let round = 0; round < 600; round++)
        {
            const length = intBetween(next, 0, 20);
            let input = '';
            for (let index = 0; index < length; index++)
            {
                input += ALPHABET[Math.floor(next() * ALPHABET.length)];
            }
            const parsed = parseTokenAmount(input, 18);
            if (parsed !== null)
            {
                // Anything accepted is a non-negative amount, never a negative
                // one smuggled through a stray minus sign.
                expect(parsed >= 0n, input).toBe(true);
                expect(/^[\d.]*$/.test(normalizeDigits(input).trim()), input).toBe(true);
            }
        }
    });

    it('normalizes idempotently', () =>
    {
        const next = lcg(17);
        for (let round = 0; round < 300; round++)
        {
            const length = intBetween(next, 0, 20);
            let input = '';
            for (let index = 0; index < length; index++)
            {
                input += ALPHABET[Math.floor(next() * ALPHABET.length)];
            }
            const once = normalizeDigits(input);
            expect(normalizeDigits(once), input).toBe(once);
        }
    });

    it('round-trips every raw amount through its display form', () =>
    {
        const next = lcg(18);
        for (let round = 0; round < ROUNDS; round++)
        {
            const decimals = intBetween(next, 0, 24);
            const raw = bigBetween(next, 80);
            const text = formatTokenAmount(raw, decimals);
            expect(text, `${ raw }@${ decimals }`).toMatch(/^-?\d+(\.\d+)?$/);
            expect(parseTokenAmount(text, decimals), `${ raw }@${ decimals }`).toBe(raw);
        }
    });

    it('reads Persian and Arabic input as the same number as ASCII', () =>
    {
        const next = lcg(19);
        const persian = '۰۱۲۳۴۵۶۷۸۹';
        const arabic = '٠١٢٣٤٥٦٧٨٩';
        for (let round = 0; round < 200; round++)
        {
            const digits = intBetween(next, 1, 12);
            let ascii = '';
            for (let index = 0; index < digits; index++)
            {
                ascii += String(intBetween(next, 0, 9));
            }
            const asPersian = [...ascii].map((digit) => persian[Number(digit)]).join('');
            const asArabic = [...ascii].map((digit) => arabic[Number(digit)]).join('');
            expect(parseTokenAmount(asPersian, 6), ascii).toBe(parseTokenAmount(ascii, 6));
            expect(parseTokenAmount(asArabic, 6), ascii).toBe(parseTokenAmount(ascii, 6));
        }
    });
});

describe('V3 tick maths laws', () =>
{
    it('is a strictly increasing map from ticks to prices', () =>
    {
        const next = lcg(20);
        for (let round = 0; round < ROUNDS; round++)
        {
            const low = intBetween(next, MIN_TICK, MAX_TICK - 1);
            const high = intBetween(next, low + 1, MAX_TICK);
            expect(getSqrtRatioAtTick(low) < getSqrtRatioAtTick(high), `${ low } vs ${ high }`).toBe(true);
        }
    });

    it('inverts exactly, everywhere in the range', () =>
    {
        const next = lcg(21);
        for (let round = 0; round < 150; round++)
        {
            const tick = intBetween(next, MIN_TICK, MAX_TICK);
            expect(getTickAtSqrtRatio(getSqrtRatioAtTick(tick)), String(tick)).toBe(tick);
        }
    });

    // The contract's own definition: the greatest tick whose ratio is still at
    // or below the price. Off by one here and a range bound lands in the wrong
    // tick, which is a position that earns nothing.
    it('floors an arbitrary price into the tick that contains it', () =>
    {
        const next = lcg(22);
        for (let round = 0; round < 150; round++)
        {
            const inside = MIN_SQRT_RATIO + bigBetween(next, 120);
            if (inside > MAX_SQRT_RATIO)
            {
                continue;
            }
            const tick = getTickAtSqrtRatio(inside);
            expect(getSqrtRatioAtTick(tick) <= inside, String(inside)).toBe(true);
            if (tick < MAX_TICK)
            {
                expect(getSqrtRatioAtTick(tick + 1) > inside, String(inside)).toBe(true);
            }
        }
    });

    it('snaps every tick onto the pool grid, inside the representable range', () =>
    {
        const next = lcg(23);
        for (const spacing of [1, 10, 60, 200])
        {
            for (let round = 0; round < 80; round++)
            {
                const snapped = nearestUsableTick(intBetween(next, MIN_TICK * 2, MAX_TICK * 2), spacing);
                expect(Number.isInteger(snapped / spacing), `${ snapped }@${ spacing }`).toBe(true);
                expect(snapped).toBeGreaterThanOrEqual(MIN_TICK);
                expect(snapped).toBeLessThanOrEqual(MAX_TICK);
            }
        }
    });

    it('reads price monotonically off the square root', () =>
    {
        const next = lcg(24);
        for (let round = 0; round < 150; round++)
        {
            const low = intBetween(next, -400_000, 400_000);
            const high = intBetween(next, low + 1, 500_000);
            const cheaper = priceWadFromSqrtX96(getSqrtRatioAtTick(low), 18, 18);
            const dearer = priceWadFromSqrtX96(getSqrtRatioAtTick(high), 18, 18);
            expect(dearer >= cheaper, `${ low } vs ${ high }`).toBe(true);
        }
    });

    // A price is carried as 1e18 fixed point and the trip goes through a square
    // root, so the error is RELATIVE, not absolute: exact to the last digit for
    // small prices, and to eighteen significant figures for large ones. Stated
    // as an absolute bound this law would read as broken at 1e16 dollars a token.
    it('round-trips a price through the square root to eighteen figures', () =>
    {
        const next = lcg(25);
        for (let round = 0; round < 120; round++)
        {
            const decimals0 = intBetween(next, 6, 18);
            const decimals1 = intBetween(next, 6, 18);
            const tick = intBetween(next, -200_000, 200_000);
            const price = priceWadFromSqrtX96(getSqrtRatioAtTick(tick), decimals0, decimals1);
            if (price <= 0n)
            {
                continue;
            }
            const back = priceWadFromSqrtX96(sqrtX96FromPriceWad(price, decimals0, decimals1), decimals0, decimals1);
            const gap = back > price ? back - price : price - back;
            expect(
                gap <= 1n || gap * 10n ** 18n <= price,
                `price ${ price } came back as ${ back }`
            ).toBe(true);
        }
    });

    // Ticks survive the same trip only while the price still has digits to spare
    // in 1e18 - below about 1e-12 a whole band of ticks quantizes to one WAD
    // value, and the typed range fields never operate down there.
    it('round-trips a tick whenever the price has WAD precision to carry it', () =>
    {
        const next = lcg(31);
        let exercised = 0;
        for (let round = 0; round < 200; round++)
        {
            const decimals = intBetween(next, 6, 18);
            const tick = intBetween(next, -100_000, 100_000);
            const price = priceWadFromSqrtX96(getSqrtRatioAtTick(tick), decimals, decimals);
            if (price < 10n ** 9n)
            {
                continue;
            }
            exercised++;
            const recovered = getTickAtSqrtRatio(sqrtX96FromPriceWad(price, decimals, decimals));
            expect(Math.abs(recovered - tick), `tick ${ tick } came back as ${ recovered }`).toBeLessThanOrEqual(1);
        }
        expect(exercised).toBeGreaterThan(50);
    });
});

describe('V3 liquidity laws', () =>
{
    it('never promises back more than was put in', () =>
    {
        const next = lcg(26);
        for (let round = 0; round < 200; round++)
        {
            const lowerTick = intBetween(next, -100_000, 99_000);
            const upperTick = intBetween(next, lowerTick + 60, 100_000);
            const priceTick = intBetween(next, lowerTick - 5000, upperTick + 5000);
            const lower = getSqrtRatioAtTick(lowerTick);
            const upper = getSqrtRatioAtTick(upperTick);
            const price = getSqrtRatioAtTick(priceTick);
            const amount0 = bigBetween(next, 70) + 1n;
            const amount1 = bigBetween(next, 70) + 1n;

            const liquidity = getLiquidityForAmounts(price, lower, upper, amount0, amount1);
            const back = getAmountsForLiquidity(price, lower, upper, liquidity);
            // Rounding is toward the pool: a withdrawal estimate that exceeded
            // the deposit would promise a wei the pool will not pay.
            expect(back.amount0 <= amount0, `amount0 grew: ${ back.amount0 } > ${ amount0 }`).toBe(true);
            expect(back.amount1 <= amount1, `amount1 grew: ${ back.amount1 } > ${ amount1 }`).toBe(true);
        }
    });

    it('holds one token only, outside its range', () =>
    {
        const next = lcg(27);
        for (let round = 0; round < 150; round++)
        {
            const lowerTick = intBetween(next, -50_000, 49_000);
            const upperTick = intBetween(next, lowerTick + 60, 50_000);
            const lower = getSqrtRatioAtTick(lowerTick);
            const upper = getSqrtRatioAtTick(upperTick);
            const liquidity = bigBetween(next, 60) + 1n;

            const below = getAmountsForLiquidity(getSqrtRatioAtTick(lowerTick - 1), lower, upper, liquidity);
            expect(below.amount1, `below ${ lowerTick }`).toBe(0n);
            const above = getAmountsForLiquidity(getSqrtRatioAtTick(upperTick + 1), lower, upper, liquidity);
            expect(above.amount0, `above ${ upperTick }`).toBe(0n);
        }
    });

    // The pool rounds a deposit up and a withdrawal down; the two directions may
    // differ by at most one wei, never more.
    it('separates its two rounding directions by at most one wei', () =>
    {
        const next = lcg(28);
        for (let round = 0; round < 200; round++)
        {
            const lowerTick = intBetween(next, -50_000, 49_000);
            const upperTick = intBetween(next, lowerTick + 60, 50_000);
            const lower = getSqrtRatioAtTick(lowerTick);
            const upper = getSqrtRatioAtTick(upperTick);
            const liquidity = bigBetween(next, 60) + 1n;
            for (const delta of [getAmount0Delta, getAmount1Delta])
            {
                const up = delta(lower, upper, liquidity, true);
                const down = delta(lower, upper, liquidity, false);
                expect(up >= down).toBe(true);
                expect(up - down <= 1n, `${ up } vs ${ down }`).toBe(true);
            }
        }
    });

    it('asks for no counterpart at all when the range sits to one side', () =>
    {
        const next = lcg(29);
        for (let round = 0; round < 150; round++)
        {
            const lowerTick = intBetween(next, -50_000, 49_000);
            const upperTick = intBetween(next, lowerTick + 60, 50_000);
            const lower = getSqrtRatioAtTick(lowerTick);
            const upper = getSqrtRatioAtTick(upperTick);
            const amount = bigBetween(next, 60) + 1n;

            // Price below the range: the position is pure token0, so a token0
            // deposit needs no token1 to pair with.
            const below = counterpartAmount(getSqrtRatioAtTick(lowerTick - 1), lower, upper, { side: 0, amount });
            expect(below, `below ${ lowerTick }`).toBe(0n);
            // And above it, a token1 deposit needs no token0.
            const above = counterpartAmount(getSqrtRatioAtTick(upperTick + 1), lower, upper, { side: 1, amount });
            expect(above, `above ${ upperTick }`).toBe(0n);
        }
    });

    it('is zero-in, zero-out at every price', () =>
    {
        const next = lcg(30);
        for (let round = 0; round < 100; round++)
        {
            const lowerTick = intBetween(next, -50_000, 49_000);
            const upperTick = intBetween(next, lowerTick + 60, 50_000);
            const lower = getSqrtRatioAtTick(lowerTick);
            const upper = getSqrtRatioAtTick(upperTick);
            const price = getSqrtRatioAtTick(intBetween(next, lowerTick, upperTick));
            expect(counterpartAmount(price, lower, upper, { side: 0, amount: 0n })).toBe(0n);
            expect(counterpartAmount(price, lower, upper, { side: 1, amount: 0n })).toBe(0n);
            expect(getAmountsForLiquidity(price, lower, upper, 0n)).toEqual({ amount0: 0n, amount1: 0n });
        }
    });
});
