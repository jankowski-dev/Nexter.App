import { describe, expect, it } from 'vitest';
import {
  equitySeriesQuerySchema,
  settingsInputDefaults,
  viberAckRequestSchema,
  viberFrequencySchema,
  viberNotificationSchema,
} from './index';

describe('ux batch contracts', () => {
  it('defaults trade and viber settings', () => {
    expect(settingsInputDefaults.notifyTradesClosed).toBe(true);
    expect(settingsInputDefaults.viberNotificationsEnabled).toBe(true);
    expect(settingsInputDefaults.viberFrequency).toBe('instant');
    expect(settingsInputDefaults.viberDigestTime).toBe('20:00');
  });

  it('accepts only supported viber frequencies and ack states', () => {
    expect(viberFrequencySchema.parse('hourly')).toBe('hourly');
    expect(viberFrequencySchema.safeParse('weekly').success).toBe(false);
    expect(viberAckRequestSchema.parse({ status: 'sent' })).toEqual({ status: 'sent' });
    expect(viberAckRequestSchema.safeParse({ status: 'pending' }).success).toBe(false);
  });

  it('validates a viber notification and equity range', () => {
    expect(
      viberNotificationSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        type: 'trade_closed',
        title: 'Сделка закрыта: CAKE',
        body: 'P&L: +$12.34',
        payload: { groupId: 'g1' },
        status: 'pending',
        attempts: 0,
        error: null,
        sentAt: null,
        createdAt: '2026-11-25T10:00:00.000Z',
      }).status,
    ).toBe('pending');
    expect(equitySeriesQuerySchema.parse({})).toEqual({ range: 'day' });
  });
});
