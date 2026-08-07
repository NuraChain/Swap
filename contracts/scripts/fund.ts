// Funds YOUR OWN wallet address on a dev chain, so testing with a real wallet
// extension never requires importing the publicly-known hardhat keys:
//
//   npm run fund -- 0xYourAddress
//
// Sends local BNB for gas, mints every mock token to you (deployer-only mint),
// and transfers NURA from the deployer's fixed supply. Refuses to run against
// any chain whose deployment artifact does not carry the faucet flag - this
// script cannot touch a real network.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createPublicClient, createWalletClient, defineChain, http, parseEther, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Hardhat's account #0 - the localhost deployer. Public knowledge, dev chain only.
const HARDHAT_DEPLOYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const MINT_ABI = [{ type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] }] as const;
const TRANSFER_ABI = [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const;

const BNB_AMOUNT = parseEther('100');
const TOKEN_AMOUNT = 10_000;

const target = process.argv[2];
if (target === undefined || !/^0x[0-9a-fA-F]{40}$/.test(target))
{
    console.error('usage: npm run fund -- 0xYourAddress');
    process.exit(1);
}
const to = target as `0x${ string }`;

const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const probe = createPublicClient({ transport: http(rpcUrl) });
const chainId = await probe.getChainId();

const artifactPath = fileURLToPath(new URL(`../../shared/deployments/${ chainId }.json`, import.meta.url));
const deployment = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
    faucet: boolean;
    tokens: { address: `0x${ string }`; symbol: string; decimals: number }[];
};
if (deployment.faucet !== true)
{
    console.error(`refusing: chain ${ chainId } is not a dev chain (no faucet flag in its artifact)`);
    process.exit(1);
}

const key = process.env.DEPLOYER_PRIVATE_KEY ?? (chainId === 31337 ? HARDHAT_DEPLOYER : null);
if (key === null)
{
    console.error('refusing: set DEPLOYER_PRIVATE_KEY for non-localhost chains');
    process.exit(1);
}

const chain = defineChain({
    id: chainId,
    name: `dev-${ chainId }`,
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } }
});
const account = privateKeyToAccount(key as `0x${ string }`);
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

console.log(`funding ${ to } on chain ${ chainId } from ${ account.address }`);

const gas = await wallet.sendTransaction({ to, value: BNB_AMOUNT });
await probe.waitForTransactionReceipt({ hash: gas });
console.log(`  100 BNB sent (${ gas })`);

for (const token of deployment.tokens)
{
    if (token.symbol === 'WBNB')
    {
        continue; // wrap your own - that path is part of what gets tested
    }
    const amount = parseUnits(String(TOKEN_AMOUNT), token.decimals);
    const hash = token.symbol === 'NURA'
        ? await wallet.writeContract({ address: token.address, abi: TRANSFER_ABI, functionName: 'transfer', args: [to, amount] })
        : await wallet.writeContract({ address: token.address, abi: MINT_ABI, functionName: 'mint', args: [to, amount] });
    await probe.waitForTransactionReceipt({ hash });
    console.log(`  ${ TOKEN_AMOUNT } ${ token.symbol } (${ hash })`);
}

console.log('done - connect that address in the app and trade.');
