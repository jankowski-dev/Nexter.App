import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SandboxTokenList } from './sandbox-token-list';
import type { SandboxCoverage, SandboxToken } from '@nexter/contracts';

const tokenKey = 'bsc:0x1111111111111111111111111111111111111111';
const createdAt = '2026-11-24T00:00:00.000Z';

const token: SandboxToken = {
  id: '22222222-2222-4222-8222-222222222222',
  tokenKey,
  symbol: 'AAA',
  name: 'Alpha',
  chain: 'bsc',
  contractAddress: '0x1111111111111111111111111111111111111111',
  coingeckoId: null,
  enabled: true,
  createdAt,
  updatedAt: createdAt,
};

const coverage: SandboxCoverage = {
  tokenKey,
  timeframe: '1h',
  available: 1200,
  required: 4320,
  firstOpenTime: createdAt,
  lastOpenTime: createdAt,
  gaps: 2,
  synthetic: false,
  stale: false,
  status: 'partial',
  warning: 'История короче 180 дней.',
};

function render(props: Partial<Parameters<typeof SandboxTokenList>[0]> = {}): string {
  return renderToStaticMarkup(
    <SandboxTokenList
      tokens={[]}
      coverageByKey={new Map()}
      pending={false}
      error={null}
      coverageError={null}
      togglingId={null}
      refreshingId={null}
      onToggle={() => undefined}
      onRefresh={() => undefined}
      {...props}
    />,
  );
}

describe('sandbox token list', () => {
  it('shows the empty universe message', () => {
    expect(render()).toContain('В песочнице пока нет токенов');
  });

  it('lists tokens with key, coverage and actions', () => {
    const html = render({
      tokens: [token],
      coverageByKey: new Map([[tokenKey, coverage]]),
    });
    expect(html).toContain('AAA');
    expect(html).toContain('Alpha');
    expect(html).toContain('BSC');
    expect(html).toContain(tokenKey);
    expect(html).toContain('Частично');
    expect(html).toContain('1200 из 4320');
    expect(html).toContain('Включён');
    expect(html).toContain('Отключить AAA');
    expect(html).toContain('Обновить');
  });

  it('marks a token without coverage as unknown', () => {
    const html = render({ tokens: [token] });
    expect(html).toContain('Покрытие неизвестно');
    expect(html).not.toContain('История полная');
  });

  it('never shows a green full-history badge for synthetic, stale or partial data', () => {
    const synthetic = render({
      tokens: [token],
      coverageByKey: new Map([[tokenKey, { ...coverage, status: 'ok', synthetic: true }]]),
    });
    expect(synthetic).toContain('Синтетика');
    expect(synthetic).not.toContain('История полная');

    const stale = render({
      tokens: [token],
      coverageByKey: new Map([[tokenKey, { ...coverage, status: 'ok', stale: true }]]),
    });
    expect(stale).toContain('Устарело');
    expect(stale).not.toContain('История полная');

    const partial = render({
      tokens: [token],
      coverageByKey: new Map([[tokenKey, coverage]]),
    });
    expect(partial).toContain('Частично');
    expect(partial).not.toContain('История полная');
  });

  it('shows full history only for a complete, fresh, real series', () => {
    const html = render({
      tokens: [token],
      coverageByKey: new Map([[tokenKey, { ...coverage, status: 'ok', gaps: 0, available: 4320 }]]),
    });
    expect(html).toContain('История полная');
  });

  it('shows loading and error states', () => {
    expect(render({ pending: true })).toContain('Загрузка токенов');
    expect(render({ error: 'Нет доступа' })).toContain('Нет доступа');
  });

  it('surfaces a failed coverage query', () => {
    expect(render({ tokens: [token], coverageError: 'Покрытие недоступно' })).toContain(
      'Покрытие недоступно',
    );
  });
});
