import { describe, expect, it } from 'vitest';
import {
  SANDBOX_PATH,
  isSandboxVisible,
  sandboxCoverageWarnings,
  sandboxHashForTab,
  sandboxNavItem,
  sandboxStatusLabels,
  sandboxTabFromHash,
  sandboxTabs,
} from './sandbox-tabs';
import type { SandboxCoverage } from '@nexter/contracts';

describe('sandbox navigation and tabs', () => {
  it('exposes the top-level Песочница entry at /sandbox', () => {
    expect(SANDBOX_PATH).toBe('/sandbox');
    expect(sandboxNavItem.label).toBe('Песочница');
    expect(sandboxNavItem.to).toBe('/sandbox');
  });

  it('lists the four owner sections in order', () => {
    expect(sandboxTabs.map((tab) => tab.label)).toEqual(['Обзор', 'Запуски', 'Журнал', 'Отчёты']);
  });

  it('hides the section unless the status flag is explicitly enabled', () => {
    expect(isSandboxVisible(undefined)).toBe(false);
    expect(isSandboxVisible({ enabled: false, version: 'v1' })).toBe(false);
    expect(isSandboxVisible({ enabled: true, version: 'v1' })).toBe(true);
  });

  it('deep-links tabs through the hash and falls back to Запуски', () => {
    expect(sandboxTabFromHash(undefined)).toBe('runs');
    expect(sandboxTabFromHash('')).toBe('runs');
    expect(sandboxTabFromHash('#unknown')).toBe('runs');
    for (const tab of sandboxTabs) {
      expect(sandboxTabFromHash(sandboxHashForTab(tab.value))).toBe(tab.value);
    }
  });

  it('uses Russian lifecycle labels', () => {
    expect(sandboxStatusLabels).toEqual({
      draft: 'Черновик',
      running: 'Работает',
      paused: 'Пауза',
      stopped: 'Остановлен',
      failed: 'Ошибка',
    });
  });
});

describe('sandbox coverage warnings', () => {
  const symbols = new Map([
    ['bsc:0xaaa', 'AAA'],
    ['binance:BTCUSDT', 'BTC'],
  ]);

  function coverage(overrides: Partial<SandboxCoverage>): SandboxCoverage {
    return {
      tokenKey: 'bsc:0xaaa',
      timeframe: '1h',
      available: 4320,
      required: 4320,
      firstOpenTime: '2026-05-01T00:00:00.000Z',
      lastOpenTime: '2026-11-24T00:00:00.000Z',
      gaps: 0,
      synthetic: false,
      stale: false,
      status: 'ok',
      warning: null,
      ...overrides,
    };
  }

  it('reports a ready universe when every token has full history', () => {
    const result = sandboxCoverageWarnings([coverage({})], ['bsc:0xaaa'], symbols);
    expect(result.status).toBe('ok');
    expect(result.label).toBe('Данные готовы');
    expect(result.warnings).toEqual([]);
  });

  it('requires confirmation for partial history', () => {
    const result = sandboxCoverageWarnings(
      [
        coverage({
          tokenKey: 'binance:BTCUSDT',
          available: 1200,
          required: 4320,
          status: 'partial',
        }),
      ],
      ['binance:BTCUSDT'],
      symbols,
    );
    expect(result.status).toBe('partial');
    expect(result.warnings.join(' ')).toContain('BTC');
    expect(result.warnings.join(' ')).toContain('1200 из 4320');
    expect(result.label).toContain('потребует подтверждения');
  });

  it('blocks a missing series and explains why', () => {
    const result = sandboxCoverageWarnings(
      [coverage({ available: 0, status: 'missing', warning: 'Нет свечей 1h.' })],
      ['bsc:0xaaa'],
      symbols,
    );
    expect(result.status).toBe('missing');
    expect(result.warnings.join(' ')).toContain('Нет свечей 1h.');
    expect(result.label).toBe('Истории нет');
  });

  it('treats a selected token without coverage information as partial', () => {
    const result = sandboxCoverageWarnings([], ['bsc:0xaaa'], symbols);
    expect(result.status).toBe('partial');
    expect(result.warnings.join(' ')).toContain('AAA');
    expect(result.label).toContain('потребует подтверждения');
  });

  it('treats an unavailable coverage query as partial', () => {
    const result = sandboxCoverageWarnings([coverage({})], ['bsc:0xaaa'], symbols, {
      coverageAvailable: false,
    });
    expect(result.status).toBe('partial');
    expect(result.label).toBe('Покрытие неизвестно');
    expect(result.warnings.join(' ')).toContain('Не удалось проверить покрытие');
  });

  it('reports a missing selection', () => {
    expect(sandboxCoverageWarnings([], [], symbols).status).toBe('missing');
  });
});
