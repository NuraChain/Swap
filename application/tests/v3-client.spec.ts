// The V3 client against a scripted chain. Two things here are guesses the code
// makes about a deployment it cannot see - which Quoter and which SwapRouter
// shipped - and both are resolved by probing. A wrong probe does not fail loudly:
// it encodes a call the router cannot decode, and the trader finds out in their
// wallet. These tests are what stand in for a deployment to try it against.

import { decodeFunctionData } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fresh module per test: the tier list and both flavour probes are cached for
// the life of the tab on purpose, so isolation means re-importing.
vi.setConfig({ testTimeout: 30_000 });

type V3 = typeof import('../src/lib/v3.ts');
type Address = `0x${ string }`;

const FACTORY = '0x0000000000000000000000000000000000000031' as Address;
const ROUTER = '0x0000000000000000000000000000000000000032' as Address;
const QUOTER = '0x0000000000000000000000000000000000000033' as Address;
const MANAGER = '0x0000000000000000000000000000000000000034' as Address;
const WNURA = '0x00000000000000000000000000000000000000b0' as Address;
const USDT = '0x00000000000000000000000000000000000000c0' as Address;
const ALPHA = '0x00000000000000000000000000000000000000a0' as Address;
const OWNER = '0x00000000000000000000000000000000000000cc' as Address;
const POOL_3000 = '0x0000000000000000000000000000000000000301' as Address;
const POOL_500 = '0x0000000000000000000000000000000000000302' as Address;
const Q96 = 1n << 96n;

interface PoolFixture
{
    address: Address;
    sqrtPriceX96: bigint;
    tick: number;
    liquidity: bigint;
}

interface Script
{
    /** fee -> tick spacing; a fee absent from this map is not enabled. */
    tiers: Record<number, number>;
    /** `${token0}-${token1}-${fee}` (sorted) -> pool. */
    pools: Map<string, PoolFixture>;
    /** Which Quoter answers; 'none' means every quote reverts. */
    quoter: 'v2' | 'v1' | 'none';
    /** Which SwapRouter is deployed. */
    router: 'v1' | '02';
    /** Output the quoter reports, per fee tier. */
    quotes: Record<number, bigint>;
    /** `${token}@${holder}` -> balance. */
    balances: Map<string, bigint>;
    positions: Array<{ tokenId: bigint; token0: Address; token1: Address; fee: number; tickLower: number; tickUpper: number; liquidity: bigint }>;
    owed: { amount0: bigint; amount1: bigint } | 'revert';
    /** Every read the module made, for asserting what was NOT called. */
    calls: string[];
    failEveryRead: boolean;
    /** The next N reads throw - a partial outage, not a total one. */
    failNextReads: number;
}

let script: Script;

function poolKeyOf(a: Address, b: Address, fee: number): string
{
    const [first, second] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    return `${ first.toLowerCase() }-${ second.toLowerCase() }-${ fee }`;
}

function freshScript(): Script
{
    return {
        tiers: { 100: 1, 500: 10, 3000: 60, 10_000: 200 },
        pools: new Map(),
        quoter: 'v2',
        router: 'v1',
        quotes: {},
        balances: new Map(),
        positions: [],
        owed: { amount0: 0n, amount1: 0n },
        calls: [],
        failEveryRead: false,
        failNextReads: 0
    };
}

interface ReadArgs
{
    address: string;
    abi: unknown;
    functionName: string;
    args?: readonly unknown[];
    account?: string;
}

function abiOutputCount(abi: unknown, functionName: string): number
{
    const entry = (abi as Array<{ name?: string; outputs?: unknown[] }>).find((item) => item.name === functionName);
    return entry?.outputs?.length ?? 0;
}

function abiInputCount(abi: unknown, functionName: string): number
{
    const entry = (abi as Array<{ name?: string; inputs?: unknown[] }>).find((item) => item.name === functionName);
    return entry?.inputs?.length ?? 0;
}

