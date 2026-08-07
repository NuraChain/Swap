// Test aid: moves a pool hard in one direction from a SECOND account, so a quote
// taken a moment earlier goes stale. That is exactly the sandwich the slippage
// bound exists to stop, and the only honest way to exercise the revert path.
// Not part of the app or any deployment - a manual verification tool.

import { network } from 'hardhat';
import { parseEther } from 'viem';

import { loadDeployment } from '../../shared/src/deployments.ts';

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const wallets = await viem.getWalletClients();
const attacker = wallets[1] ?? wallets[0];
const deployment = loadDeployment(await publicClient.getChainId());

const nura = deployment.tokens.find((token) => token.symbol === 'NURA');
if (nura === undefined)
{
    throw new Error('NURA missing from the deployment artifact');
}

const router = await viem.getContractAt('UniswapV2Router02', deployment.contracts.router, {
    client: { wallet: attacker }
});
const block = await publicClient.getBlock();

console.log(`moving WBNB->NURA from ${ attacker.account.address }`);
const hash = await router.write.swapExactETHForTokens(
    [0n, [deployment.contracts.wbnb, nura.address], attacker.account.address, block.timestamp + 600n],
    { value: parseEther('150') }
);
await publicClient.waitForTransactionReceipt({ hash });
console.log('price moved');
