import { describe, expect, it } from 'vitest';
import { MemoryEventLog } from './memory-event-log';
import type { SandboxDecision, SandboxEventInput } from './event-types';

const base: SandboxEventInput = {
  runId: 'run-1',
  clockTime: '2026-01-01T00:00:00.000Z',
  module: 'data',
  eventType: 'data.tick',
  severity: 'info',
  dataSnapshotId: 'snapshot-1',
  configVersion: 'config-1',
  seed: 7,
};

const decision: SandboxDecision = {
  action: 'buy',
  sizeUsd: '100',
  reasonCode: 'TREND_UP',
  reasonText: 'Trend filter passed',
};

describe('MemoryEventLog', () => {
  it('assigns seq, prevHash and a 64-char hash', async () => {
    const log = new MemoryEventLog();
    const first = await log.append(base);
    const second = await log.append({ ...base, eventType: 'cycle.completed' });
    expect(first.seq).toBe(0);
    expect(first.prevHash).toBe('0'.repeat(64));
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.seq).toBe(1);
    expect(second.prevHash).toBe(first.hash);
  });

  it('is deterministic regardless of recordedAt', async () => {
    const one = new MemoryEventLog();
    const two = new MemoryEventLog();
    await one.append(base);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await two.append(base);
    expect(one.hash()).toBe(two.hash());
  });

  it('excludes timing from the hash', async () => {
    const one = new MemoryEventLog();
    const two = new MemoryEventLog();
    await one.append({ ...base, timing: { durationMs: 1 } });
    await two.append({ ...base, timing: { durationMs: 999 } });
    expect(one.hash()).toBe(two.hash());
  });

  it('rejects missing required fields', async () => {
    const log = new MemoryEventLog();
    await expect(log.append({ ...base, dataSnapshotId: '' })).rejects.toThrow();
  });

  it('requires a reasonCode for decision-like events', async () => {
    const log = new MemoryEventLog();
    await expect(
      log.append({
        ...base,
        module: 'strategy',
        eventType: 'signal.rejected',
        severity: 'decision',
      }),
    ).rejects.toThrow(/reasonCode/);
  });

  it('accepts decision-like events that carry a reasonCode', async () => {
    const log = new MemoryEventLog();
    const event = await log.append({
      ...base,
      module: 'strategy',
      eventType: 'signal.accepted',
      severity: 'decision',
      reasonCode: 'TREND_UP',
    });
    expect(event.reasonCode).toBe('TREND_UP');
  });

  it.each([
    'regime.changed',
    'opportunity.ranked',
    'portfolio.allocated',
    'token.state_changed',
    'decision.cycle',
  ])('requires a reasonCode for the %s family', async (eventType) => {
    const log = new MemoryEventLog();
    await expect(
      log.append({ ...base, module: 'regime', eventType, severity: 'decision' }),
    ).rejects.toThrow(/reasonCode/);
    const event = await log.append({
      ...base,
      module: 'regime',
      eventType,
      severity: 'decision',
      reasonCode: 'FAMILY_REASON',
    });
    expect(event.reasonCode).toBe('FAMILY_REASON');
  });

  it.each([
    { module: 'execution', eventType: 'execution.filled' },
    { module: 'ledger', eventType: 'ledger.entry' },
    { module: 'run', eventType: 'paper.run_started' },
  ] as const)('requires a reasonCode for $eventType', async ({ module, eventType }) => {
    const log = new MemoryEventLog();
    await expect(log.append({ ...base, module, eventType, severity: 'info' })).rejects.toThrow(
      /reasonCode/,
    );
    const event = await log.append({
      ...base,
      module,
      eventType,
      severity: 'info',
      reasonCode: 'FAMILY_REASON',
    });
    expect(event.reasonCode).toBe('FAMILY_REASON');
  });

  it('rejects a decision event without alternatives', async () => {
    const log = new MemoryEventLog();
    await expect(
      log.append({
        ...base,
        module: 'strategy',
        eventType: 'signal.decided',
        severity: 'decision',
        decision,
        reasonCode: decision.reasonCode,
      }),
    ).rejects.toThrow(/alternative/);
  });

  it('accepts a decision event with one alternative and a reasonCode', async () => {
    const log = new MemoryEventLog();
    const event = await log.append({
      ...base,
      module: 'strategy',
      eventType: 'signal.decided',
      severity: 'decision',
      decision,
      reasonCode: decision.reasonCode,
      alternatives: [{ action: 'hold', reasonCode: 'WAIT', whyNot: 'Entry confirmation missing' }],
    });
    expect(event.decision?.action).toBe('buy');
    expect(event.alternatives).toHaveLength(1);
  });

  it('rejects non-JSON event payloads before hashing', async () => {
    const log = new MemoryEventLog();
    await expect(
      log.append({ ...base, inputs: { when: new Date('2026-01-01T00:00:00.000Z') } }),
    ).rejects.toThrow(/Non-JSON value at inputs/);
    await expect(log.append({ ...base, stateAfter: { handler: () => undefined } })).rejects.toThrow(
      /Non-JSON value at stateAfter/,
    );
    expect(log.events()).toHaveLength(0);
  });

  it('keeps undefined payload values hashed as null', async () => {
    const one = new MemoryEventLog();
    const two = new MemoryEventLog();
    await one.append({ ...base, inputs: { value: undefined } });
    await two.append({ ...base, inputs: { value: null } });
    expect(one.hash()).toBe(two.hash());
  });
});