/** Answers exactly what the scripted chain would; anything else reverts. */
async function answer(read: ReadArgs): Promise<unknown>
{
    script.calls.push(read.functionName);
    if (script.failEveryRead)
    {
        throw new Error('rpc unavailable');
    }
    if (script.failNextReads > 0)
    {
        script.failNextReads--;
        throw new Error('rpc unavailable');
    }
    switch (read.functionName)
    {
        case 'feeAmountTickSpacing':
        {
            const fee = Number(read.args?.[0]);
            return script.tiers[fee] ?? 0;
        }
        case 'getPool':
        {
            const [tokenA, tokenB, fee] = read.args as [Address, Address, number];
            const pool = script.pools.get(poolKeyOf(tokenA, tokenB, Number(fee)));
            return pool?.address ?? '0x0000000000000000000000000000000000000000';
        }
        case 'slot0':
        {
            const pool = [...script.pools.values()].find((entry) => entry.address.toLowerCase() === read.address.toLowerCase());
            if (pool === undefined)
            {
                throw new Error('no pool');
            }
            return [pool.sqrtPriceX96, pool.tick, 0, 1, 1, 0, true];
        }
        case 'liquidity':
        {
            const pool = [...script.pools.values()].find((entry) => entry.address.toLowerCase() === read.address.toLowerCase());
            return pool?.liquidity ?? 0n;
        }
        case 'balanceOf':
        {
            const holder = String(read.args?.[0]).toLowerCase();
            if (read.address.toLowerCase() === MANAGER.toLowerCase())
            {
                return BigInt(script.positions.length);
            }
            return script.balances.get(`${ read.address.toLowerCase() }@${ holder }`) ?? 0n;
        }
        case 'quoteExactInputSingle':
        {
            // The two Quoters differ in arity, and that is exactly what the
            // probe keys on: the deployed one decodes its own shape and nothing
            // else. Answering both would make the probe untestable.
            const isV2Shape = abiInputCount(read.abi, 'quoteExactInputSingle') === 1;
            if (script.quoter === 'none' || (script.quoter === 'v2') !== isV2Shape)
            {
                throw new Error('execution reverted');
            }
            const fee = isV2Shape
                ? Number((read.args?.[0] as { fee: number }).fee)
                : Number(read.args?.[2]);
            const out = script.quotes[fee];
            if (out === undefined || out === 0n)
            {
                throw new Error('execution reverted: no liquidity');
            }
            return abiOutputCount(read.abi, 'quoteExactInputSingle') === 4 ? [out, 0n, 0, 0n] : out;
        }
        case 'positionManager':
        {
            // Only SwapRouter02 has one. A v1 router reverts, which is the whole
            // signal the router probe reads.
            if (script.router === 'v1')
            {
                throw new Error('execution reverted');
            }
            return MANAGER;
        }
        case 'tokenOfOwnerByIndex':
        {
            const index = Number(read.args?.[1]);
            const position = script.positions[index];
            if (position === undefined)
            {
                throw new Error('index out of range');
            }
            return position.tokenId;
        }
        case 'positions':
        {
            const tokenId = read.args?.[0] as bigint;
            const position = script.positions.find((entry) => entry.tokenId === tokenId);
            if (position === undefined)
            {
                throw new Error('invalid token id');
            }
            return [
                0n, OWNER, position.token0, position.token1, position.fee,
                position.tickLower, position.tickUpper, position.liquidity, 0n, 0n, 0n, 0n
            ];
        }
        case 'collect':
        {
            // collect is owner-gated: a call with no `account` would revert on a
            // real node before it computed anything.
            expect(read.account?.toLowerCase()).toBe(OWNER.toLowerCase());
            if (script.owed === 'revert')
            {
                throw new Error('execution reverted');
            }
            return [script.owed.amount0, script.owed.amount1];
        }
        default:
            throw new Error(`unscripted call ${ read.functionName }`);
    }
}

