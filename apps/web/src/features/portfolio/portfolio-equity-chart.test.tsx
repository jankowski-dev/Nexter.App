import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatCard } from '@/components/ui/stat-card';
import {
  PortfolioEquityChart,
  equitySeriesChange,
  equitySeriesLabel,
  withLiveEquityPoint,
} from './portfolio-equity-chart';

describe('portfolio equity chart helpers', () => {
  it('formats hour, day and month labels deterministically', () => {
    const date = new Date(2026, 10, 25, 10, 5);
    expect(equitySeriesLabel(date, 'hour')).toBe('10:05');
    expect(equitySeriesLabel(date, 'day')).toBe('25.11');
    expect(equitySeriesLabel(date, 'month')).toBe('ноя 26');
  });

  it('shows a collection note and no change indicator for one point', () => {
    const html = renderToStaticMarkup(
      <PortfolioEquityChart
        series={{
          range: 'hour',
          granularity: 'hour',
          valuation: 'hourly-points',
          note: 'Почасовые точки собираются с 2026-11-25T08:00:00.000Z; показаны последние 24 часа.',
          points: [
            {
              date: '2026-11-25T08:00:00.000Z',
              cashUsd: '1000',
              positionsValueUsd: '0',
              equityUsd: '1000',
            },
          ],
        }}
      />,
    );
    expect(html).toContain('Почасовые точки собираются с');
    expect(html).not.toContain('к первой точке');
  });

  it('replaces the current day snapshot with the live equity point', () => {
    const series = {
      range: 'day' as const,
      granularity: 'day' as const,
      valuation: 'daily-snapshots' as const,
      note: 'Ежедневные снимки капитала.',
      points: [
        {
          date: '2026-11-27T10:00:00.000Z',
          cashUsd: '0',
          positionsValueUsd: '1250',
          equityUsd: '1250',
        },
        {
          date: '2026-11-28T12:00:00.000Z',
          cashUsd: '0.28',
          positionsValueUsd: '1300',
          equityUsd: '1300.23',
        },
      ],
    };
    const updated = withLiveEquityPoint(series, {
      date: '2026-11-28T12:30:00.000Z',
      cashUsd: '0.28',
      positionsValueUsd: '1269.46',
      equityUsd: '1269.74',
    });

    expect(updated.points).toHaveLength(2);
    expect(updated.points.at(-1)?.equityUsd).toBe('1269.74');
  });

  it('appends the live point when the last snapshot is from an earlier bucket', () => {
    const series = {
      range: 'day' as const,
      granularity: 'day' as const,
      valuation: 'daily-snapshots' as const,
      note: 'Ежедневные снимки капитала.',
      points: [
        {
          date: '2026-11-27T10:00:00.000Z',
          cashUsd: '0',
          positionsValueUsd: '1250',
          equityUsd: '1250',
        },
      ],
    };
    const updated = withLiveEquityPoint(series, {
      date: '2026-11-28T12:30:00.000Z',
      cashUsd: '0.28',
      positionsValueUsd: '1269.46',
      equityUsd: '1269.74',
    });

    expect(updated.points).toHaveLength(2);
    expect(updated.points.at(-1)?.equityUsd).toBe('1269.74');
  });

  it('renders the live point as the current capital and explains the note', () => {
    const html = renderToStaticMarkup(
      <PortfolioEquityChart
        series={{
          range: 'day',
          granularity: 'day',
          valuation: 'daily-snapshots',
          note: 'Ежедневные снимки капитала.',
          points: [
            {
              date: '2026-11-27T10:00:00.000Z',
              cashUsd: '0',
              positionsValueUsd: '1250',
              equityUsd: '1250',
            },
            {
              date: '2026-11-28T12:00:00.000Z',
              cashUsd: '0.28',
              positionsValueUsd: '1300',
              equityUsd: '1300.23',
            },
          ],
        }}
        current={{
          date: '2026-11-28T12:30:00.000Z',
          cashUsd: '0.28',
          positionsValueUsd: '1269.46',
          equityUsd: '1269.74',
        }}
      />,
    );

    expect(html).toContain('269,74');
    expect(html).toContain('Последняя точка — текущая оценка.');
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
