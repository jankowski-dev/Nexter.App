import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SandboxReplayChartAction, SandboxReplayChartToken } from '@nexter/contracts';
import { ReplayPriceChart } from './sandbox-replay-chart';

const token: SandboxReplayChartToken = {
  tokenId: 'bsc:0x1111111111111111111111111111111111111111',
  candles: [
    { time: 1_760_000_000_000, openUsd: '10', highUsd: '11', lowUsd: '9', closeUsd: '10.5' },
    { time: 1_760_003_600_000, openUsd: '10.5', highUsd: '12', lowUsd: '10', closeUsd: '11.5' },
  ],
};

const actions: SandboxReplayChartAction[] = [
  {
    id: 'buy-1',
    tokenId: token.tokenId,
    time: 1_760_000_000_000,
    kind: 'buy',
    priceUsd: '10.5',
    amountUsd: '100.00',
    pnlUsd: null,
    reasonCode: 'TREND_PULLBACK_ENTRY',
    reasonText: 'Вход на откате',
    intentId: 'buy-1',
    tradeId: 'trade-1',
  },
  {
    id: 'reject-1',
    tokenId: token.tokenId,
    time: 1_760_003_600_000,
    kind: 'reject',
    priceUsd: null,
    amountUsd: '0.00',
    pnlUsd: null,
    reasonCode: 'RISK_CASH_BUFFER',
    reasonText: 'Недостаточный cash buffer',
    intentId: 'reject-1',
    tradeId: null,
  },
];

describe('ReplayPriceChart', () => {
  it('renders price points and action markers with reasons', () => {
    const html = renderToStaticMarkup(
      <ReplayPriceChart
        token={token}
        actions={actions}
        selectedActionId="buy-1"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('График цены и действий прогона');
    expect(html).toContain('TREND_PULLBACK_ENTRY');
    expect(html).toContain('RISK_CASH_BUFFER');
    expect(html).toContain('Вход на откате');
    expect(html).toContain('role="button"');
  });

  it('shows an honest empty state without candles', () => {
    const html = renderToStaticMarkup(
      <ReplayPriceChart
        token={{ tokenId: token.tokenId, candles: [] }}
        actions={[]}
        selectedActionId={null}
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('нет свечей');
  });
});
