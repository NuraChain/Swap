// @vitest-environment node
//
// The V3 calldata builders, checked by DECODING what they produce. These
// functions are the last thing standing between a range the user typed and a
// transaction they sign: a bundle in the wrong order, a missing refund, or a
// collect that asks for less than everything all fail silently on-chain - the
// transaction succeeds and the money simply does not arrive.

import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { POSITION_MANAGER_ABI } from '../src/lib/chain.ts';
import type { Address } from '../src/lib/chain.ts';
import {
    bestTier,
    buildCollect,
    buildCreateAndMint,
    buildCreatePool,
    buildDecrease,
    buildIncrease,
    buildMint,
    inRange,
    poolKey,
    positionAmounts,
    sortTokens
} from '../src/lib/v3.ts';
import type { MintRequest, TierQuote, V3PoolState, V3Position } from '../src/lib/v3.ts';

const LOW = '0x0000000000000000000000000000000000000aaa' as Address;
const HIGH = '0x0000000000000000000000000000000000000bbb' as Address;
const MANAGER = '0x00000000000000000000000000000000000000f4' as Address;
const OWNER = '0x00000000000000000000000000000000000000cc' as Address;
const MAX_UINT128 = (1n << 128n) - 1n;

function decodeCalls(request: { args: readonly unknown[] })
{
    const calls = request.args[0] as `0x${ string }`[];
    return calls.map((data) => decodeFunctionData({ abi: POSITION_MANAGER_ABI, data }));
}

const mintRequest: MintRequest = {
    manager: MANAGER,
    token0: LOW,
    token1: HIGH,
    fee: 3000,
    tickLower: -60,
    tickUpper: 60,
    amount0Desired: 1000n,
    amount1Desired: 2000n,
    amount0Min: 990n,
    amount1Min: 1980n,
    recipient: OWNER,
    deadline: 42n,
    nativeValue: 0n
};

describe('token ordering', () =>
{
    it('sorts by address, whichever way the caller passes them', () =>
    {
        expect(sortTokens(HIGH, LOW)).toEqual([LOW, HIGH]);
        expect(sortTokens(LOW, HIGH)).toEqual([LOW, HIGH]);
    });

    // The key identifies a POOL, and a pool does not care which token the caller
    // happened to name first - two spellings of one pool would load it twice and
    // show it twice.
    it('keys a pool the same from either side, case-insensitively', () =>
    {
        expect(poolKey(HIGH, LOW, 500)).toBe(poolKey(LOW, HIGH, 500));
        expect(poolKey(LOW.toUpperCase() as Address, HIGH, 500)).toBe(poolKey(LOW, HIGH, 500));
        expect(poolKey(LOW, HIGH, 500)).not.toBe(poolKey(LOW, HIGH, 3000));
    });
});

describe('bestTier', () =>
{
    const pool = { fee: 0 } as unknown as V3PoolState;
    const quote = (fee: number, out: bigint): TierQuote => ({ fee, out, pool });

    it('takes the largest output', () =>
    {
        expect(bestTier([quote(500, 10n), quote(3000, 30n), quote(10_000, 20n)])?.fee).toBe(3000);
    });

    // A tier whose pool cannot fill the trade quotes zero. Zero is not "best" and
    // must never be signed: it would be a swap promising nothing out.
    it('ignores tiers that cannot fill and answers null when none can', () =>
    {
        expect(bestTier([quote(500, 0n), quote(3000, 7n)])?.fee).toBe(3000);
        expect(bestTier([quote(500, 0n), quote(3000, 0n)])).toBeNull();
        expect(bestTier([])).toBeNull();
    });
});

describe('buildMint', () =>
{
    it('mints directly when no native value rides along', () =>
    {
        const request = buildMint(mintRequest);
        expect(request.functionName).toBe('mint');
        expect(request.address).toBe(MANAGER);
        expect(request.value).toBeUndefined();
    });

    // The desired amount is an upper bound; the pool takes what the range needs
    // and no more. Without the refund the remainder stays in the manager.
    it('bundles refundETH behind the mint when paying in NURA', () =>
    {
        const request = buildMint({ ...mintRequest, nativeValue: 5000n });
        expect(request.functionName).toBe('multicall');
        expect(request.value).toBe(5000n);
        expect(decodeCalls(request).map((call) => call.functionName)).toEqual(['mint', 'refundETH']);
    });
});

describe('buildCreateAndMint', () =>
{
    // Split across two transactions, a provider who signs the first and walks
    // away leaves an initialized pool at a price of their choosing with nobody's
    // liquidity in it - an arbitrage invitation with their name on it.
    it('creates, initializes and mints in one transaction', () =>
    {
        const request = buildCreateAndMint(mintRequest, 79228162514264337593543950336n);
        expect(request.functionName).toBe('multicall');
        expect(decodeCalls(request).map((call) => call.functionName))
            .toEqual(['createAndInitializePoolIfNecessary', 'mint']);
        expect(request.value).toBeUndefined();
    });

    it('adds the refund only when there is native value to refund', () =>
    {
        const request = buildCreateAndMint({ ...mintRequest, nativeValue: 7n }, 1n);
        expect(decodeCalls(request).map((call) => call.functionName))
            .toEqual(['createAndInitializePoolIfNecessary', 'mint', 'refundETH']);
        expect(request.value).toBe(7n);
    });
});