const reader = {
    readContract: (read: ReadArgs): Promise<unknown> => answer(read),
    multicall: async ({ contracts }: { contracts: ReadArgs[] }): Promise<Array<{ status: string; result?: unknown }>> =>
        await Promise.all(contracts.map(async (contract) =>
        {
            try
            {
                return { status: 'success', result: await answer(contract) };
            }
            catch
            {
                return { status: 'failure' };
            }
        }))
};

vi.mock('../src/lib/chain.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/lib/chain.ts')>();
    // Only the transport is replaced - the ABI fragments stay real, so the fake
    // above is dispatching on the same shapes production sends.
    return { ...actual, publicClient: (): unknown => reader };
});

async function loadV3(): Promise<V3>
{
    vi.resetModules();
    return await import('../src/lib/v3.ts');
}

function addPool(fee: number, address: Address, overrides: Partial<PoolFixture> = {}): void
{
    script.pools.set(poolKeyOf(WNURA, USDT, fee), {
        address,
        sqrtPriceX96: Q96,
        tick: 0,
        liquidity: 10n ** 18n,
        ...overrides
    });
}

beforeEach(() =>
{
    script = freshScript();
});

describe('enabled fee tiers', () =>
{
    it('reports only what the factory actually enables, at its own spacing', async () =>
    {
        script.tiers = { 500: 10, 3000: 60 };
        const v3 = await loadV3();
        expect(await v3.enabledFeeTiers(FACTORY)).toEqual([{ fee: 500, tickSpacing: 10 }, { fee: 3000, tickSpacing: 60 }]);
    });

    it('believes the factory over the canonical spacing', async () =>
    {
        script.tiers = { 3000: 42 };
        const v3 = await loadV3();
        expect(await v3.enabledFeeTiers(FACTORY)).toEqual([{ fee: 3000, tickSpacing: 42 }]);
    });

    it('caches the answer - the factory cannot change it under a session', async () =>
    {
        script.tiers = { 3000: 60 };
        const v3 = await loadV3();
        await v3.enabledFeeTiers(FACTORY);
        const after = script.calls.length;
        await v3.enabledFeeTiers(FACTORY);
        expect(script.calls.length).toBe(after);
    });

    // One bad moment on a public RPC must not pin the wrong tier set for the
    // life of the tab - so the fallback is used but deliberately NOT cached.
    it('falls back to the canonical tiers without caching when nothing answers', async () =>
    {
        script.failEveryRead = true;
        const v3 = await loadV3();
        expect((await v3.enabledFeeTiers(FACTORY)).map((tier) => tier.fee)).toEqual([100, 500, 3000, 10_000]);

        script.failEveryRead = false;
        script.tiers = { 3000: 60 };
        expect(await v3.enabledFeeTiers(FACTORY)).toEqual([{ fee: 3000, tickSpacing: 60 }]);
    });

    // A PARTIAL answer is worse than none dressed as a complete one: a tier
    // whose read failed is indistinguishable from one the factory disabled, so
    // caching it would hide real tiers until reload. Serve what answered, pin
    // only a clean pass.
    it('serves a partial answer without caching it', async () =>
    {
        script.failNextReads = 1;
        script.tiers = { 100: 1, 500: 10 };
        const v3 = await loadV3();
        expect(await v3.enabledFeeTiers(FACTORY)).toEqual([{ fee: 500, tickSpacing: 10 }]);

        // The next call probes again - and its clean pass is the one cached.
        script.tiers = { 100: 1, 500: 10, 3000: 60 };
        expect(await v3.enabledFeeTiers(FACTORY)).toEqual([
            { fee: 100, tickSpacing: 1 },
            { fee: 500, tickSpacing: 10 },
            { fee: 3000, tickSpacing: 60 }
        ]);
        const after = script.calls.length;
        await v3.enabledFeeTiers(FACTORY);
        expect(script.calls.length).toBe(after);
    });
});

