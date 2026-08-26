// Component behaviour through the real compiler and a real DOM: mount, click,
// type, assert. These are the controls that stand between a person and a signed
// transaction, so what is tested is what they COMMUNICATE - which tier is
// selected, which page you are on, whether a token is one the exchange vouches
// for - not how they are built.

import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AmountField from '../src/components/market/amount-field.component.azeroth';
import FeeTierSelect from '../src/components/market/fee-tier-select.component.azeroth';
import TokenSelect from '../src/components/market/token-select.component.azeroth';
import Badge from '../src/components/ui/badge.component.azeroth';
import Button from '../src/components/ui/button.component.azeroth';
import EmptyState from '../src/components/ui/empty-state.component.azeroth';
import Pagination from '../src/components/ui/pagination.component.azeroth';
import { setLang } from '../src/lib/i18n.ts';
import type { TokenRef } from '../src/api.ts';
import type { TierQuote } from '../src/lib/v3.ts';

const WNURA: TokenRef = { address: '0x00000000000000000000000000000000000000b0', symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 };
const USDT: TokenRef = { address: '0x00000000000000000000000000000000000000c0', symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 };
const NATIVE: TokenRef = { address: 'nura', symbol: 'NURA', name: 'NURA', decimals: 18 };

beforeEach(() =>
{
    setLang('en');
});

afterEach(() =>
{
    // Vitest globals are off in this project, so the helper's auto-registration
    // never happens - without this, a portaled modal survives into the next test.
    cleanup();
    setLang('en');
});

/** Reactive writes land on the next macrotask; assertions have to wait for them. */
function settled(): Promise<void>
{
    return new Promise((resolve) =>
    {
        setTimeout(resolve, 0);
    });
}

function byTestId(container: HTMLElement, id: string): HTMLElement
{
    const element = container.querySelector<HTMLElement>(`[data-testid="${ id }"]`);
    if (element === null)
    {
        throw new Error(`no element with data-testid="${ id }"`);
    }
    return element;
}

describe('Pagination', () =>
{
    it('renders nothing at all for a single page with no summary', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 1, pages: 1, onPage: () => undefined }));
        expect(container.querySelector('[data-testid="pagination"]')).toBeNull();
    });

    it('summarizes which rows are on screen', () =>
    {
        const { container } = renderTest(() =>
            Pagination({ page: 2, pages: 5, total: 42, pageSize: 10, onPage: () => undefined }));
        expect(byTestId(container, 'page-range').textContent).toContain('11-20');
        expect(byTestId(container, 'page-range').textContent).toContain('42');
    });

    it('says zero rather than 1-0 on an empty result', () =>
    {
        const { container } = renderTest(() =>
            Pagination({ page: 1, pages: 1, total: 0, pageSize: 10, onPage: () => undefined }));
        expect(byTestId(container, 'page-range').textContent).toContain('0-0');
    });

    it('lists every page while they fit', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 1, pages: 6, onPage: () => undefined }));
        for (let page = 1; page <= 6; page++)
        {
            expect(container.querySelector(`[data-testid="page-${ page }"]`), String(page)).not.toBeNull();
        }
        expect(container.textContent).not.toContain('…');
    });

    // The window is anchored by the first and last page so the ends are always
    // one click away, however long the list is.
    it('truncates a long range but keeps both ends reachable', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 50, pages: 100, onPage: () => undefined }));
        expect(container.querySelector('[data-testid="page-1"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="page-100"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="page-50"]')).not.toBeNull();
        expect(container.textContent).toContain('…');
        expect(container.querySelector('[data-testid="page-25"]')).toBeNull();
    });

    it('slides the window with the current page', () =>
    {
        const near = renderTest(() => Pagination({ page: 2, pages: 100, onPage: () => undefined }));
        expect(near.container.querySelector('[data-testid="page-3"]')).not.toBeNull();
        near.unmount();
        const far = renderTest(() => Pagination({ page: 99, pages: 100, onPage: () => undefined }));
        expect(far.container.querySelector('[data-testid="page-98"]')).not.toBeNull();
        expect(far.container.querySelector('[data-testid="page-3"]')).toBeNull();
    });

    it('marks the current page for a screen reader', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 3, pages: 5, onPage: () => undefined }));
        expect(byTestId(container, 'page-3').getAttribute('aria-current')).toBe('page');
        expect(byTestId(container, 'page-2').getAttribute('aria-current')).toBeNull();
    });

    it('disables the backward steps on the first page', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 1, pages: 5, onPage: () => undefined }));
        expect((byTestId(container, 'page-first') as HTMLButtonElement).disabled).toBe(true);
        expect((byTestId(container, 'page-prev') as HTMLButtonElement).disabled).toBe(true);
        expect((byTestId(container, 'page-next') as HTMLButtonElement).disabled).toBe(false);
    });

    it('disables the forward steps on the last page', () =>
    {
        const { container } = renderTest(() => Pagination({ page: 5, pages: 5, onPage: () => undefined }));
        expect((byTestId(container, 'page-next') as HTMLButtonElement).disabled).toBe(true);
        expect((byTestId(container, 'page-last') as HTMLButtonElement).disabled).toBe(true);
    });

    it('reports the page each control moves to', () =>
    {
        const onPage = vi.fn();
        const { container } = renderTest(() => Pagination({ page: 3, pages: 10, onPage }));
        fire(byTestId(container, 'page-next'), 'click');
        fire(byTestId(container, 'page-prev'), 'click');
        fire(byTestId(container, 'page-first'), 'click');
        fire(byTestId(container, 'page-last'), 'click');
        fire(byTestId(container, 'page-4'), 'click');
        expect(onPage.mock.calls.map((call) => call[0])).toEqual([4, 2, 1, 10, 4]);
    });
});

