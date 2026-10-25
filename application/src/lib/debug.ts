// A console trail for the flows that touch the chain, so a report of "nothing
// happens" can be answered from the browser console instead of by guessing.
// Filter the console on `[nuraswap` to see only these lines.

export function trace(scope: string, message: string, data?: unknown): void
{
    if (data === undefined)
    {
        console.info(`[nuraswap:${ scope }] ${ message }`);
        return;
    }
    console.info(`[nuraswap:${ scope }] ${ message }`, data);
}

export function traceError(scope: string, message: string, error: unknown): void
{
    console.error(`[nuraswap:${ scope }] ${ message }`, error);
}
