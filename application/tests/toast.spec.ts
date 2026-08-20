// The toast queue is how a transaction reports back. Two rules carry the whole
// design: a PENDING toast never expires on its own (a transaction in flight must
// not vanish from the screen), and resolving one flips it in place rather than
// pushing a second - so a confirmation replaces its own pending line instead of
// stacking under it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dismissToast, pushToast, resolveToast, toasts } from '../src/lib/toast.ts';

beforeEach(() =>
{
    vi.useFakeTimers();
});

afterEach(() =>
{
    // Drain anything still queued so one test's toasts cannot be seen by the next.
    vi.runOnlyPendingTimers();
    for (const toast of toasts())
    {
        dismissToast(toast.id);
    }
    vi.useRealTimers();
    expect(toasts()).toEqual([]);
});

describe('pushing', () =>
{
    it('adds a toast and hands back an id to resolve it with', () =>
    {
        const id = pushToast('pending', 'Swapping…');
        expect(typeof id).toBe('number');
        expect(toasts()).toHaveLength(1);
        expect(toasts()[0]).toMatchObject({ id, kind: 'pending', text: 'Swapping…' });
    });

    it('gives every toast a distinct id', () =>
    {
        const first = pushToast('info', 'one');
        const second = pushToast('info', 'two');
        expect(first).not.toBe(second);
        expect(new Set(toasts().map((toast) => toast.id)).size).toBe(2);
    });

    it('keeps the queue in the order things happened', () =>
    {
        pushToast('info', 'first');
        pushToast('info', 'second');
        pushToast('info', 'third');
        expect(toasts().map((toast) => toast.text)).toEqual(['first', 'second', 'third']);
    });

    it('carries an explorer link when one is given', () =>
    {
        pushToast('success', 'Confirmed', { href: 'https://explorer.example/tx/0x1', label: 'View' });
        expect(toasts()[0].link).toEqual({ href: 'https://explorer.example/tx/0x1', label: 'View' });
    });
});

describe('expiry', () =>
{
    it('clears a finished toast after six seconds', () =>
    {
        pushToast('success', 'Confirmed');
        expect(toasts()).toHaveLength(1);
        vi.advanceTimersByTime(5999);
        expect(toasts()).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(toasts()).toHaveLength(0);
    });

    // The one that matters: a transaction in flight must stay on screen until it
    // resolves, however long the chain takes.
    it('never expires a pending toast on its own', () =>
    {
        pushToast('pending', 'Approving…');
        vi.advanceTimersByTime(60 * 60 * 1000);
        expect(toasts()).toHaveLength(1);
        expect(toasts()[0].kind).toBe('pending');
    });

    it('expires errors and info the same way as successes', () =>
    {
        pushToast('error', 'Failed');
        pushToast('info', 'Note');
        vi.advanceTimersByTime(6000);
        expect(toasts()).toHaveLength(0);
    });
});

describe('resolving', () =>
{
    it('flips a pending toast in place rather than adding another', () =>
    {
        const id = pushToast('pending', 'Swapping…');
        resolveToast(id, 'success', 'Swap - confirmed');
        expect(toasts()).toHaveLength(1);
        expect(toasts()[0]).toMatchObject({ id, kind: 'success', text: 'Swap - confirmed' });
    });

    it('gives the resolved toast its own eight-second life', () =>
    {
        const id = pushToast('pending', 'Swapping…');
        vi.advanceTimersByTime(30_000);
        resolveToast(id, 'success', 'Confirmed');
        vi.advanceTimersByTime(7999);
        expect(toasts()).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(toasts()).toHaveLength(0);
    });

    it('attaches the explorer link the receipt brought back', () =>
    {
        const id = pushToast('pending', 'Swapping…');
        resolveToast(id, 'success', 'Confirmed', { href: 'https://explorer.example/tx/0xabc', label: 'View' });
        expect(toasts()[0].link?.href).toBe('https://explorer.example/tx/0xabc');
    });

    // sendTx resolves with no link when the deployment names no explorer; the
    // link the toast was pushed with must survive that.
    it('keeps an existing link when the resolution names none', () =>
    {
        const id = pushToast('pending', 'Swapping…', { href: 'https://explorer.example/tx/0x1', label: 'View' });
        resolveToast(id, 'success', 'Confirmed');
        expect(toasts()[0].link?.href).toBe('https://explorer.example/tx/0x1');
    });

    it('leaves the other toasts alone', () =>
    {
        const first = pushToast('pending', 'Approving…');
        const second = pushToast('pending', 'Swapping…');
        resolveToast(first, 'success', 'Approved');
        expect(toasts().find((toast) => toast.id === second)?.kind).toBe('pending');
    });

    it('does nothing for an id that is no longer queued', () =>
    {
        const id = pushToast('success', 'Gone');
        vi.advanceTimersByTime(6000);
        expect(() => resolveToast(id, 'error', 'Too late')).not.toThrow();
        expect(toasts()).toHaveLength(0);
    });
});

describe('dismissing', () =>
{
    it('removes exactly the toast asked for', () =>
    {
        const first = pushToast('pending', 'one');
        const second = pushToast('pending', 'two');
        dismissToast(first);
        expect(toasts().map((toast) => toast.id)).toEqual([second]);
    });

    it('is a no-op for an unknown id', () =>
    {
        pushToast('pending', 'one');
        expect(() => dismissToast(9999)).not.toThrow();
        expect(toasts()).toHaveLength(1);
    });

    it('survives being called twice for the same toast', () =>
    {
        const id = pushToast('pending', 'one');
        dismissToast(id);
        expect(() => dismissToast(id)).not.toThrow();
        expect(toasts()).toEqual([]);
    });

    // The timer fires after a manual dismissal too; it must not resurrect or
    // remove someone else's toast.
    it('does not disturb the queue when a dismissed toast expires later', () =>
    {
        const id = pushToast('success', 'one');
        dismissToast(id);
        const other = pushToast('pending', 'two');
        vi.advanceTimersByTime(10_000);
        expect(toasts().map((toast) => toast.id)).toEqual([other]);
    });
});
