// The activity feed carries both exchanges in one list. That is only readable if
// every row says which one it came from - the same pair trades at two different
// prices in the two contracts, and "1 WNURA -> 850 mUSDT" means a different thing
// depending on which pool filled it.
//
// The api module is mocked here rather than in components.spec.ts because
// vi.mock is file-scoped, and TxList is the only component in the inventory that
// fetches its own rows.

import { cleanup, renderTest } from '@azerothjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TxItem } from '../src/api.ts';

const market = { txs: vi.fn() };

vi.mock('../src/api.ts', () => ({ client: { market } }));

const { default: TxList } = await import('../src/components/market/tx-list.component.azeroth');
const { setLang } = await import('../src/lib/i18n.ts');

const WNURA = { address: '0x00000000000000000000000000000000000000b0', symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 };
const USDT = { address: '0x00000000000000000000000000000000000000c0', symbol: 'mUSDT', name: 'Mock Tether USD', decimals: 6 };
const ALICE = '0x00000000000000000000000000000000000000cc';

function tx(overrides: Partial<TxItem> = {}): TxItem
{
    return {
        txHash: '0xaaa',
        protocol: 'v2',
        kind: 'swap',
        timestamp: 1_700_000_000,
        account: ALICE,
        pairAddress: '0x00000000000000000000000000000000000000aa',
        tokenA: WNURA,
        amountA: (10n ** 18n).toString(),
        tokenB: USDT,
        amountB: (850n * 10n ** 6n).toString(),
        ...overrides
    };
}

/** Reactive writes land on the next macrotask; assertions have to wait for them. */
function settled(): Promise<void>
{
    return new Promise((resolve) =>
    {
        setTimeout(resolve, 0);
    });
}

beforeEach(() =>
{
    setLang('en');
    market.txs.mockReset();
});

afterEach(() =>
{
    cleanup();
    setLang('en');
});

describe('TxList', () =>
{
    it('names the exchange on every row, not just the V3 ones', async () =>
    {
        market.txs.mockResolvedValue([
            tx({ txHash: '0xv3', protocol: 'v3', kind: 'mint' }),
            tx({ txHash: '0xv2', protocol: 'v2' })
        ]);
        const { container } = renderTest(() => TxList({ account: ALICE }));
        await settled();

        const rows = [...container.querySelectorAll('li')];
        expect(rows).toHaveLength(2);
        // An unmarked row would mean "V2" by a convention nobody is told.
        expect(rows[0].textContent).toContain('V3');
        expect(rows[0].textContent).toContain('mint');
        expect(rows[1].textContent).toContain('V2');
        expect(rows[1].textContent).toContain('swap');
    });

    it('renders a V3 row with both token amounts, same as a V2 one', async () =>
    {
        market.txs.mockResolvedValue([tx({ protocol: 'v3' })]);
        const { container } = renderTest(() => TxList({ account: ALICE }));
        await settled();

        const row = container.querySelector('li');
        expect(row?.textContent).toContain('WNURA');
        expect(row?.textContent).toContain('mUSDT');
        expect(row?.textContent).toContain('850');
    });

    it('keeps the kind filter working across a mixed feed', async () =>
    {
        market.txs.mockResolvedValue([
            tx({ txHash: '0x1', protocol: 'v3', kind: 'mint' }),
            tx({ txHash: '0x2', protocol: 'v2', kind: 'swap' }),
            tx({ txHash: '0x3', protocol: 'v3', kind: 'swap' })
        ]);
        const { container } = renderTest(() => TxList({ account: ALICE, filterable: true }));
        await settled();
        expect(container.querySelectorAll('li')).toHaveLength(3);

        const { fire } = await import('@azerothjs/testing');
        fire(container.querySelector('[data-testid="tx-filter-swap"]') as HTMLElement, 'click');
        await settled();

        const rows = [...container.querySelectorAll('li')];
        expect(rows).toHaveLength(2);
        // The filter is by kind, so it cuts across both exchanges rather than
        // quietly becoming a protocol filter.
        expect(rows.map((row) => (row.textContent?.includes('V3') ?? false))).toEqual([false, true]);
    });
});
