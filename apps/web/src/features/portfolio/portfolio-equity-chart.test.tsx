import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatCard } from '@/components/ui/stat-card';
import { equitySeriesChange, equitySeriesLabel } from './portfolio-equity-chart';

describe('portfolio equity chart helpers', () => {
  it('formats hour, day and month labels deterministically', () => {
    const date = new Date(2026, 10, 25, 10, 5);
    expect(equitySeriesLabel(date, 'hour')).toBe('10:05');
    expect(equitySeriesLabel(date, 'day')).toBe('25.11');
    expect(equitySeriesLabel(date, 'month')).toBe('ноя 26');
  });

  it('computes absolute and percent change against the first point', () => {
    const change = equitySeriesChange([
      {
        date: '2026-11-01T00:00:00.000Z',
        cashUsd: '0',
        positionsValueUsd: '1000',
        equityUsd: '1000',
      },
      {
        date: '2026-11-02T00:00:00.000Z',
        cashUsd: '0',
        positionsValueUsd: '1100',
        equityUsd: '1100',
      },
    ]);
    expect(change).toEqual({ absoluteUsd: '100.00', percent: '+10.00%' });
    expect(
      equitySeriesChange([
        {
          date: '2026-11-01T00:00:00.000Z',
          cashUsd: '0',
          positionsValueUsd: '1000',
          equityUsd: '1000',
        },
      ]),
    ).toBeNull();
    expect(equitySeriesChange([])).toBeNull();
  });
});

describe('StatCard compact size', () => {
  it('renders a smaller value and padding', () => {
    const html = renderToStaticMarkup(
      <StatCard title="Капитал" value="$1,000" icon="wallet" size="compact" />,
    );
    expect(html).toContain('text-2xl');
    expect(html).not.toContain('text-3xl');
    expect(html).toContain('p-4');
  });
});
