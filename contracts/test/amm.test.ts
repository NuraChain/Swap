// The AMM invariants NuraSwap depends on, proven against OUR compiled artifacts:
// the regenerated init code hash, LP mint/burn accounting, the 0.3% swap formula,
// and the router's slippage/deadline guards.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { network } from 'hardhat';
import { encodePacked, getCreate2Address, keccak256, parseEther, parseUnits } from 'viem';

const MINIMUM_LIQUIDITY = 1000n;

function sqrt(value: bigint): bigint
{
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

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint
{
    const amountInWithFee = amountIn * 997n;
    return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

describe('NuraSwap AMM', async () =>
{
    const { viem } = await network.create();
    const publicClient = await viem.getPublicClient();
    const [deployer, trader] = await viem.getWalletClients();

    let factory: Awaited<ReturnType<typeof viem.deployContract>>;
    let router: Awaited<ReturnType<typeof viem.deployContract>>;
    let wbnb: Awaited<ReturnType<typeof viem.deployContract>>;
    let nura: Awaited<ReturnType<typeof viem.deployContract>>;
    let usdt: Awaited<ReturnType<typeof viem.deployContract>>;

    const seedNura = parseEther('40000');
    const seedUsdt = parseUnits('100000', 6);

    async function deadline(offsetSeconds: number): Promise<bigint>
    {
        const block = await publicClient.getBlock();
        return block.timestamp + BigInt(offsetSeconds);
    }

    before(async () =>
    {
        wbnb = await viem.deployContract('WBNB');
        factory = await viem.deployContract('UniswapV2Factory', [deployer.account.address]);
        router = await viem.deployContract('UniswapV2Router02', [factory.address, wbnb.address]);
        nura = await viem.deployContract('NuraToken', [deployer.account.address]);
        usdt = await viem.deployContract('MockToken', ['Mock Tether USD', 'mUSDT', 6, true]);

        await usdt.write.mint([deployer.account.address, parseUnits('1000000', 6)]);
        await nura.write.approve([router.address, parseEther('1000000')]);
        await usdt.write.approve([router.address, parseUnits('1000000', 6)]);
        await router.write.addLiquidity(
            [
                nura.address,
                usdt.address,
                seedNura,
                seedUsdt,
                0n,
                0n,
                deployer.account.address,
                await deadline(600)
            ]
        );
    });

    it('factory pair address matches CREATE2 with our regenerated init code hash', async () =>
    {
        const artifact = JSON.parse(
            readFileSync(
                fileURLToPath(new URL('../artifacts/contracts/core/UniswapV2Pair.sol/UniswapV2Pair.json', import.meta.url)),
                'utf8'
            )
        ) as { bytecode: `0x${ string }` };
        const [a, b] = [nura.address, usdt.address];
        const [token0, token1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
        const predicted = getCreate2Address({
            from: factory.address,
            salt: keccak256(encodePacked(['address', 'address'], [token0, token1])),
            bytecodeHash: keccak256(artifact.bytecode)
        });
        const actual = await factory.read.getPair([a, b]) as `0x${ string }`;
        assert.notEqual(actual, '0x0000000000000000000000000000000000000000');
        assert.equal(predicted.toLowerCase(), actual.toLowerCase());
    });

    it('first liquidity mints sqrt(a*b) LP with MINIMUM_LIQUIDITY locked', async () =>
    {
        const pairAddress = await factory.read.getPair([nura.address, usdt.address]) as `0x${ string }`;
        const pair = await viem.getContractAt('UniswapV2Pair', pairAddress);
        const totalSupply = await pair.read.totalSupply() as bigint;
        const deployerLp = await pair.read.balanceOf([deployer.account.address]) as bigint;
        assert.equal(totalSupply, sqrt(seedNura * seedUsdt));
        assert.equal(deployerLp, totalSupply - MINIMUM_LIQUIDITY);
    });

    it('swap pays out exactly the 0.3%-fee formula amount', async () =>
    {
        const amountIn = parseUnits('500', 6);
        await usdt.write.mint([trader.account.address, amountIn]);
        const traderUsdt = await viem.getContractAt('MockToken', usdt.address, { client: { wallet: trader } });
        const traderRouter = await viem.getContractAt('UniswapV2Router02', router.address, { client: { wallet: trader } });
        await traderUsdt.write.approve([router.address, amountIn]);

        const pairAddress = await factory.read.getPair([nura.address, usdt.address]) as `0x${ string }`;
        const pair = await viem.getContractAt('UniswapV2Pair', pairAddress);
        const [reserve0, reserve1] = await pair.read.getReserves() as [bigint, bigint, number];
        const token0 = await pair.read.token0() as `0x${ string }`;
        const [reserveUsdt, reserveNura] = token0.toLowerCase() === usdt.address.toLowerCase()
            ? [reserve0, reserve1]
            : [reserve1, reserve0];

        const expectedOut = getAmountOut(amountIn, reserveUsdt, reserveNura);
        const quoted = await router.read.getAmountsOut(
            [amountIn, [usdt.address, nura.address]]
        ) as bigint[];
        assert.equal(quoted[1], expectedOut);

        const before = await nura.read.balanceOf([trader.account.address]) as bigint;
        await traderRouter.write.swapExactTokensForTokens(
            [amountIn, expectedOut, [usdt.address, nura.address], trader.account.address, await deadline(600)]
        );
        const after = await nura.read.balanceOf([trader.account.address]) as bigint;
        assert.equal(after - before, expectedOut);
    });

    it('reverts when amountOutMin exceeds the achievable output', async () =>
    {
        const amountIn = parseUnits('100', 6);
        await usdt.write.mint([deployer.account.address, amountIn]);
        const quoted = await router.read.getAmountsOut(
            [amountIn, [usdt.address, nura.address]]
        ) as bigint[];
        await assert.rejects(
            router.write.swapExactTokensForTokens(
                [amountIn, quoted[1] + 1n, [usdt.address, nura.address], deployer.account.address, await deadline(600)]
            ),
            /INSUFFICIENT_OUTPUT_AMOUNT/
        );
    });

    it('reverts when the deadline has passed', async () =>
    {
        await assert.rejects(
            router.write.swapExactTokensForTokens(
                [parseUnits('10', 6), 0n, [usdt.address, nura.address], deployer.account.address, await deadline(-1)]
            ),
            /EXPIRED/
        );
    });

    it('burning LP returns the proportional share of both reserves', async () =>
    {
        const pairAddress = await factory.read.getPair([nura.address, usdt.address]) as `0x${ string }`;
        const pair = await viem.getContractAt('UniswapV2Pair', pairAddress);
        const lpBalance = await pair.read.balanceOf([deployer.account.address]) as bigint;
        const burn = lpBalance / 4n;
        const totalSupply = await pair.read.totalSupply() as bigint;
        const [reserve0, reserve1] = await pair.read.getReserves() as [bigint, bigint, number];

        const expected0 = (burn * reserve0) / totalSupply;
        const expected1 = (burn * reserve1) / totalSupply;
        const token0 = await pair.read.token0() as `0x${ string }`;
        const [expectedNura, expectedUsdt] = token0.toLowerCase() === nura.address.toLowerCase()
            ? [expected0, expected1]
            : [expected1, expected0];

        await pair.write.approve([router.address, burn]);
        const nuraBefore = await nura.read.balanceOf([deployer.account.address]) as bigint;
        const usdtBefore = await usdt.read.balanceOf([deployer.account.address]) as bigint;
        await router.write.removeLiquidity(
            [nura.address, usdt.address, burn, 0n, 0n, deployer.account.address, await deadline(600)]
        );
        const nuraAfter = await nura.read.balanceOf([deployer.account.address]) as bigint;
        const usdtAfter = await usdt.read.balanceOf([deployer.account.address]) as bigint;
        assert.equal(nuraAfter - nuraBefore, expectedNura);
        assert.equal(usdtAfter - usdtBefore, expectedUsdt);
    });
});
