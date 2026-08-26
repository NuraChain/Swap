// The activity feed. Rows carry the two tokens, the direction, and the amounts -
// and multi-hop swaps must not collide on their key.
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
    it('renders both token amounts on a row', async () =>
    {
        market.txs.mockResolvedValue([tx()]);
        const { container } = renderTest(() => TxList({ account: ALICE }));
        await settled();

        const row = container.querySelector('li');
        expect(row?.textContent).toContain('WNURA');
        expect(row?.textContent).toContain('mUSDT');
        expect(row?.textContent).toContain('850');
    });

    it('renders liquidity events alongside swaps, with the kind badge naming each', async () =>
    {
        market.txs.mockResolvedValue([
            tx({ txHash: '0xmint', kind: 'mint' }),
            tx({ txHash: '0xswap' })
        ]);
        const { container } = renderTest(() => TxList({ account: ALICE }));
        await settled();

        const rows = [...container.querySelectorAll('li')];
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('mint');
        expect(rows[1].textContent).toContain('swap');
    });

    it('keeps the kind filter working across a mixed feed', async () =>
    {
        market.txs.mockResolvedValue([
            tx({ txHash: '0x1', kind: 'mint' }),
            tx({ txHash: '0x2', kind: 'swap' }),
            tx({ txHash: '0x3', kind: 'burn' })
        ]);
        const { container } = renderTest(() => TxList({ account: ALICE, filterable: true }));
        await settled();
        expect(container.querySelectorAll('li')).toHaveLength(3);

        const { fire } = await import('@azerothjs/testing');
        fire(container.querySelector('[data-testid="tx-filter-swap"]') as HTMLElement, 'click');
        await settled();

        const rows = [...container.querySelectorAll('li')];
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('swap');
    });

    // The regression: rows were keyed by txHash + timestamp alone. A multi-hop
    // swap emits one Swap event PER POOL inside a single transaction - two rows,
    // same hash, same second - and colliding keys can drop or duplicate rows.
    it('renders every leg of a multi-hop swap, not just one of them', async () =>
    {
        const hop = (pairAddress: string, amountA: bigint, amountB: bigint): TxItem =>
            tx({ txHash: '0xmulti', pairAddress, amountA: amountA.toString(), amountB: amountB.toString() });
        market.txs.mockResolvedValue([
            hop('0xhop1', 10n ** 18n, 2000n * 10n ** 6n),
            hop('0xhop2', 2000n * 10n ** 6n, 5n * 10n ** 18n)
        ]);
        const { container } = renderTest(() => TxList({ account: ALICE }));
        await settled();

        const rows = [...container.querySelectorAll('li')];
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).not.toBe(rows[1].textContent);
    });
});