describe('FeeTierSelect', () =>
{
    const tier = (fee: number, out: bigint): TierQuote => ({ fee, out, pool: { fee } as never });

    it('offers Auto plus one button per tier, labelled as a percentage', () =>
    {
        const { container } = renderTest(() => FeeTierSelect({
            tiers: [tier(500, 10n), tier(3000, 20n)],
            value: null,
            bestFee: 3000,
            onSelect: () => undefined
        }));
        expect(byTestId(container, 'tier-auto').getAttribute('aria-pressed')).toBe('true');
        expect(byTestId(container, 'tier-500').textContent).toContain('0.05%');
        expect(byTestId(container, 'tier-3000').textContent).toContain('0.3%');
    });

    it('marks the tier that quotes best', () =>
    {
        const { container } = renderTest(() => FeeTierSelect({
            tiers: [tier(500, 10n), tier(3000, 20n)],
            value: null,
            bestFee: 3000,
            onSelect: () => undefined
        }));
        expect(byTestId(container, 'tier-3000').textContent).toContain('Best');
        expect(byTestId(container, 'tier-500').textContent).not.toContain('Best');
    });

    // A tier whose pool cannot fill this trade is shown - the pool exists - but
    // it must not be selectable, or the card would quote a route of zero.
    it('disables a tier that cannot fill the trade', () =>
    {
        const { container } = renderTest(() => FeeTierSelect({
            tiers: [tier(500, 0n), tier(3000, 20n)],
            value: null,
            bestFee: 3000,
            onSelect: () => undefined
        }));
        expect((byTestId(container, 'tier-500') as HTMLButtonElement).disabled).toBe(true);
        expect((byTestId(container, 'tier-3000') as HTMLButtonElement).disabled).toBe(false);
    });

    it('reports the pinned tier, and null for Auto', () =>
    {
        const onSelect = vi.fn();
        const { container } = renderTest(() => FeeTierSelect({
            tiers: [tier(500, 10n), tier(3000, 20n)],
            value: 3000,
            bestFee: 3000,
            onSelect
        }));
        fire(byTestId(container, 'tier-500'), 'click');
        fire(byTestId(container, 'tier-auto'), 'click');
        expect(onSelect.mock.calls.map((call) => call[0])).toEqual([500, null]);
    });

    it('does not crown a best tier when there is only one', () =>
    {
        const { container } = renderTest(() => FeeTierSelect({
            tiers: [tier(3000, 20n)],
            value: null,
            bestFee: 3000,
            onSelect: () => undefined
        }));
        expect(byTestId(container, 'tier-3000').textContent).not.toContain('Best');
    });
});

