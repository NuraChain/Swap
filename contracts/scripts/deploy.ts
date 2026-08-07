// Deploys the full NuraSwap stack to the network selected with --network and
// writes the typed deployment artifact into shared/deployments/<chainId>.json.
// startBlock is captured BEFORE the factory deploy - the indexer scans from it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { network } from 'hardhat';
import { encodePacked, getCreate2Address, keccak256 } from 'viem';

import { CHAIN_PROFILES } from './chains.ts';

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
const chainId = await publicClient.getChainId();

const profile = CHAIN_PROFILES[chainId];
if (profile === undefined)
{
    throw new Error(`no chain profile for chainId ${ chainId }`);
}

console.log(`deploying to ${ profile.networkName } (chainId ${ chainId }) as ${ deployer.account.address }`);
const startBlock = Number(await publicClient.getBlockNumber());

const wbnbAddress = profile.wbnb ?? (await viem.deployContract('WBNB')).address;
const factory = await viem.deployContract('UniswapV2Factory', [deployer.account.address]);
const router = await viem.deployContract('UniswapV2Router02', [factory.address, wbnbAddress]);
const multicall3 = profile.multicall3 ?? (await viem.deployContract('Multicall3')).address;

const nura = await viem.deployContract('NuraToken', [deployer.account.address]);
const mockSpecs = [
    { name: 'Mock Tether USD', symbol: 'mUSDT', decimals: 6 },
    { name: 'Mock USD Coin', symbol: 'mUSDC', decimals: 6 },
    { name: 'Mock Dai', symbol: 'mDAI', decimals: 18 },
    { name: 'Mock Wrapped BTC', symbol: 'mWBTC', decimals: 8 }
] as const;
const mocks = [];
for (const spec of mockSpecs)
{
    const token = await viem.deployContract(
        'MockToken',
        [spec.name, spec.symbol, spec.decimals, profile.faucet]
    );
    mocks.push({ ...spec, address: token.address });
}

// Early init-hash sanity: the JS CREATE2 prediction from OUR Pair bytecode must
// match what the factory actually deploys. The router-path proof lives in tests
// and in the seed script's addLiquidity calls.
const pairArtifact = JSON.parse(
    readFileSync(
        fileURLToPath(new URL('../artifacts/contracts/core/UniswapV2Pair.sol/UniswapV2Pair.json', import.meta.url)),
        'utf8'
    )
) as { bytecode: `0x${ string }` };
const probeA = nura.address;
const probeB = mocks[0].address;
await factory.write.createPair([probeA, probeB]);
const [token0, token1] = probeA.toLowerCase() < probeB.toLowerCase() ? [probeA, probeB] : [probeB, probeA];
const predicted = getCreate2Address({
    from: factory.address,
    salt: keccak256(encodePacked(['address', 'address'], [token0, token1])),
    bytecodeHash: keccak256(pairArtifact.bytecode)
});
const actual = await factory.read.getPair([probeA, probeB]);
if (predicted.toLowerCase() !== actual.toLowerCase())
{
    throw new Error(`init code hash mismatch: predicted ${ predicted }, factory says ${ actual }`);
}
console.log(`init code hash verified via CREATE2 probe pair ${ actual }`);

const deployment = {
    chainId,
    networkName: profile.networkName,
    rpcUrl: profile.rpcUrl,
    explorerUrl: profile.explorerUrl,
    faucet: profile.faucet,
    startBlock,
    contracts:
    {
        factory: factory.address,
        router: router.address,
        wbnb: wbnbAddress,
        multicall3
    },
    tokens: [
        { address: nura.address, symbol: 'NURA', name: 'Nura', decimals: 18 },
        { address: wbnbAddress, symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18 },
        ...mocks.map((mock) => ({ address: mock.address, symbol: mock.symbol, name: mock.name, decimals: mock.decimals }))
    ]
};

const outDir = fileURLToPath(new URL('../../shared/deployments/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const outFile = `${ outDir }${ chainId }.json`;
writeFileSync(outFile, `${ JSON.stringify(deployment, null, 4) }\n`);
console.log(`deployment written: ${ outFile }`);
