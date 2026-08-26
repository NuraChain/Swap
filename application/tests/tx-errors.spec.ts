// The revert strings below are the exchange contracts' own. A trader who is told
// the wrong reason takes the wrong action - raising slippage when the pool is
// actually empty, or retrying a trade they themselves declined - so each mapping
// is pinned here rather than exercised through a timing-dependent browser race.

import { describe, expect, it } from 'vitest';

import { classifyTxError } from '../src/lib/tx-errors.ts';

describe('classifyTxError', () =>
{
    it('reads a declined signature as a refusal, not a failure', () =>
    {
        expect(classifyTxError(new Error('User rejected the request.'))).toBe('rejected');
        expect(classifyTxError(new Error('MetaMask Tx Signature: User denied transaction signature.'))).toBe('rejected');
        expect(classifyTxError({ code: 4001, message: 'code 4001 rejected' })).toBe('rejected');
    });

    it('maps the slippage bound firing - the sandwich case', () =>
    {
        expect(classifyTxError(new Error("reverted with reason string 'Too Little Received: INSUFFICIENT_OUTPUT_AMOUNT'")))
            .toBe('insufficientOutput');
        expect(classifyTxError(new Error('SwapRouter: INSUFFICIENT_OUTPUT_AMOUNT'))).toBe('insufficientOutput');
    });

    it('maps a chain mismatch to wrong-network, not a generic on-chain failure', () =>
    {
        // The race: sendTx checks the chain, the user switches networks, then signs.
        expect(classifyTxError(new Error('ChainMismatchError: The current chain of the wallet (id: 1) does not match the target chain for the transaction (id: 97).')))
            .toBe('wrongNetwork');
        expect(classifyTxError({ message: 'chain of the wallet (id: 1)' })).toBe('wrongNetwork');
    });

    it('maps a passed deadline', () =>
    {
        expect(classifyTxError(new Error("reverted with reason string 'Transaction too old: EXPIRED'"))).toBe('expired');
    });

    it('maps failed token transfers', () =>
    {
        expect(classifyTxError(new Error('TransferHelper: TRANSFER_FROM_FAILED'))).toBe('transferFailed');
        expect(classifyTxError(new Error('TransferHelper: TRANSFER_FAILED'))).toBe('transferFailed');
    });

    it('maps a pool too shallow to route', () =>
    {
        expect(classifyTxError(new Error('UniswapV3Pool: INSUFFICIENT_LIQUIDITY'))).toBe('insufficientLiquidity');
        expect(classifyTxError(new Error('Too little received'))).toBe('insufficientLiquidity');
    });

    it('does not mistake INSUFFICIENT_OUTPUT_AMOUNT for a liquidity problem', () =>
    {
        // Both start with INSUFFICIENT_; ordering in the classifier is what keeps
        // "raise your slippage" from becoming "the pool is too shallow".
        expect(classifyTxError(new Error('INSUFFICIENT_OUTPUT_AMOUNT'))).not.toBe('insufficientLiquidity');
    });

    it('falls back to unknown for anything unrecognized', () =>
    {
        expect(classifyTxError(new Error('nonce too low'))).toBe('unknown');
        expect(classifyTxError('a bare string')).toBe('unknown');
        expect(classifyTxError(null)).toBe('unknown');
    });
});