describe('AmountField', () =>
{
    it('shows the label, the token and the balance', () =>
    {
        const { container } = renderTest(() => AmountField({
            label: 'You pay',
            amount: '1.5',
            token: USDT,
            balance: 2_500_000n,
            onPickToken: () => undefined,
            testId: 'amount-in'
        }));
        expect(container.textContent).toContain('You pay');
        expect(container.textContent).toContain('mUSDT');
        expect(container.textContent).toContain('2.5');
        expect((byTestId(container, 'amount-in') as HTMLInputElement).value).toBe('1.5');
    });

    it('reports what was typed', () =>
    {
        const onAmount = vi.fn();
        const { container } = renderTest(() => AmountField({
            label: 'You pay',
            amount: '',
            token: USDT,
            onAmount,
            onPickToken: () => undefined,
            testId: 'amount-in'
        }));
        const input = byTestId(container, 'amount-in') as HTMLInputElement;
        input.value = '12.5';
        fire(input, 'input');
        expect(onAmount).toHaveBeenCalledWith('12.5');
    });

    it('asks for a token when none is chosen', () =>
    {
        const { container } = renderTest(() => AmountField({
            label: 'You receive',
            amount: '',
            token: null,
            onPickToken: () => undefined
        }));
        expect(container.textContent).toContain('Select a token');
    });

    it('opens the picker when the token button is pressed', () =>
    {
        const onPickToken = vi.fn();
        const { container } = renderTest(() => AmountField({
            label: 'You pay',
            amount: '',
            token: USDT,
            onPickToken,
            testId: 'amount-in'
        }));
        fire(byTestId(container, 'amount-in-token'), 'click');
        expect(onPickToken).toHaveBeenCalled();
    });

    it('offers MAX only where the field can be typed into', () =>
    {
        const onMax = vi.fn();
        const editable = renderTest(() => AmountField({
            label: 'You pay',
            amount: '',
            token: USDT,
            balance: 10n,
            onMax,
            onPickToken: () => undefined
        }));
        const maxButton = [...editable.container.querySelectorAll('button')]
            .find((button) => button.textContent?.trim() === 'Max');
        expect(maxButton).toBeDefined();
        fire(maxButton as HTMLElement, 'click');
        expect(onMax).toHaveBeenCalled();
        editable.unmount();

        const readOnly = renderTest(() => AmountField({
            label: 'You receive',
            amount: '5',
            token: USDT,
            balance: 10n,
            readOnly: true,
            onMax,
            onPickToken: () => undefined
        }));
        expect([...readOnly.container.querySelectorAll('button')]
            .some((button) => button.textContent?.trim() === 'Max')).toBe(false);
    });

    it('hides the balance row entirely when there is no balance to show', () =>
    {
        const { container } = renderTest(() => AmountField({
            label: 'You receive',
            amount: '',
            token: USDT,
            balance: null,
            onPickToken: () => undefined
        }));
        expect(container.textContent).not.toContain('Balance');
    });
});

