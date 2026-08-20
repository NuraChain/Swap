// Token metadata is a TRUST boundary: the artifact says which addresses this
// exchange serves, the contract says what they are called. Everything here is
// about degrading honestly - a token that will not answer must end up visibly
// unknown, never silently mislabelled and never blank.

import { describe, expect, it } from 'vitest';

import { UNKNOWN_TOKEN, readTokenMetadata } from '../src/indexer/erc20.ts';

const TOKEN = '0x0000000000000000000000000000000000000001' as `0x${ string }`;

type Answer = string | number | 'revert';

interface Answers
{
    decimals?: Answer;
    symbol?: Answer;
    name?: Answer;
    symbolBytes32?: Answer;
    nameBytes32?: Answer;
}

interface AbiEntry
{
    name?: string;
    outputs?: Array<{ type: string }>;
}

/** Right-pads a string into a bytes32 word, the way the pre-standard tokens do. */
function bytes32(text: string): `0x${ string }`
{
    const hex = [...text].map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return `0x${ hex.padEnd(64, '0') }`;
}

/** A client that answers only what the scenario declares; the rest revert. */
function fakeClient(answers: Answers): never
{
    const calls: string[] = [];
    const client = {
        calls,
        readContract: async ({ abi, functionName }: { abi: unknown; functionName: string }): Promise<unknown> =>
        {
            const entry = (abi as AbiEntry[]).find((item) => item.name === functionName);
            const wantsBytes32 = entry?.outputs?.[0]?.type === 'bytes32';
            const key = wantsBytes32 ? `${ functionName }Bytes32` : functionName;
            calls.push(key);
            const answer = (answers as Record<string, Answer | undefined>)[key];
            if (answer === undefined || answer === 'revert')
            {
                throw new Error('execution reverted');
            }
            return answer;
        }
    };
    return client as never;
}

describe('readTokenMetadata', () =>
{
    it('reads a standard string ERC20', async () =>
    {
        const metadata = await readTokenMetadata(
            fakeClient({ decimals: 6, symbol: 'mUSDT', name: 'Mock Tether USD' }),
            TOKEN
        );
        expect(metadata).toEqual({ symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 });
    });

    it('keeps 18 decimals when decimals() reverts but still reads the names', async () =>
    {
        const metadata = await readTokenMetadata(
            fakeClient({ decimals: 'revert', symbol: 'ODD', name: 'Odd token' }),
            TOKEN
        );
        expect(metadata).toEqual({ symbol: 'ODD', name: 'Odd token', decimals: 18 });
    });

    it('accepts zero decimals as a real answer, not a missing one', async () =>
    {
        const metadata = await readTokenMetadata(
            fakeClient({ decimals: 0, symbol: 'WHOLE', name: 'Whole units' }),
            TOKEN
        );
        expect(metadata.decimals).toBe(0);
    });

    // The pre-standard shape: MKR and friends return bytes32, and viem's string
    // decode throws on them. These tokens hold real balances, so they have to work.
    it('falls back to bytes32 metadata and trims the padding', async () =>
    {
        const metadata = await readTokenMetadata(
            fakeClient({
                decimals: 18,
                symbol: 'revert',
                symbolBytes32: bytes32('MKR'),
                nameBytes32: bytes32('Maker')
            }),
            TOKEN
        );
        expect(metadata).toEqual({ symbol: 'MKR', name: 'Maker', decimals: 18 });
    });

    it('reads a bytes32 word that fills all 32 bytes', async () =>
    {
        const full = 'A'.repeat(32);
        const metadata = await readTokenMetadata(
            fakeClient({ decimals: 18, symbol: 'revert', symbolBytes32: bytes32(full), nameBytes32: bytes32(full) }),
            TOKEN
        );
        expect(metadata.symbol).toBe(full);
        expect(metadata.symbol).toHaveLength(32);
    });

    // symbol() and name() are read in one try block on purpose: a token that
    // answers one as a string and the other as bytes32 does not exist, and
    // mixing the two would produce a name from one ABI and a symbol from another.
    it('takes both names from bytes32 when only name() answers as a string', async () =>
    {
        const metadata = await readTokenMetadata(
            fakeClient({
                decimals: 18,
                symbol: 'revert',
                name: 'Ignored',
                symbolBytes32: bytes32('OLD'),
                nameBytes32: bytes32('Old token')
            }),
            TOKEN
        );
        expect(metadata.symbol).toBe('OLD');
        expect(metadata.name).toBe('Old token');
    });

    it('keeps the unknown placeholder when the contract answers nothing at all', async () =>
    {
        const metadata = await readTokenMetadata(fakeClient({}), TOKEN);
        expect(metadata).toEqual(UNKNOWN_TOKEN);
        expect(metadata.symbol).toBe('???');
        expect(metadata.decimals).toBe(18);
    });

    it('keeps the placeholder for an address with no contract behind it', async () =>
    {
        const metadata = await readTokenMetadata(
            fakeClient({ decimals: 'revert', symbol: 'revert', symbolBytes32: 'revert' }),
            TOKEN
        );
        expect(metadata).toEqual(UNKNOWN_TOKEN);
    });

    // A zero word decodes to the empty string. Blank is not more truthful than
    // "???" - it just renders as a nameless chip next to a real balance, which
    // is exactly the shape a phishing token wants.
    it('refuses to report an empty symbol from a zero bytes32 word', async () =>
    {
        const metadata = await readTokenMetadata(
            fakeClient({
                decimals: 18,
                symbol: 'revert',
                symbolBytes32: `0x${ '0'.repeat(64) }`,
                nameBytes32: `0x${ '0'.repeat(64) }`
            }),
            TOKEN
        );
        expect(metadata.symbol).toBe(UNKNOWN_TOKEN.symbol);
        expect(metadata.name).toBe(UNKNOWN_TOKEN.name);
    });

    it('does not let one token read leak into the next', async () =>
    {
        const first = await readTokenMetadata(fakeClient({ decimals: 6, symbol: 'A', name: 'Alpha' }), TOKEN);
        const second = await readTokenMetadata(fakeClient({}), TOKEN);
        expect(first.symbol).toBe('A');
        expect(second.symbol).toBe('???');
        expect(second.decimals).toBe(18);
    });

    it('exposes a frozen-shaped placeholder callers can compare against', () =>
    {
        expect(UNKNOWN_TOKEN).toEqual({ symbol: '???', name: 'Unknown token', decimals: 18 });
    });
});
