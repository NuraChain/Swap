// Seeds the deployed stack with realistic liquidity and a spread of swaps so the
// indexer, charts, and stats have data. On the local chain, block time is walked
// forward ~1h per trade so hourly candles cover about two days.

import { network } from 'hardhat';
import { parseEther, parseUnits } from 'viem';

import { loadDeployment } from '../../shared/src/deployments.ts';

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
const chainId = await publicClient.getChainId();
const deployment = loadDeployment(chainId);

const tokenBySymbol = Object.fromEntries(deployment.tokens.map((token) => [token.symbol, token]));
const nura = await viem.getContractAt('NuraToken', tokenBySymbol.NURA.address);
const musdt = await viem.getContractAt('MockToken', tokenBySymbol.mUSDT.address);
const router = await viem.getContractAt('UniswapV2Router02', deployment.contracts.router);

const local = chainId === 31337;
const testClient = local ? await viem.getTestClient() : null;

async function confirm(hash: `0x${ string }`): Promise<void>
{
    await publicClient.waitForTransactionReceipt({ hash });
}

function deadline(): bigint
{
    // Generous fixed horizon; the local chain's clock is walked far forward below.
    return BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30);
}

// Prices modeled: BNB $850, NURA $2.50.
const seedUsdt = parseUnits('850000', 6);
const seedNuraForWbnb = parseEther('100000');
const seedNuraForUsdt = parseEther('40000');

console.log('minting and approving');
await confirm(await musdt.write.mint([deployer.account.address, parseUnits('2000000', 6)]));
await confirm(await musdt.write.approve([router.address, parseUnits('2000000', 6)]));
await confirm(await nura.write.approve([router.address, parseEther('200000')]));

console.log('adding liquidity: WBNB/mUSDT');
await confirm(await router.write.addLiquidityETH(
    [musdt.address, seedUsdt, 0n, 0n, deployer.account.address, deadline()],
    { value: parseEther('1000') }
));

console.log('adding liquidity: NURA/WBNB');
await confirm(await router.write.addLiquidityETH(
    [nura.address, seedNuraForWbnb, 0n, 0n, deployer.account.address, deadline()],
    { value: parseEther('294') }
));

console.log('adding liquidity: NURA/mUSDT');
await confirm(await router.write.addLiquidity(
    [nura.address, musdt.address, seedNuraForUsdt, parseUnits('100000', 6), 0n, 0n, deployer.account.address, deadline()]
));

// Deterministic pseudo-random walk (LCG) so reseeding reproduces the same tape.
let lcg = 42;
function next(): number
{
    lcg = (lcg * 1103515245 + 12345) % 2147483648;
    return lcg / 2147483648;
}

const wbnbPath = [deployment.contracts.wbnb, tokenBySymbol.NURA.address] as const;
const usdtPath = [tokenBySymbol.mUSDT.address, tokenBySymbol.NURA.address] as const;

console.log('trading tape: 40 swaps over ~40 hours');
for (let index = 0; index < 40; index++)
{
    if (testClient !== null)
    {
        await testClient.increaseTime({ seconds: 3000 + Math.floor(next() * 1800) });
    }
    const roll = next();
    if (roll < 0.4)
    {
        const bnbIn = parseEther((0.05 + next() * 0.6).toFixed(6));
        await confirm(await router.write.swapExactETHForTokens(
            [0n, [...wbnbPath], deployer.account.address, deadline()],
            { value: bnbIn }
        ));
    }
    else if (roll < 0.7)
    {
        const usdtIn = parseUnits((50 + next() * 900).toFixed(6), 6);
        await confirm(await router.write.swapExactTokensForTokens(
            [usdtIn, 0n, [...usdtPath], deployer.account.address, deadline()]
        ));
    }
    else
    {
        const nuraIn = parseEther((20 + next() * 300).toFixed(6));
        await confirm(await router.write.swapExactTokensForTokens(
            [nuraIn, 0n, [tokenBySymbol.NURA.address, tokenBySymbol.mUSDT.address], deployer.account.address, deadline()]
        ));
    }
}

console.log('seed complete');