describe('TokenSelect', () =>
{
    const tokens = [NATIVE, WNURA, USDT];

    it('lists the tokens the exchange serves', () =>
    {
        const { container } = renderTest(() => TokenSelect({
            tokens,
            onClose: () => undefined,
            onSelect: () => undefined
        }));
        expect(document.body.textContent).toContain('NURA');
        expect(document.body.textContent).toContain('mUSDT');
        expect(container).toBeDefined();
    });

    it('filters by symbol, by name and by address', async () =>
    {
        const { container } = renderTest(() => TokenSelect({
            tokens,
            onClose: () => undefined,
            onSelect: () => undefined
        }));
        const search = document.body.querySelector<HTMLInputElement>('[data-testid="token-search"]');
        expect(search).not.toBeNull();

        search!.value = 'usdt';
        fire(search as HTMLElement, 'input');
        await settled();
        expect(document.body.querySelector('[data-testid="token-mUSDT"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="token-WNURA"]')).toBeNull();

        search!.value = 'Wrapped';
        fire(search as HTMLElement, 'input');
        await settled();
        expect(document.body.querySelector('[data-testid="token-WNURA"]')).not.toBeNull();

        search!.value = USDT.address;
        fire(search as HTMLElement, 'input');
        await settled();
        expect(document.body.querySelector('[data-testid="token-mUSDT"]')).not.toBeNull();
        expect(container).toBeDefined();
    });

    it('leaves out the token already chosen on the other side', () =>
    {
        renderTest(() => TokenSelect({
            tokens,
            exclude: USDT.address,
            onClose: () => undefined,
            onSelect: () => undefined
        }));
        expect(document.body.querySelector('[data-testid="token-mUSDT"]')).toBeNull();
        expect(document.body.querySelector('[data-testid="token-WNURA"]')).not.toBeNull();
    });

    it('reports the token that was picked', () =>
    {
        const onSelect = vi.fn();
        renderTest(() => TokenSelect({ tokens, onClose: () => undefined, onSelect }));
        fire(document.body.querySelector('[data-testid="token-mUSDT"]') as HTMLElement, 'click');
        expect(onSelect).toHaveBeenCalledWith(USDT);
    });

    // The phishing case. An address the deployment does not vouch for can call
    // itself anything at all, so importing one must carry the warning - and the
    // warning has to survive a token whose metadata reads cannot be made.
    it('warns before importing a token the exchange does not vouch for', async () =>
    {
        renderTest(() => TokenSelect({ tokens, onClose: () => undefined, onSelect: () => undefined }));
        const search = document.body.querySelector<HTMLInputElement>('[data-testid="token-search"]');
        search!.value = '0xbad0000000000000000000000000000000000001';
        fire(search as HTMLElement, 'input');
        // The metadata reads resolve (and fail) on the microtask queue.
        await settled();
        expect(document.body.textContent).toContain('anyone can deploy a token with any name');
        expect(document.body.textContent).toContain('0xbad0000000000000000000000000000000000001');
    });

    it('does not offer to import an address it already serves', async () =>
    {
        renderTest(() => TokenSelect({ tokens, onClose: () => undefined, onSelect: () => undefined }));
        const search = document.body.querySelector<HTMLInputElement>('[data-testid="token-search"]');
        search!.value = USDT.address;
        fire(search as HTMLElement, 'input');
        await settled();
        expect(document.body.textContent).not.toContain('anyone can deploy a token with any name');
    });
});

describe('Button', () =>
{
    it('calls its handler when pressed', () =>
    {
        const onClick = vi.fn();
        const { container } = renderTest(() => Button({ onClick, testId: 'go', children: 'Swap' }));
        fire(byTestId(container, 'go'), 'click');
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('refuses the click while disabled', () =>
    {
        const onClick = vi.fn();
        const { container } = renderTest(() => Button({ onClick, disabled: true, testId: 'go', children: 'Swap' }));
        expect((byTestId(container, 'go') as HTMLButtonElement).disabled).toBe(true);
    });

    // A busy button is a transaction in flight; a second click would ask the
    // wallet to sign the same trade twice.
    it('blocks a second click while busy, without collapsing', () =>
    {
        const { container } = renderTest(() => Button({ busy: true, testId: 'go', children: 'Swap' }));
        const button = byTestId(container, 'go') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.textContent).toContain('Swap');
        expect(button.querySelector('svg')).not.toBeNull();
    });

    it('defaults to a non-submitting button', () =>
    {
        const { container } = renderTest(() => Button({ testId: 'go', children: 'Swap' }));
        expect((byTestId(container, 'go') as HTMLButtonElement).type).toBe('button');
    });
});

describe('Badge and EmptyState', () =>
{
    it('colours a badge by its tone', () =>
    {
        const rise = renderTest(() => Badge({ tone: 'rise', children: 'up' }));
        expect(rise.container.querySelector('span')?.className).toContain('text-rise');
        rise.unmount();
        const fall = renderTest(() => Badge({ tone: 'fall', children: 'down' }));
        expect(fall.container.querySelector('span')?.className).toContain('text-fall');
    });

    it('shows a title, an optional hint and its own actions', () =>
    {
        const { container } = renderTest(() => EmptyState({
            title: 'No positions',
            hint: 'Add liquidity to start earning.',
            children: Button({ testId: 'cta', children: 'Add' })
        }));
        expect(container.textContent).toContain('No positions');
        expect(container.textContent).toContain('Add liquidity to start earning.');
        expect(byTestId(container, 'cta')).toBeDefined();
    });

    it('omits the hint when there is none', () =>
    {
        const { container } = renderTest(() => EmptyState({ title: 'No pools yet.' }));
        expect(container.textContent?.trim()).toBe('No pools yet.');
    });
});
