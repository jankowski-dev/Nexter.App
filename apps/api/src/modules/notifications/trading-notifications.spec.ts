import { describe, expect, it } from 'vitest';
import {
  botPositionsClosedCopy,
  botStoppedCopy,
  botTradeClosedCopy,
  formatReturnPct,
  formatSignedUsd,
  manualTradeClosedCopy,
} from './trading-notifications.service';

describe('trade notification copy', () => {
  it('formats signed USD and percent', () => {
    expect(formatSignedUsd('12.34')).toBe('+$12.34');
    expect(formatSignedUsd('-5.67')).toBe('-$5.67');
    expect(formatSignedUsd('0')).toBe('$0.00');
    expect(formatReturnPct('12.34', '100')).toBe('+12.34%');
    expect(formatReturnPct('-5.67', '100')).toBe('-5.67%');
    expect(formatReturnPct('5', '0')).toBeNull();
  });

  it('builds manual and bot close copy with P&L', () => {
    const manual = manualTradeClosedCopy({
      groupId: 'group-1',
      symbol: 'LINK',
      realizedPnlUsd: '12.34',
      costBasisUsd: '100',
    });
    expect(manual.title).toBe('Сделка закрыта: LINK');
    expect(manual.body).toContain('P&L: +$12.34 (+12.34%)');
    expect(manual.href).toBe('/trades/group-1');

    const bot = botTradeClosedCopy({
      botId: 'bot-1',
      botName: 'Momentum',
      symbol: 'LINK',
      realizedPnlUsd: '-5.67',
      costBasisUsd: '100',
    });
    expect(bot.title).toBe('Робот «Momentum» закрыл LINK');
    expect(bot.body).toContain('P&L: -$5.67 (-5.67%)');
    expect(bot.href).toBe('/portfolio#robots');
  });

  it('builds close-all and stop copy', () => {
    const all = botPositionsClosedCopy({
      botId: 'bot-1',
      botName: 'Momentum',
      positions: 3,
      realizedPnlUsd: '10',
      costBasisUsd: '200',
    });
    expect(all.title).toBe('Робот «Momentum» закрыл 3 позиции');
    expect(all.body).toContain('Итог: +$10.00 (+5.00%)');

    const stopped = botStoppedCopy({ botId: 'bot-1', botName: 'Momentum', reason: 'ошибка' });
    expect(stopped.title).toBe('Бот остановлен');
    expect(stopped.body).toContain('Momentum');
    expect(stopped.body).toContain('ошибка');
  });
});
