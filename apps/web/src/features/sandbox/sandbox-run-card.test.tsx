import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SandboxRunCard } from './sandbox-run-card';
import type { SandboxRunSummary } from '@nexter/contracts';

function run(overrides: Partial<SandboxRunSummary> = {}): SandboxRunSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Базовый 1h',
    status: 'draft',
    initialCapitalUsd: '1000.00',
    cashUsd: '1000.00',
    equityUsd: '1042.00',
    peakEquityUsd: '1080.00',
    returnPct: '4.20',
    drawdownPct: '3.5185',
    tokenCount: 2,
    lastBarClose: '2026-11-24T00:00:00.000Z',
    lastTickAt: '2026-11-24T00:01:00.000Z',
    startedAt: null,
    stoppedAt: null,
    archivedAt: null,
    error: null,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    ...overrides,
  };
}

function render(summary: SandboxRunSummary): string {
  return renderToStaticMarkup(<SandboxRunCard run={summary} onAction={() => undefined} />);
}

describe('sandbox run card', () => {
  it('shows status, equity, return and drawdown in Russian', () => {
    const html = render(run());
    expect(html).toContain('Базовый 1h');
    expect(html).toContain('Черновик');
    expect(html).toContain('Капитал');
    expect(html).toContain('Доходность');
    expect(html).toContain('Просадка');
    expect(html).toContain('+4,20%');
    expect(html).toContain('3,52%');
    expect(html).not.toContain('+3,52%');
    expect(html).toContain('2 токена');
  });

  it('offers only draft controls and never a manual buy', () => {
    const html = render(run());
    expect(html).toContain('Изменить');
    expect(html).toContain('Запустить');
    expect(html).toContain('Открыть');
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить');
    expect(html).not.toContain('Пополнить');
  });

  it('offers pause and stop for a running run', () => {
    const html = render(run({ status: 'running', startedAt: '2026-11-24T00:00:00.000Z' }));
    expect(html).toContain('Работает');
    expect(html).toContain('Пауза');
    expect(html).toContain('Остановить');
    expect(html).not.toContain('Запустить');
  });

  it('offers resume and stop for a paused run', () => {
    const html = render(run({ status: 'paused' }));
    expect(html).toContain('Пауза');
    expect(html).toContain('Продолжить');
    expect(html).toContain('Остановить');
  });

  it('offers archive for terminal runs and shows the failure', () => {
    const failed = render(run({ status: 'failed', error: 'Ревизия не прошла сверку' }));
    expect(failed).toContain('Ошибка');
    expect(failed).toContain('Ревизия не прошла сверку');
    expect(failed).toContain('В архив');
    expect(failed).not.toContain('Запустить');

    const stopped = render(run({ status: 'stopped' }));
    expect(stopped).toContain('Остановлен');
    expect(stopped).toContain('В архив');
  });

  it('shows drawdown as an unsigned magnitude', () => {
    const html = render(run({ drawdownPct: '3.5185' }));
    expect(html).toContain('3,52%');
    expect(html).not.toContain('+3,52%');

    const negative = render(run({ drawdownPct: '-3.5185' }));
    expect(negative).toContain('3,52%');
    expect(negative).not.toContain('-3,52%');
  });

  it('marks archived rows read-only', () => {
    const html = render(run({ status: 'stopped', archivedAt: '2026-11-24T01:00:00.000Z' }));
    expect(html).toContain('Архив');
    expect(html).not.toContain('В архив');
  });
});
