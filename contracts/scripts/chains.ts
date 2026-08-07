export interface ChainProfile
{
    networkName: string;
    rpcUrl: string;
    explorerUrl: string | null;
    // null means "deploy our own WBNB" (local chain); an address means the chain
    // already has a canonical wrapped-native token.
    wbnb: `0x${ string }` | null;
    // Canonical Multicall3 where it exists; null means deploy one locally.
    multicall3: `0x${ string }` | null;
    faucet: boolean;
}

export const CHAIN_PROFILES: Record<number, ChainProfile> =
{
    31337:
    {
        networkName: 'localhost',
        rpcUrl: 'http://127.0.0.1:8545',
        explorerUrl: null,
        wbnb: null,
        multicall3: null,
        faucet: true
    },
    97:
    {
        networkName: 'bscTestnet',
        rpcUrl: process.env.BSC_TESTNET_RPC_URL ?? 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
        explorerUrl: 'https://testnet.bscscan.com',
        wbnb: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
        multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
        faucet: true
    }
};
