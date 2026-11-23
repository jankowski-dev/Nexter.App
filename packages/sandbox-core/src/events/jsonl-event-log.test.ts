import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonlEventLog } from './jsonl-event-log';
import { eventHash } from './memory-event-log';
import type { SandboxEvent, SandboxEventInput } from './event-types';

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

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sandbox-'));
  return join(dir, 'events.jsonl');
}

async function readLines(file: string): Promise<string[]> {
  return (await readFile(file, 'utf8')).trim().split('\n');
}

describe('JsonlEventLog', () => {
  it('writes one JSON object per line and preserves the hash', async () => {
    const file = await tempFile();
    const log = await JsonlEventLog.open(file);
    await log.append(input);
    await log.append({ ...input, eventType: 'run.finished' });
    await log.close();
    const lines = await readLines(file);
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed.hash).toBe(log.events()[0]?.hash);
    expect(log.hash()).toBe(log.events().at(-1)?.hash);
  });

  it('rejects opening a non-empty existing log', async () => {
    const file = await tempFile();
    const log = await JsonlEventLog.open(file);
    await log.append(input);
    await log.close();
    await expect(JsonlEventLog.open(file)).rejects.toThrow(
      /Event log already exists and is not empty/,
    );
  });

  it('serializes concurrent appends in order', async () => {
    const file = await tempFile();
    const log = await JsonlEventLog.open(file);
    const [first, second] = await Promise.all([
      log.append(input),
      log.append({ ...input, eventType: 'cycle.completed' }),
    ]);
    await log.close();
    expect(first.seq).toBe(0);
    expect(second.seq).toBe(1);
    expect(second.prevHash).toBe(first.hash);
    const lines = await readLines(file);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '').seq).toBe(0);
    expect(JSON.parse(lines[1] ?? '').seq).toBe(1);
    expect(log.events().map((event) => event.seq)).toEqual([0, 1]);
  });

  it('rejects appends after close', async () => {
    const file = await tempFile();
    const log = await JsonlEventLog.open(file);
    await log.close();
    await expect(log.append(input)).rejects.toThrow(/closed/);
  });

  it('persists a canonical line that hashes to the same value on replay', async () => {
    const file = await tempFile();
    const log = await JsonlEventLog.open(file);
    const event = await log.append({
      ...input,
      inputs: { beta: { gamma: 'x', delta: 2 }, alpha: 1 },
      stateAfter: { position: 'flat' },
    });
    await log.close();
    const line = (await readFile(file, 'utf8')).trim();
    const parsed = JSON.parse(line) as SandboxEvent;
    const { hash, ...rest } = parsed;
    expect(eventHash(rest)).toBe(hash);
    expect(hash).toBe(event.hash);
  });

  it('changes the hash when inputs, seq or prevHash change', async () => {
    const file = await tempFile();
    const log = await JsonlEventLog.open(file);
    const event = await log.append(input);
    await log.close();
    const { hash: _hash, ...rest } = event;
    const changedInputs = eventHash({ ...rest, inputs: { tampered: true } });
    const changedSeq = eventHash({ ...rest, seq: rest.seq + 1 });
    const changedPrevHash = eventHash({ ...rest, prevHash: 'f'.repeat(64) });
    expect(new Set([event.hash, changedInputs, changedSeq, changedPrevHash]).size).toBe(4);
  });

  it('preserves nested undefined as null and still round-trips', async () => {
    const file = await tempFile();
    const log = await JsonlEventLog.open(file);
    const event = await log.append({
      ...input,
      inputs: { alpha: 1, nested: { missing: undefined, present: 'x' } },
    });
    await log.close();
    const line = (await readFile(file, 'utf8')).trim();
    const parsed = JSON.parse(line) as SandboxEvent;
    expect(parsed.inputs?.nested).toEqual({ missing: null, present: 'x' });
    const { hash, ...rest } = parsed;
    expect(eventHash(rest)).toBe(hash);
    expect(hash).toBe(event.hash);
  });
});
