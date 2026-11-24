import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SandboxOverview } from '@nexter/contracts';

vi.mock('./sandbox-hooks', () => ({
  useSandboxOverview: vi.fn(),
}));

import { SandboxHealth } from './sandbox-health';
import { useSandboxOverview } from './sandbox-hooks';
import { sandboxOverviewFixture } from './sandbox-test-fixtures';

const mockedOverview = vi.mocked(useSandboxOverview);

function overviewResult(
  state: Partial<UseQueryResult<SandboxOverview, Error>>,
): UseQueryResult<SandboxOverview, Error> {
  return {
    isPending: false,
    isError: false,
    data: sandboxOverviewFixture(),
    error: null,
    refetch: vi.fn(),
    ...state,
  } as unknown as UseQueryResult<SandboxOverview, Error>;
}

beforeEach(() => {
  mockedOverview.mockReturnValue(overviewResult({}));
});

describe('sandbox health', () => {
  it('shows run counts and the universe freshness', () => {
    const html = renderToStaticMarkup(<SandboxHealth />);
    expect(html).toContain('Состояние песочницы');
    expect(html).toContain('Всего запусков');
    expect(html).toContain('Работают');
    expect(html).toContain('3');
    expect(html).toContain('Вселенная: 3 ток.');
    expect(html).toContain('включено 2');
    expect(html).toContain('Данные свежие');
    expect(html).toContain('live-paper');
  });

  it('flags stale tokens and empty runs', () => {
    mockedOverview.mockReturnValue(
      overviewResult({
        data: sandboxOverviewFixture({
          runs: { total: 0, draft: 0, running: 0, paused: 0, stopped: 0, failed: 0, archived: 0 },
          activeRuns: [],
          universe: {
            tokens: 1,
            enabledTokens: 1,
            staleTokens: ['bsc:0xaaa'],
            lastCandleAt: null,
          },
        }),
      }),
    );
    const html = renderToStaticMarkup(<SandboxHealth />);
    expect(html).toContain('Устарело во вселенной: 1');
    expect(html).toContain('Нет свежих данных 1h');
    expect(html).toContain('Запусков пока нет');
  });

  it('shows loading and error states', () => {
    mockedOverview.mockReturnValue(overviewResult({ isPending: true, data: undefined }));
    expect(renderToStaticMarkup(<SandboxHealth />)).toContain('Загрузка');

    mockedOverview.mockReturnValue(
      overviewResult({ isError: true, data: undefined, error: new Error('boom') }),
    );
    const html = renderToStaticMarkup(<SandboxHealth />);
    expect(html).toContain('Не удалось загрузить состояние песочницы');
    expect(html).toContain('Повторить');
  });
});
