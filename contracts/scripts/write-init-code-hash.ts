// Recomputes the UniswapV2 pair init code hash from OUR compiled Pair bytecode and
// patches the constant in the vendored UniswapV2Library. The published constant is
// mainnet's; without this patch every Router call computes a wrong pair address.
// Flow: hardhat compile -> this script -> hardhat compile (periphery rebuilds).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { keccak256 } from 'viem';

const artifactPath = fileURLToPath(
    new URL('../artifacts/contracts/core/UniswapV2Pair.sol/UniswapV2Pair.json', import.meta.url)
);
const libraryPath = fileURLToPath(
    new URL('../contracts/periphery/libraries/UniswapV2Library.sol', import.meta.url)
);

const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { bytecode: `0x${ string }` };
const hash = keccak256(artifact.bytecode).slice(2);

const source = readFileSync(libraryPath, 'utf8');
const pattern = /hex'[0-9a-f]{64}' \/\/ init code hash/;
if (!pattern.test(source))
{
    throw new Error('init code hash constant not found in UniswapV2Library.sol');
}

const patched = source.replace(pattern, `hex'${ hash }' // init code hash`);
if (patched === source)
{
    console.log(`init code hash already current: 0x${ hash }`);
}
else
{
    writeFileSync(libraryPath, patched);
    console.log(`init code hash written: 0x${ hash }`);
}
