import type { BarDiagnostic } from './types';
import { emaSeries, rsiSeries } from './series';

export interface ChartMarker {
  readonly time: string;
  readonly side: 'buy' | 'sell' | 'reject' | 'expire' | 'counterfactual';
  readonly price: string;
  readonly label?: string;
}

export interface RenderChartPagesInput {
  readonly rows: readonly BarDiagnostic[];
  readonly markers: readonly ChartMarker[];
  readonly barsPerPage?: number;
  readonly title?: string;
}

const WIDTH = 1600;
const HEIGHT = 900;
const LEFT = 64;
const RIGHT = 32;
const PRICE_TOP = 96;
const PRICE_BOTTOM = 520;
const VOLUME_TOP = 556;
const VOLUME_BOTTOM = 650;
const RSI_TOP = 682;
const RSI_BOTTOM = 790;
const AXIS_Y = 824;

const UP = '#16a34a';
const DOWN = '#dc2626';
const GRID = '#d4d4d8';
const MUTED = '#71717a';
const TEXT = '#18181b';

const REGIME_FILL: Record<string, string> = {
  TREND_UP: '#22c55e',
  TREND_DOWN: '#ef4444',
  RANGE: '#f59e0b',
  CRASH: '#dc2626',
  RECOVERY: '#3b82f6',
  ILLIQUID: '#a1a1aa',
  UNKNOWN: '#d4d4d8',
};

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function markerIndex(rows: readonly BarDiagnostic[], marker: ChartMarker): number {
  const target = Date.parse(marker.time);
  if (!Number.isFinite(target)) return -1;
  let best = -1;
  let delta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rows.length; index += 1) {
    const current = Math.abs(Date.parse(rows[index]!.closeTime) - target);
    if (current < delta) {
      delta = current;
      best = index;
    }
  }
  return delta <= 2 * 3_600_000 ? best : -1;
}

function polyline(
  values: ReadonlyArray<number | null>,
  xFor: (index: number) => number,
  yFor: (value: number) => number,
  color: string,
  dash?: string,
): string {
  const parts: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === null) continue;
    parts.push(
      `${parts.length === 0 ? 'M' : 'L'}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`,
    );
  }
  if (parts.length === 0) return '';
  return `<path d="${parts.join(' ')}" fill="none" stroke="${color}" stroke-width="2"${
    dash ? ` stroke-dasharray="${dash}"` : ''
  }/>`;
}

/**
 * Builds one SVG per 15-day page. Price is candle-based; the EMA/RSI lines are
 * research indicators, not engine state. Every coordinate is numeric and
 * clamped so a flat or one-bar series cannot emit NaN.
 */
