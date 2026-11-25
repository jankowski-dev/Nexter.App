import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type {
  SandboxReplayCreateRequest,
  SandboxReplayDetail,
  SandboxReplayListResponse,
  SandboxReplayPreflightResponse,
  SandboxTokensResponse,
} from '@nexter/contracts';
import { ConfirmProvider } from '@/lib/confirm';

vi.mock('./sandbox-hooks', () => ({
  useSandboxTokens: vi.fn(),
  useSandboxReplayPreflight: vi.fn(),
  useSandboxReplays: vi.fn(),
  useSandboxReplay: vi.fn(),
  useSandboxReplayReport: vi.fn(),
  useCreateSandboxReplay: vi.fn(),
  useCancelSandboxReplay: vi.fn(),
  useArchiveSandboxReplay: vi.fn(),
}));

vi.mock('./sandbox-tokens-drawer', () => ({
  SandboxTokensDrawer: () => null,
}));

import { SandboxReplayTab } from './sandbox-replay-tab';
import {
  useArchiveSandboxReplay,
  useCancelSandboxReplay,
  useCreateSandboxReplay,
  useSandboxReplayPreflight,
  useSandboxReplays,
  useSandboxTokens,
} from './sandbox-hooks';
import {
  sandboxReplayPreflightFixture,
  sandboxReplaySummaryFixture,
  sandboxTokenId,
} from './sandbox-test-fixtures';

const mockedTokens = vi.mocked(useSandboxTokens);
const mockedPreflight = vi.mocked(useSandboxReplayPreflight);
const mockedReplays = vi.mocked(useSandboxReplays);
const mockedCreate = vi.mocked(useCreateSandboxReplay);
const mockedCancel = vi.mocked(useCancelSandboxReplay);
const mockedArchive = vi.mocked(useArchiveSandboxReplay);

function tokensResult(): UseQueryResult<SandboxTokensResponse, Error> {
  return {
    isPending: false,
    isError: false,
    data: {
      tokens: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          tokenKey: sandboxTokenId,
          symbol: 'AAA',
          name: 'Alpha',
          chain: 'bsc',
          contractAddress: '0x1111111111111111111111111111111111111111',
          coingeckoId: null,
          enabled: true,
          createdAt: '2026-11-24T00:00:00.000Z',
          updatedAt: '2026-11-24T00:00:00.000Z',
        },
      ],
    },
    error: null,
    refetch: vi.fn(),
  } as unknown as UseQueryResult<SandboxTokensResponse, Error>;
}

function preflightResult(
  state: Partial<UseQueryResult<SandboxReplayPreflightResponse, Error>> = {},
): UseQueryResult<SandboxReplayPreflightResponse, Error> {
  return {
    isPending: false,
    isError: false,
    data: undefined,
    error: null,
    refetch: vi.fn(),
    ...state,
  } as unknown as UseQueryResult<SandboxReplayPreflightResponse, Error>;
}

function replaysResult(
  state: Partial<UseQueryResult<SandboxReplayListResponse, Error>> = {},
): UseQueryResult<SandboxReplayListResponse, Error> {
  return {
    isPending: false,
    isError: false,
    data: { replays: [], total: 0, limit: 50, offset: 0 },
    error: null,
    refetch: vi.fn(),
    ...state,
  } as unknown as UseQueryResult<SandboxReplayListResponse, Error>;
}

function mutation<TVariables>(): UseMutationResult<
  SandboxReplayDetail,
  Error,
  TVariables,
  unknown
> {
  return {
    isPending: false,
    variables: undefined,
    mutateAsync: vi.fn(),
  } as unknown as UseMutationResult<SandboxReplayDetail, Error, TVariables, unknown>;
}

function renderTab(): string {
  return renderToStaticMarkup(
    <ConfirmProvider>
      <SandboxReplayTab />
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  mockedTokens.mockReturnValue(tokensResult());
  mockedPreflight.mockReturnValue(preflightResult({ data: sandboxReplayPreflightFixture() }));
  mockedReplays.mockReturnValue(replaysResult());
  mockedCreate.mockReturnValue(mutation<SandboxReplayCreateRequest>());
  mockedCancel.mockReturnValue(mutation<string>());
  mockedArchive.mockReturnValue(mutation<string>());
});

describe('sandbox replay tab', () => {
  it('renders the replay form, coverage preflight and history', () => {
    const html = renderTab();
    expect(html).toContain('Исторический прогон');
    expect(html).toContain('Новый прогон');
    expect(html).toContain('Название');
    expect(html).toContain('Период');
    expect(html).toContain('180 дней');
    expect(html).toContain('Начальный капитал');
    expect(html).toContain('Токены прогона');
    expect(html).toContain('AAA');
    expect(html).toContain('Выберите токены для прогона');
    expect(html).toContain('Не выбрано ни одного токена');
    expect(html).toContain('4320 / 4320');
    expect(html).toContain('Запустить прогон');
    expect(html).toContain('Дополнительные настройки');
    expect(html).toContain('Обновить данные');
    expect(html).toContain('Прогонов пока нет');
  });

  it('blocks creation while coverage cannot be verified', () => {
    mockedPreflight.mockReturnValue(
      preflightResult({ isError: true, error: new Error('boom'), data: undefined }),
    );
    const html = renderTab();
    expect(html).toContain('Выберите токены для прогона');
    expect(html).toContain('Повторить проверку');
    expect(html).toContain('disabled');
  });

  it('renders the history rows inside the tab', () => {
    mockedReplays.mockReturnValue(
      replaysResult({
        data: { replays: [sandboxReplaySummaryFixture()], total: 1, limit: 50, offset: 0 },
      }),
    );
    const html = renderTab();
    expect(html).toContain('Прогон 180 дней');
    expect(html).toContain('Завершён');
    expect(html).toContain('Открыть');
  });

  it('never renders a manual buy or add action', () => {
    const html = renderTab();
    expect(html).not.toContain('Купить');
    expect(html).not.toContain('Добавить вручную');
  });
});