describe('the Quoter probe', () =>
{
    it('quotes through QuoterV2 and remembers the shape', async () =>
    {
        script.quoter = 'v2';
        script.quotes = { 3000: 1234n };
        const v3 = await loadV3();
        expect(await v3.quoteV3(QUOTER, WNURA, USDT, 3000, 10n ** 18n)).toBe(1234n);
        const first = script.calls.filter((name) => name === 'quoteExactInputSingle').length;
        await v3.quoteV3(QUOTER, WNURA, USDT, 3000, 10n ** 18n);
        // The second quote costs ONE call, not a re-probe of both shapes.
        expect(script.calls.filter((name) => name === 'quoteExactInputSingle').length).toBe(first + 1);
    });

    it('falls back to the original Quoter and remembers that instead', async () =>
    {
        script.quoter = 'v1';
        script.quotes = { 3000: 999n };
        const v3 = await loadV3();
        expect(await v3.quoteV3(QUOTER, WNURA, USDT, 3000, 10n ** 18n)).toBe(999n);
        const probed = script.calls.filter((name) => name === 'quoteExactInputSingle').length;
        expect(probed).toBe(2);
        await v3.quoteV3(QUOTER, WNURA, USDT, 3000, 10n ** 18n);
        expect(script.calls.filter((name) => name === 'quoteExactInputSingle').length).toBe(probed + 1);
    });

    // A Quoter reverting is how it says "no route" - not an error every caller
    // has to catch, and not a reason to doubt the flavour already established.
    it('reads a revert as no route once the shape is known', async () =>
    {
        script.quoter = 'v2';
        script.quotes = { 3000: 5n };
        const v3 = await loadV3();
        await v3.quoteV3(QUOTER, WNURA, USDT, 3000, 10n ** 18n);
        const settled = script.calls.filter((name) => name === 'quoteExactInputSingle').length;
        expect(await v3.quoteV3(QUOTER, WNURA, USDT, 500, 10n ** 18n)).toBe(0n);
        expect(script.calls.filter((name) => name === 'quoteExactInputSingle').length).toBe(settled + 1);
    });

    it('answers zero when neither shape decodes', async () =>
    {
        script.quoter = 'none';
        const v3 = await loadV3();
        expect(await v3.quoteV3(QUOTER, WNURA, USDT, 3000, 10n ** 18n)).toBe(0n);
    });

    it('does not call the chain at all for an empty amount', async () =>
    {
        const v3 = await loadV3();
        expect(await v3.quoteV3(QUOTER, WNURA, USDT, 3000, 0n)).toBe(0n);
        expect(script.calls).toEqual([]);
    });

    it('quotes every tier that has a pool and marks the best', async () =>
    {
        script.tiers = { 500: 10, 3000: 60 };
        addPool(500, POOL_500);
        addPool(3000, POOL_3000);
        script.quotes = { 500: 100n, 3000: 250n };
        const v3 = await loadV3();
        const quotes = await v3.quoteAllTiers(FACTORY, QUOTER, WNURA, USDT, 10n ** 18n);
        expect(quotes.map((quote) => quote.fee)).toEqual([500, 3000]);
        expect(v3.bestTier(quotes)?.fee).toBe(3000);
    });

    it('keeps a tier that cannot fill in the list, at zero', async () =>
    {
        script.tiers = { 500: 10, 3000: 60 };
        addPool(500, POOL_500);
        addPool(3000, POOL_3000);
        script.quotes = { 3000: 250n };
        const v3 = await loadV3();
        const quotes = await v3.quoteAllTiers(FACTORY, QUOTER, WNURA, USDT, 10n ** 18n);
        expect(quotes.find((quote) => quote.fee === 500)?.out).toBe(0n);
        expect(v3.bestTier(quotes)?.fee).toBe(3000);
    });

    it('answers nothing for a pair with no pool anywhere', async () =>
    {
        const v3 = await loadV3();
        expect(await v3.quoteAllTiers(FACTORY, QUOTER, WNURA, ALPHA, 10n ** 18n)).toEqual([]);
    });
});