export function renderChartPages(input: RenderChartPagesInput): string[] {
  const barsPerPage = input.barsPerPage ?? 360;
  if (!Number.isInteger(barsPerPage) || barsPerPage <= 0 || input.rows.length === 0) return [];

  const title = input.title ?? 'ETH/BSC diagnostic replay';
  const closes = input.rows.map((row) => Number(row.close));
  const emaFast = emaSeries(closes, 24);
  const emaSlow = emaSeries(closes, 168);
  const rsi = rsiSeries(closes, 14);
  const markerIndexes = input.markers.map((marker) => ({
    marker,
    index: markerIndex(input.rows, marker),
  }));

  const pages: string[] = [];
  for (let start = 0; start < input.rows.length; start += barsPerPage) {
    const end = Math.min(start + barsPerPage, input.rows.length);
    const pageRows = input.rows.slice(start, end);
    const barWidth = (WIDTH - LEFT - RIGHT) / Math.max(1, pageRows.length);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const row of pageRows) {
      min = Math.min(min, finite(Number(row.low)));
      max = Math.max(max, finite(Number(row.high)));
    }
    for (const item of markerIndexes) {
      if (item.index < start || item.index >= end) continue;
      const price = Number(item.marker.price);
      if (Number.isFinite(price)) {
        min = Math.min(min, price);
        max = Math.max(max, price);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    if (max - min < 1e-12) {
      min -= 0.5;
      max += 0.5;
    }
    const range = max - min;
    const priceY = (value: number) =>
      PRICE_BOTTOM - ((finite(value) - min) / range) * (PRICE_BOTTOM - PRICE_TOP);
    const xFor = (localIndex: number) => LEFT + (localIndex + 0.5) * barWidth;

    let maxVolume = 0;
    for (const row of pageRows) maxVolume = Math.max(maxVolume, finite(Number(row.volumeUsd)));
    if (maxVolume <= 0) maxVolume = 1;

    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
      `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
      `<text x="${LEFT}" y="34" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${TEXT}">${escapeXml(
        title,
      )}</text>`,
      `<text x="${LEFT}" y="58" font-family="Arial, sans-serif" font-size="13" fill="${MUTED}">bars ${start}..${
        end - 1
      } · ${escapeXml(pageRows[0]!.closeTime)} → ${escapeXml(pageRows[pageRows.length - 1]!.closeTime)}</text>`,
      `<text x="${WIDTH - RIGHT}" y="34" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="${MUTED}">page ${pages.length + 1}</text>`,
      `<text x="${WIDTH - RIGHT}" y="58" text-anchor="end" font-family="Arial, sans-serif" font-size="10" fill="${MUTED}">regime: TREND_UP green · RANGE amber · TREND_DOWN red · CRASH red · RECOVERY blue</text>`,
    ];

    for (let index = 0; index < pageRows.length; index += 1) {
      const row = pageRows[index]!;
      const fill = REGIME_FILL[row.regime ?? 'UNKNOWN'] ?? REGIME_FILL.UNKNOWN;
      parts.push(
        `<rect x="${(LEFT + index * barWidth).toFixed(1)}" y="${PRICE_TOP}" width="${barWidth.toFixed(
          2,
        )}" height="${PRICE_BOTTOM - PRICE_TOP}" fill="${fill}" opacity="0.08"/>`,
      );
    }

    for (let value = PRICE_TOP; value <= PRICE_BOTTOM; value += (PRICE_BOTTOM - PRICE_TOP) / 4) {
      parts.push(
        `<line x1="${LEFT}" y1="${value.toFixed(1)}" x2="${WIDTH - RIGHT}" y2="${value.toFixed(
          1,
        )}" stroke="${GRID}" stroke-width="1" opacity="0.7"/>`,
      );
    }

    for (let index = 0; index < pageRows.length; index += 1) {
      const row = pageRows[index]!;
      const open = finite(Number(row.open));
      const close = finite(Number(row.close));
      const high = finite(Number(row.high));
      const low = finite(Number(row.low));
      const x = xFor(index);
      const bodyWidth = Math.max(1, barWidth * 0.55);
      const color = close >= open ? UP : DOWN;
      const bodyTop = priceY(Math.max(open, close));
      const bodyBottom = priceY(Math.min(open, close));
      parts.push(
        `<line x1="${x.toFixed(1)}" y1="${priceY(high).toFixed(1)}" x2="${x.toFixed(
          1,
        )}" y2="${priceY(low).toFixed(1)}" stroke="${color}" stroke-width="1"/>`,
        `<rect x="${(x - bodyWidth / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${bodyWidth.toFixed(
          2,
        )}" height="${Math.max(1, bodyBottom - bodyTop).toFixed(1)}" fill="${color}"/>`,
      );
    }

    const pageX = (globalIndex: number) => xFor(globalIndex - start);
    parts.push(
      polyline(emaFast.slice(start, end), pageX, priceY, '#2563eb'),
      polyline(emaSlow.slice(start, end), pageX, priceY, '#7c3aed'),
    );

    for (const item of markerIndexes) {
      if (item.index < start || item.index >= end) continue;
      const local = item.index - start;
      const x = xFor(local);
      const y = priceY(Number(item.marker.price));
      const label = item.marker.label ?? item.marker.side.toUpperCase();
      if (item.marker.side === 'buy') {
        parts.push(
          `<polygon points="${x.toFixed(1)},${(y - 10).toFixed(1)} ${(x - 7).toFixed(1)},${(
            y + 3
          ).toFixed(1)} ${(x + 7).toFixed(1)},${(y + 3).toFixed(
            1,
          )}" fill="${UP}" stroke="#ffffff" stroke-width="1"/>`,
        );
      } else if (item.marker.side === 'sell') {
        parts.push(
          `<polygon points="${x.toFixed(1)},${(y + 10).toFixed(1)} ${(x - 7).toFixed(1)},${(
            y - 3
          ).toFixed(1)} ${(x + 7).toFixed(1)},${(y - 3).toFixed(
            1,
          )}" fill="${DOWN}" stroke="#ffffff" stroke-width="1"/>`,
        );
      } else {
        parts.push(
          `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#f59e0b" stroke="#ffffff"/>`,
        );
      }
      parts.push(
        `<text x="${x.toFixed(1)}" y="${(y - 14).toFixed(
          1,
        )}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="${TEXT}">${escapeXml(
          label,
        )}</text>`,
      );
    }

    parts.push(
      `<text x="${LEFT}" y="${VOLUME_TOP - 8}" font-family="Arial, sans-serif" font-size="11" fill="${MUTED}">Vol USD</text>`,
    );
    for (let index = 0; index < pageRows.length; index += 1) {
      const volume = finite(Number(pageRows[index]!.volumeUsd));
      const height = (volume / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP);
      parts.push(
        `<rect x="${(LEFT + index * barWidth).toFixed(1)}" y="${(VOLUME_BOTTOM - height).toFixed(
          1,
        )}" width="${Math.max(1, barWidth * 0.7).toFixed(2)}" height="${height.toFixed(
          1,
        )}" fill="#94a3b8"/>`,
      );
    }

    parts.push(
      `<text x="${LEFT}" y="${RSI_TOP - 8}" font-family="Arial, sans-serif" font-size="11" fill="${MUTED}">RSI 14</text>`,
      `<line x1="${LEFT}" y1="${(RSI_TOP + (RSI_BOTTOM - RSI_TOP) * 0.3).toFixed(
        1,
      )}" x2="${WIDTH - RIGHT}" y2="${(RSI_TOP + (RSI_BOTTOM - RSI_TOP) * 0.3).toFixed(
        1,
      )}" stroke="${GRID}" stroke-dasharray="4 4"/>`,
      `<line x1="${LEFT}" y1="${(RSI_TOP + (RSI_BOTTOM - RSI_TOP) * 0.7).toFixed(
        1,
      )}" x2="${WIDTH - RIGHT}" y2="${(RSI_TOP + (RSI_BOTTOM - RSI_TOP) * 0.7).toFixed(
        1,
      )}" stroke="${GRID}" stroke-dasharray="4 4"/>`,
    );
    parts.push(
      polyline(
        rsi.slice(start, end),
        pageX,
        (value) => RSI_BOTTOM - (value / 100) * (RSI_BOTTOM - RSI_TOP),
        '#0f766e',
      ),
    );

    for (let index = 0; index < pageRows.length; index += 24) {
      const x = xFor(index);
      const row = pageRows[index]!;
      const label = row.closeTime.slice(0, 16).replace('T', ' ');
      parts.push(
        `<line x1="${x.toFixed(1)}" y1="${AXIS_Y - 4}" x2="${x.toFixed(1)}" y2="${
          AXIS_Y + 4
        }" stroke="${MUTED}"/>`,
        `<text x="${x.toFixed(1)}" y="${AXIS_Y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="${MUTED}">${escapeXml(
          label,
        )}</text>`,
        `<text x="${x.toFixed(1)}" y="${AXIS_Y + 16}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="${MUTED}">bar ${
          start + index
        }</text>`,
      );
    }

    parts.push(
      `<text x="${LEFT}" y="${HEIGHT - 18}" font-family="Arial, sans-serif" font-size="10" fill="${MUTED}">regime background · candles · EMA24 blue · EMA168 purple · buy/sell markers · volume · RSI</text>`,
      '</svg>',
    );
    pages.push(parts.join(''));
  }

  return pages;
}
