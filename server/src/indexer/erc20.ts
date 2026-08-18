// Token metadata comes from the CONTRACT, never from whatever a listing file
// says about it. The deployment artifact names addresses; the symbol, name and
// decimals on screen are read off the chain, so a hand-edited (or stale) artifact
// cannot make the app call a token something it does not call itself.
//
// Two shapes are in the wild: the string ERC20 the standard settled on, and the
// older bytes32 one (pre-standard tokens still hold real balances). A token that
// answers neither keeps the placeholder rather than blocking anything.

import { erc20Abi, parseAbi } from 'viem';
import type { PublicClient } from 'viem';

const ERC20_BYTES32_ABI = parseAbi([
    'function symbol() view returns (bytes32)',
    'function name() view returns (bytes32)'
]);

export interface TokenMetadata
{
    symbol: string;
    name: string;
    decimals: number;
}

export const UNKNOWN_TOKEN: TokenMetadata = { symbol: '???', name: 'Unknown token', decimals: 18 };

function trimBytes(value: string): string
{
    return value.replace(/\0+$/, '');
}

export async function readTokenMetadata(client: PublicClient, address: `0x${ string }`): Promise<TokenMetadata>
{
    let { symbol, name, decimals } = UNKNOWN_TOKEN;
    try
    {
        decimals = await client.readContract({ address, abi: erc20Abi, functionName: 'decimals' });
    }
    catch
    {
        // No decimals() - keep 18 and mark the token unknown-shaped.
    }
    try
    {
        symbol = await client.readContract({ address, abi: erc20Abi, functionName: 'symbol' });
        name = await client.readContract({ address, abi: erc20Abi, functionName: 'name' });
    }
    catch
    {
        try
        {
            const rawSymbol = await client.readContract({ address, abi: ERC20_BYTES32_ABI, functionName: 'symbol' });
            const rawName = await client.readContract({ address, abi: ERC20_BYTES32_ABI, functionName: 'name' });
            symbol = trimBytes(Buffer.from(rawSymbol.slice(2), 'hex').toString('utf8'));
            name = trimBytes(Buffer.from(rawName.slice(2), 'hex').toString('utf8'));
        }
        catch
        {
            // Neither string nor bytes32 metadata - placeholder stands.
        }
    }
    return { symbol, name, decimals };
}
