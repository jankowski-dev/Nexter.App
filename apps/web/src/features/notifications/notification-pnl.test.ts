import { describe, expect, it } from 'vitest';
import { closedTradePnl } from './notification-pnl';

describe('closedTradePnl', () => {
  it('reads signed P&L for all closed-trade notification types', () => {
    for (const type of ['trade_closed', 'bot_trade_closed', 'bot_positions_closed']) {
      expect(closedTradePnl(type, { realizedPnlUsd: '-12.30' })).toBe('-12.30');
    }
  });

  it('ignores other types and legacy payloads', () => {
    expect(closedTradePnl('bot_stopped', { realizedPnlUsd: '1' })).toBeNull();
    expect(closedTradePnl('bot_positions_closed', { positions: 3 })).toBeNull();
    expect(closedTradePnl('trade_closed', { realizedPnlUsd: 1 })).toBeNull();
  });
});