describe('the SwapRouter probe', () =>
{
    const base = {
        router: ROUTER,
        tokenIn: WNURA,
        tokenOut: USDT,
        fee: 3000,
        amountIn: 10n ** 18n,
        amountOutMin: 900n,
        recipient: OWNER,
        deadline: 1_700_000_000n,
        nativeIn: false,
        nativeOut: false
    };

    it('signs the original SwapRouter with the deadline inside the struct', async () =>
    {
        script.router = 'v1';
        const v3 = await loadV3();
        const request = await v3.buildV3Swap(base);
        expect(request.functionName).toBe('exactInputSingle');
        const params = (request.args as readonly [{ deadline: bigint; recipient: string; amountOutMinimum: bigint }])[0];
        expect(params.deadline).toBe(1_700_000_000n);
        expect(params.recipient).toBe(OWNER);
        expect(params.amountOutMinimum).toBe(900n);
        expect(request.value).toBe(0n);
    });

    // 02 dropped the deadline from the swap itself. Encoding the v1 struct
    // against it shifts every field by one word - the router decodes the
    // recipient as a fee and reverts, or worse, does not.
    it('signs SwapRouter02 through multicall, where its deadline lives', async () =>
    {
        script.router = '02';
        const v3 = await loadV3();
        const request = await v3.buildV3Swap(base);
        expect(request.functionName).toBe('multicall');
        const [deadline, calls] = request.args as [bigint, `0x${ string }`[]];
        expect(deadline).toBe(1_700_000_000n);
        expect(calls).toHaveLength(1);
        const decoded = decodeFunctionData({ abi: request.abi, data: calls[0] });
        expect(decoded.functionName).toBe('exactInputSingle');
        expect(Object.keys(decoded.args?.[0] as object)).not.toContain('deadline');
    });

    it('probes the router once and reuses the answer', async () =>
    {
        script.router = '02';
        const v3 = await loadV3();
        await v3.buildV3Swap(base);
        const probes = script.calls.filter((name) => name === 'positionManager').length;
        await v3.buildV3Swap(base);
        expect(script.calls.filter((name) => name === 'positionManager').length).toBe(probes);
        expect(probes).toBe(1);
    });

    // A v1 router reverts on the probe - but so does an unreachable RPC. A
    // failure must answer 'v1' for THIS trade and leave the question open:
    // pinning it off a blip encoded v1 calldata against a real 02 until reload.
    it('re-probes after a failed router read instead of pinning v1', async () =>
    {
        script.failEveryRead = true;
        const v3 = await loadV3();
        expect(await v3.detectRouterFlavour(ROUTER)).toBe('v1');

        script.failEveryRead = false;
        script.router = '02';
        expect(await v3.detectRouterFlavour(ROUTER)).toBe('02');
        const probes = script.calls.filter((name) => name === 'positionManager').length;
        expect(await v3.detectRouterFlavour(ROUTER)).toBe('02');
        expect(script.calls.filter((name) => name === 'positionManager').length).toBe(probes);
    });

    it('sends the input as value when paying in NURA', async () =>
    {
        script.router = 'v1';
        const v3 = await loadV3();
        const request = await v3.buildV3Swap({ ...base, nativeIn: true });
        expect(request.value).toBe(10n ** 18n);
    });

    // Native output has to be paid to the ROUTER so unwrapWETH9 in the same
    // transaction can turn it back into NURA. Paying the trader directly would
    // leave them holding the wrapper they asked not to hold.
    it('routes a native payout through the router and unwraps it, on v1', async () =>
    {
        script.router = 'v1';
        const v3 = await loadV3();
        const request = await v3.buildV3Swap({ ...base, nativeOut: true });
        expect(request.functionName).toBe('multicall');
        const calls = (request.args as readonly [`0x${ string }`[]])[0];
        expect(calls).toHaveLength(2);
        const swap = decodeFunctionData({ abi: request.abi, data: calls[0] });
        const unwrap = decodeFunctionData({ abi: request.abi, data: calls[1] });
        expect((swap.args?.[0] as { recipient: string }).recipient).toBe('0x0000000000000000000000000000000000000000');
        expect(unwrap.functionName).toBe('unwrapWETH9');
        expect(unwrap.args).toEqual([900n, OWNER]);
    });

    it('uses address(2), not address(0), for the same trick on 02', async () =>
    {
        script.router = '02';
        const v3 = await loadV3();
        const request = await v3.buildV3Swap({ ...base, nativeOut: true });
        const [, calls] = request.args as [bigint, `0x${ string }`[]];
        expect(calls).toHaveLength(2);
        const swap = decodeFunctionData({ abi: request.abi, data: calls[0] });
        expect((swap.args?.[0] as { recipient: string }).recipient).toBe('0x0000000000000000000000000000000000000002');
        expect(decodeFunctionData({ abi: request.abi, data: calls[1] }).functionName).toBe('unwrapWETH9');
    });
});