describe('buildDecrease', () =>
{
    // decreaseLiquidity only moves the principal into the position's owed
    // balance. Without the collect that follows it, the tokens sit inside the
    // manager and the withdrawal looks to its owner like it did nothing.
    it('bundles the collect that actually pays the owner', () =>
    {
        const request = buildDecrease({
            manager: MANAGER,
            tokenId: 9n,
            liquidity: 1234n,
            amount0Min: 1n,
            amount1Min: 2n,
            recipient: OWNER,
            deadline: 42n
        });
        expect(request.address).toBe(MANAGER);
        expect(request.functionName).toBe('multicall');
        const calls = decodeCalls(request);
        expect(calls.map((call) => call.functionName)).toEqual(['decreaseLiquidity', 'collect']);
        // The collect asks for everything, so the fees earned leave with the
        // principal instead of waiting for a second transaction.
        const collect = (calls[1].args as readonly [{ amount0Max: bigint; amount1Max: bigint; recipient: string }])[0];
        expect(collect.amount0Max).toBe(MAX_UINT128);
        expect(collect.amount1Max).toBe(MAX_UINT128);
        expect(collect.recipient).toBe(OWNER);
    });
});

describe('buildIncrease, buildCollect, buildCreatePool', () =>
{
    it('increases directly, or with a refund when native', () =>
    {
        const plain = buildIncrease({
            manager: MANAGER,
            tokenId: 3n,
            amount0Desired: 10n,
            amount1Desired: 20n,
            amount0Min: 9n,
            amount1Min: 18n,
            deadline: 42n,
            nativeValue: 0n
        });
        expect(plain.functionName).toBe('increaseLiquidity');
        const native = buildIncrease({
            manager: MANAGER,
            tokenId: 3n,
            amount0Desired: 10n,
            amount1Desired: 20n,
            amount0Min: 9n,
            amount1Min: 18n,
            deadline: 42n,
            nativeValue: 10n
        });
        expect(native.functionName).toBe('multicall');
        expect(decodeCalls(native).map((call) => call.functionName)).toEqual(['increaseLiquidity', 'refundETH']);
    });

    it('collects everything owed to the recipient', () =>
    {
        const request = buildCollect(MANAGER, 5n, OWNER);
        expect(request.functionName).toBe('collect');
        const params = (request.args as readonly [{ amount0Max: bigint; tokenId: bigint }])[0];
        expect(params.tokenId).toBe(5n);
        expect(params.amount0Max).toBe(MAX_UINT128);
    });

    it('names the pool it would create in address order', () =>
    {
        const request = buildCreatePool(MANAGER, LOW, HIGH, 500, 1n);
        expect(request.functionName).toBe('createAndInitializePoolIfNecessary');
        expect(request.args.slice(0, 3)).toEqual([LOW, HIGH, 500]);
    });
});

describe('position readings', () =>
{
    const position: V3Position = {
        tokenId: 1n,
        token0: LOW,
        token1: HIGH,
        fee: 3000,
        tickLower: -60,
        tickUpper: 60,
        liquidity: 1_000_000n
    };
    const poolAt = (tick: number): V3PoolState => ({
        address: '0x00000000000000000000000000000000000000ee' as Address,
        fee: 3000,
        tickSpacing: 60,
        token0: LOW,
        token1: HIGH,
        sqrtPriceX96: 79228162514264337593543950336n,
        tick,
        liquidity: 5n
    });

    // The upper bound is EXCLUSIVE, exactly as the pool has it: a position whose
    // upper tick the price has just reached has stopped earning.
    it('reads the range half-open, lower inclusive and upper exclusive', () =>
    {
        expect(inRange(position, poolAt(-60))).toBe(true);
        expect(inRange(position, poolAt(0))).toBe(true);
        expect(inRange(position, poolAt(59))).toBe(true);
        expect(inRange(position, poolAt(60))).toBe(false);
        expect(inRange(position, poolAt(-61))).toBe(false);
        expect(inRange(position, undefined)).toBe(false);
    });

    it('values nothing when the pool is unknown or the position is closed', () =>
    {
        expect(positionAmounts(position, undefined)).toEqual({ amount0: 0n, amount1: 0n });
        expect(positionAmounts({ ...position, liquidity: 0n }, poolAt(0))).toEqual({ amount0: 0n, amount1: 0n });
    });

    it('splits a live position across both tokens at the middle of its range', () =>
    {
        const amounts = positionAmounts(position, poolAt(0));
        expect(amounts.amount0 > 0n).toBe(true);
        expect(amounts.amount1 > 0n).toBe(true);
    });
});
