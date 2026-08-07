import hardhatToolboxViem from '@nomicfoundation/hardhat-toolbox-viem';
import { defineConfig } from 'hardhat/config';

// Vendored UniswapV2 pins: core =0.5.16, periphery =0.6.6. Optimizer settings and
// evmVersion are part of the Pair init code hash - do not change them casually.
export default defineConfig({
    plugins: [hardhatToolboxViem],
    solidity: {
        compilers: [
            {
                version: '0.5.16',
                settings: {
                    optimizer: { enabled: true, runs: 999999 },
                    evmVersion: 'istanbul'
                }
            },
            {
                version: '0.6.6',
                settings: {
                    optimizer: { enabled: true, runs: 999999 },
                    evmVersion: 'istanbul'
                }
            },
            {
                version: '0.8.28',
                settings: {
                    optimizer: { enabled: true, runs: 999999 }
                }
            },
            {
                version: '0.8.12',
                settings: {
                    optimizer: { enabled: true, runs: 999999 }
                }
            }
        ]
    },
    networks: {
        bscTestnet: {
            type: 'http',
            url: process.env.BSC_TESTNET_RPC_URL ?? 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
            chainId: 97,
            accounts: process.env.DEPLOYER_PRIVATE_KEY === undefined ? [] : [process.env.DEPLOYER_PRIVATE_KEY]
        }
    }
});
