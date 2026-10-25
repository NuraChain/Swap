// The price chart right after a pool's first trade: the server answers with ONE
// hourly candle, and the chart used to need two points before it drew anything.

import { cleanup, renderTest } from '@azerothjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WNURA = { address: '0x00000000000000000000000000000000000000b0', symbol: 'WNURA', name: 'Wrapped NURA', decimals: 18 };
const BNB = { address: '0x00000000000000000000000000000000000000c0', symbol: 'BNB', name: 'Bridge BNB', decimals: 18 };

const candles = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock('../src/api.ts', () => ({
    client: {
        market: {
            pool: vi.fn(async () => ({ token0: WNURA, token1: BNB, candles: candles.list }))
        }
    }
}));

const { default: PriceChart } = await import('../src/components/market/price-chart.component.azeroth');

const tick = (): Promise<void> => new Promise((resolve) =>
{
    setTimeout(resolve, 0);
});

const candle = (hourStart: number, open: string, close: string): unknown =>
    ({ hourStart, open, high: open, low: close, close, volume0: '0', volume1: '0' });

afterEach(() =>
{
    cleanup();
    candles.list = [];
});

describe('the price chart', () =>
{
    it('draws a pool whose only trades are in its first hour', async () =>
    {
        candles.list = [candle(1_792_951_200, '1992027921', '1992027921')];
        const { container } = renderTest(() => PriceChart({ pairAddress: '0x0000000000000000000000000000000000000301' }));
        await tick();
        expect(container.querySelector('svg')).not.toBeNull();
        expect(container.textContent).not.toContain('No trades charted yet');
        // The tiny price stays readable rather than rounding to 0.
        expect(container.textContent).toContain('0.000000001992');
    });

    it('still says so when there is nothing to chart', async () =>
    {
        const { container } = renderTest(() => PriceChart({ pairAddress: '0x0000000000000000000000000000000000000301' }));
        await tick();
        expect(container.querySelector('svg')).toBeNull();
        expect(container.textContent).toContain('No trades charted yet');
    });
});
