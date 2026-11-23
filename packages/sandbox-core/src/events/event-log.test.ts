import { describe, expect, it } from 'vitest';
import { MemoryEventLog } from './memory-event-log';
import type { SandboxEventInput } from './event-types';

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
      log.append({ ...base, module: 'strategy', eventType: 'signal.rejected', severity: 'decision' }),
    ).rejects.toThrow(/reasonCode/);
  });
});
