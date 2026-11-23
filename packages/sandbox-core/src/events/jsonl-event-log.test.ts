import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonlEventLog } from './jsonl-event-log';
import type { SandboxEventInput } from './event-types';

const input: SandboxEventInput = {
  runId: 'run-1',
  clockTime: '2026-01-01T00:00:00.000Z',
  module: 'run',
  eventType: 'run.started',
  severity: 'info',
  dataSnapshotId: 'snapshot-1',
  configVersion: 'config-1',
  seed: 7,
};

describe('JsonlEventLog', () => {
  it('writes one JSON object per line and preserves the hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
    const file = join(dir, 'events.jsonl');
    const log = await JsonlEventLog.open(file);
    await log.append(input);
    await log.append({ ...input, eventType: 'run.finished' });
    await log.close();
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed.hash).toBe(log.events()[0]?.hash);
    expect(log.hash()).toBe(log.events().at(-1)?.hash);
  });
});