describe('pool discovery', () =>
{
    it('finds a pair at every tier it has been deployed at', async () =>
    {
        script.tiers = { 500: 10, 3000: 60 };
        addPool(500, POOL_500, { tick: 100 });
        addPool(3000, POOL_3000, { tick: 200 });
        const v3 = await loadV3();
        const pools = await v3.poolsForPair(FACTORY, USDT, WNURA);
        expect(pools.map((pool) => pool.fee).sort((left, right) => left - right)).toEqual([500, 3000]);
        // token0/token1 come from the address ordering, not the argument order.
        expect(pools[0].token0.toLowerCase() < pools[0].token1.toLowerCase()).toBe(true);
        expect(pools.find((pool) => pool.fee === 3000)?.tickSpacing).toBe(60);
    });

    // A pool contract can exist with no opening price. It cannot quote and it
    // cannot be charted, so listing it would offer a trade nothing can fill.
    it('skips a pool nobody has initialized', async () =>
    {
        script.tiers = { 3000: 60 };
        addPool(3000, POOL_3000, { sqrtPriceX96: 0n });
        const v3 = await loadV3();
        expect(await v3.poolsForPair(FACTORY, WNURA, USDT)).toEqual([]);
    });

    it('answers nothing for a token paired with itself', async () =>
    {
        const v3 = await loadV3();
        expect(await v3.poolsForPair(FACTORY, WNURA, WNURA)).toEqual([]);
    });

    it('sweeps every unordered pair across every tier', async () =>
    {
        script.tiers = { 500: 10, 3000: 60 };
        addPool(3000, POOL_3000);
        script.pools.set(poolKeyOf(WNURA, ALPHA, 500), {
            address: '0x0000000000000000000000000000000000000303' as Address,
            sqrtPriceX96: Q96,
            tick: 0,
            liquidity: 1n
        });
        const v3 = await loadV3();
        const pools = await v3.discoverPools(FACTORY, [WNURA, USDT, ALPHA]);
        expect(pools).toHaveLength(2);
        // Three tokens make three pairs, two tiers each: six getPool probes.
        expect(script.calls.filter((name) => name === 'getPool')).toHaveLength(6);
    });

    it('ignores a duplicate token in the sweep list', async () =>
    {
        script.tiers = { 3000: 60 };
        addPool(3000, POOL_3000);
        const v3 = await loadV3();
        expect(await v3.discoverPools(FACTORY, [WNURA, USDT, WNURA])).toHaveLength(1);
    });

    it('reads what each pool physically holds', async () =>
    {
        script.tiers = { 3000: 60 };
        addPool(3000, POOL_3000);
        script.balances.set(`${ WNURA.toLowerCase() }@${ POOL_3000.toLowerCase() }`, 42n);
        script.balances.set(`${ USDT.toLowerCase() }@${ POOL_3000.toLowerCase() }`, 84n);
        const v3 = await loadV3();
        const pools = await v3.poolsForPair(FACTORY, WNURA, USDT);
        const held = await v3.poolBalances(pools);
        const balance = held.get(POOL_3000.toLowerCase());
        const [token0] = [WNURA, USDT].sort((left, right) => (left.toLowerCase() < right.toLowerCase() ? -1 : 1));
        expect(balance).toEqual(token0 === WNURA ? { amount0: 42n, amount1: 84n } : { amount0: 84n, amount1: 42n });
    });

    it('answers an empty map for no pools rather than calling out', async () =>
    {
        const v3 = await loadV3();
        expect(await v3.poolBalances([])).toEqual(new Map());
        expect(script.calls).toEqual([]);
    });
});

