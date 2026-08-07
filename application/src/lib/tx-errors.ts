// Wallet and contract failures translated into something a trader can act on.
// Pure classification, split from the wallet store so it is testable without a
// chain: the revert strings below are UniswapV2's own, and getting one wrong
// means telling someone their trade failed for the wrong reason.

export type TxFailure =
    | 'rejected'
    | 'wrongNetwork'
    | 'expired'
    | 'insufficientOutput'
    | 'transferFailed'
    | 'insufficientLiquidity'
    | 'unknown';

// EIP-1193 providers reject with a PLAIN OBJECT ({ code: 4001, message }), not an
// Error - MetaMask among them. Stringifying that yields "[object Object]", so a
// declined signature read as an on-chain failure until this walked the shape.
function textOf(error: unknown): string
{
    if (error instanceof Error)
    {
        return `${ error.message } ${ String((error as { cause?: unknown }).cause ?? '') }`;
    }
    if (typeof error === 'object' && error !== null)
    {
        const shape = error as { code?: unknown; message?: unknown; reason?: unknown };
        return [shape.code, shape.message, shape.reason].filter((part) => part !== undefined).join(' ');
    }
    return String(error);
}

export function classifyTxError(error: unknown): TxFailure
{
    const message = textOf(error);
    // Wallet-level refusal first: a user who declined is not a contract failure.
    if (/user rejected|user denied|ACTION_REJECTED|\b4001\b/i.test(message))
    {
        return 'rejected';
    }
    // sendTx guards the chain before sending, but a wallet can change networks
    // between that check and the signature - viem catches it, and the reason
    // must survive as "wrong network" rather than "failed on-chain".
    if (/ChainMismatch|does not match the target chain|chain of the wallet/i.test(message))
    {
        return 'wrongNetwork';
    }
    if (/EXPIRED/.test(message))
    {
        return 'expired';
    }
    // The slippage bound doing its job - the sandwich case.
    if (/INSUFFICIENT_OUTPUT_AMOUNT|INSUFFICIENT_A_AMOUNT|INSUFFICIENT_B_AMOUNT/.test(message))
    {
        return 'insufficientOutput';
    }
    if (/TRANSFER_FROM_FAILED|TRANSFER_FAILED/.test(message))
    {
        return 'transferFailed';
    }
    // Checked AFTER the output cases: INSUFFICIENT_LIQUIDITY is a substring of
    // neither, but the pair-level names below share the prefix.
    if (/INSUFFICIENT_LIQUIDITY|INSUFFICIENT_INPUT_AMOUNT/.test(message))
    {
        return 'insufficientLiquidity';
    }
    return 'unknown';
}
