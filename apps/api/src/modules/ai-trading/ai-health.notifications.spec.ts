import { describe, expect, it } from 'vitest';
import {
  AI_HEALTH_NOTIFICATION_COOLDOWN_MS,
  decideAiHealthNotification,
  toAiHealthNotificationState,
  type AiHealthNotificationDecision,
  type AiHealthNotificationInput,
  type AiHealthNotificationState,
} from './ai-health.notifications';

const now = new Date('2026-11-22T12:00:00.000Z');
const HOUR_MS = 60 * 60_000;

function state(overrides: Partial<AiHealthNotificationState> = {}): AiHealthNotificationState {
  return {
    level: 'stop',
    reasonCodes: ['QUOTE_STALE'],
    createdAt: new Date(now.getTime() - HOUR_MS),
    ...overrides,
  };
}

function decide(overrides: Partial<AiHealthNotificationInput> = {}): AiHealthNotificationDecision {
  return decideAiHealthNotification({
    level: 'stop',
    reasons: [{ code: 'QUOTE_STALE' }],
    latest: null,
    recent: [],
    now,
    ...overrides,
  });
}

describe('AI health notification policy', () => {
  it('uses a six-hour cooldown by default', () => {
    expect(AI_HEALTH_NOTIFICATION_COOLDOWN_MS).toBe(6 * HOUR_MS);
  });

  it('notifies on the first stop', () => {
    const decision = decide();
    expect(decision.kind).toBe('stop');
    expect(decision.newReasonCodes).toEqual(['QUOTE_STALE']);
    expect(decision.cooldownActive).toBe(false);
  });

  it('notifies on the first review', () => {
    const decision = decide({ level: 'review', reasons: [{ code: 'BOT_ERROR' }] });
    expect(decision.kind).toBe('review');
    expect(decision.newReasonCodes).toEqual(['BOT_ERROR']);
  });

  it('groups all current reasons into one decision', () => {
    const decision = decide({
      level: 'stop',
      reasons: [{ code: 'QUOTE_STALE' }, { code: 'DRAWDOWN' }, { code: 'BOT_ERROR' }],
    });
    expect(decision.kind).toBe('stop');
    expect(decision.signature).toBe('BOT_ERROR,DRAWDOWN,QUOTE_STALE');
    expect(decision.reasonCodes).toEqual(['BOT_ERROR', 'DRAWDOWN', 'QUOTE_STALE']);
    expect(decision.newReasonCodes).toEqual(['BOT_ERROR', 'DRAWDOWN', 'QUOTE_STALE']);
  });

  it('suppresses a repeated stop within the cooldown', () => {
    const previous = state();
    const decision = decide({ latest: previous, recent: [previous] });
    expect(decision.kind).toBeNull();
    expect(decision.cooldownActive).toBe(true);
  });

  it('notifies again after the cooldown', () => {
    const previous = state({
      createdAt: new Date(now.getTime() - AI_HEALTH_NOTIFICATION_COOLDOWN_MS - 1),
    });
    const decision = decide({ latest: previous, recent: [] });
    expect(decision.kind).toBe('stop');
    expect(decision.cooldownActive).toBe(false);
  });

  it('honors an explicit cooldown override', () => {
    const previous = state({ createdAt: new Date(now.getTime() - 2 * HOUR_MS) });
    expect(decide({ latest: previous, recent: [previous] }).kind).toBeNull();
    expect(decide({ latest: previous, recent: [previous], cooldownMs: HOUR_MS }).kind).toBe('stop');
  });

  it('notifies when a new reason appears inside the cooldown', () => {
    const previous = state();
    const decision = decide({
      level: 'stop',
      reasons: [{ code: 'QUOTE_STALE' }, { code: 'DRAWDOWN' }],
      latest: previous,
      recent: [previous],
    });
    expect(decision.kind).toBe('stop');
    expect(decision.reasonCodes).toEqual(['DRAWDOWN', 'QUOTE_STALE']);
    expect(decision.newReasonCodes).toEqual(['DRAWDOWN']);
  });

  it('does not re-notify a reason already reported earlier in the cooldown', () => {
    const first = state({
      reasonCodes: ['QUOTE_STALE'],
      createdAt: new Date(now.getTime() - 3 * HOUR_MS),
    });
    const second = state({
      reasonCodes: ['DRAWDOWN'],
      createdAt: new Date(now.getTime() - HOUR_MS),
    });
    const decision = decide({
      level: 'stop',
      reasons: [{ code: 'QUOTE_STALE' }],
      latest: second,
      recent: [second, first],
    });
    expect(decision.kind).toBeNull();
  });

  it('suppresses review flaps for the same reason', () => {
    const previous = state({ level: 'review', reasonCodes: ['BOT_ERROR'] });
    const decision = decide({
      level: 'review',
      reasons: [{ code: 'BOT_ERROR' }],
      latest: previous,
      recent: [previous],
    });
    expect(decision.kind).toBeNull();
  });

  it('still sends a review reminder after the cooldown', () => {
    const previous = state({
      level: 'review',
      reasonCodes: ['BOT_ERROR'],
      createdAt: new Date(now.getTime() - AI_HEALTH_NOTIFICATION_COOLDOWN_MS - 1),
    });
    const decision = decide({
      level: 'review',
      reasons: [{ code: 'BOT_ERROR' }],
      latest: previous,
      recent: [],
    });
    expect(decision.kind).toBe('review');
  });

  it('escalates a review to a stop inside the cooldown', () => {
    const previous = state({ level: 'review', reasonCodes: ['QUOTE_STALE'] });
    const decision = decide({ latest: previous, recent: [previous] });
    expect(decision.kind).toBe('stop');
    expect(decision.newReasonCodes).toEqual([]);
  });

  it('does not send recovery when no stop was notified', () => {
    expect(decide({ level: 'ok', reasons: [] }).kind).toBeNull();

    const review = state({ level: 'review', reasonCodes: ['BOT_ERROR'] });
    const afterReview = decide({
      level: 'ok',
      reasons: [],
      latest: review,
      recent: [review],
    });
    expect(afterReview.kind).toBeNull();
  });

  it('suppresses recovery while the stop is inside the cooldown', () => {
    const previous = state();
    const decision = decide({
      level: 'ok',
      reasons: [],
      latest: previous,
      recent: [previous],
    });
    expect(decision.kind).toBeNull();
    expect(decision.cooldownActive).toBe(true);
  });

  it('sends recovery after the cooldown', () => {
    const previous = state({
      createdAt: new Date(now.getTime() - AI_HEALTH_NOTIFICATION_COOLDOWN_MS - 1),
    });
    const decision = decide({
      level: 'ok',
      reasons: [],
      latest: previous,
      recent: [],
    });
    expect(decision.kind).toBe('recovered');
    expect(decision.signature).toBe('');
    expect(decision.reasonCodes).toEqual([]);
  });

  it('does not repeat recovery after an ok notification', () => {
    const previous = state({
      level: 'ok',
      reasonCodes: [],
      createdAt: new Date(now.getTime() - AI_HEALTH_NOTIFICATION_COOLDOWN_MS - 1),
    });
    const decision = decide({
      level: 'ok',
      reasons: [],
      latest: previous,
      recent: [],
    });
    expect(decision.kind).toBeNull();
  });
});

describe('AI health notification payload parsing', () => {
  it('ignores malformed payloads and timestamps', () => {
    expect(toAiHealthNotificationState(null, now)).toBeNull();
    expect(toAiHealthNotificationState({ level: 'unknown' }, now)).toBeNull();
    expect(
      toAiHealthNotificationState(
        { level: 'stop', reasons: ['QUOTE_STALE'] },
        new Date('not-a-date'),
      ),
    ).toBeNull();
  });

  it('reads reason codes from payload reasons or the legacy signature', () => {
    expect(
      toAiHealthNotificationState({ level: 'stop', reasons: ['QUOTE_STALE', 'DRAWDOWN'] }, now)
        ?.reasonCodes,
    ).toEqual(['QUOTE_STALE', 'DRAWDOWN']);
    expect(
      toAiHealthNotificationState({ level: 'stop', signature: 'QUOTE_STALE,DRAWDOWN' }, now)
        ?.reasonCodes,
    ).toEqual(['QUOTE_STALE', 'DRAWDOWN']);
    expect(toAiHealthNotificationState({ level: 'ok', signature: 'ok' }, now)?.reasonCodes).toEqual(
      [],
    );
  });
});