describe('positions', () =>
{
    const position = {
        tokenId: 7n,
        token0: WNURA < USDT ? WNURA : USDT,
        token1: WNURA < USDT ? USDT : WNURA,
        fee: 3000,
        tickLower: -600,
        tickUpper: 600,
        liquidity: 10n ** 18n
    };

    it('lists what the wallet holds, newest first', async () =>
    {
        script.positions = [position, { ...position, tokenId: 11n }];
        const v3 = await loadV3();
        const positions = await v3.loadPositions(MANAGER, OWNER);
        expect(positions.map((entry) => entry.tokenId)).toEqual([11n, 7n]);
        expect(positions[1].tickLower).toBe(-600);
        expect(positions[1].fee).toBe(3000);
    });

    it('answers nothing for a wallet with no positions, without further calls', async () =>
    {
        const v3 = await loadV3();
        expect(await v3.loadPositions(MANAGER, OWNER)).toEqual([]);
        expect(script.calls).toEqual(['balanceOf']);
    });

    // tokensOwed on `positions()` is only as fresh as the last poke, so fees are
    // read by simulating the collect - which is owner-gated, hence the account.
    it('reads uncollected fees by simulating the collect as the owner', async () =>
    {
        script.owed = { amount0: 5n, amount1: 6n };
        const v3 = await loadV3();
        expect(await v3.collectableFees(MANAGER, 7n, OWNER)).toEqual({ amount0: 5n, amount1: 6n });
        expect(script.calls).toContain('collect');
    });

    it('reports no fees rather than failing when the simulation reverts', async () =>
    {
        script.owed = 'revert';
        const v3 = await loadV3();
        expect(await v3.collectableFees(MANAGER, 7n, OWNER)).toEqual({ amount0: 0n, amount1: 0n });
    });

    it('resolves a position against its pool and its fees in one pass', async () =>
    {
        script.tiers = { 3000: 60 };
        addPool(3000, POOL_3000);
        script.positions = [position];
        script.owed = { amount0: 3n, amount1: 4n };
        const v3 = await loadV3();
        const views = await v3.loadPositionViews(
            { factory: FACTORY, positionManager: MANAGER },
            OWNER,
            (address) => ({ address, symbol: 'TKN', name: 'Token', decimals: 18 })
        );
        expect(views).toHaveLength(1);
        expect(views[0].pool?.address).toBe(POOL_3000);
        expect(views[0].fees0).toBe(3n);
        expect(views[0].active).toBe(true);
        // Tick 0 sits inside [-600, 600), so both sides are held.
        expect(views[0].amount0 > 0n).toBe(true);
        expect(views[0].amount1 > 0n).toBe(true);
    });

    it('still describes a position whose pool cannot be read', async () =>
    {
        script.positions = [position];
        const v3 = await loadV3();
        const views = await v3.loadPositionViews(
            { factory: FACTORY, positionManager: MANAGER },
            OWNER,
            (address) => ({ address, symbol: 'TKN', name: 'Token', decimals: 18 })
        );
        expect(views[0].pool).toBeNull();
        expect(views[0].amount0).toBe(0n);
        expect(views[0].active).toBe(false);
    });
});
