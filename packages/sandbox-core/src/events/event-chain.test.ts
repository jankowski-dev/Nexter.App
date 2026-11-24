import { describe, expect, it } from 'vitest';
import { EventChainError, parseStoredSandboxEvent, replayEventChain } from './event-chain';
import { GENESIS_HASH, type SandboxEvent, type SandboxEventInput } from './event-types';
import { MemoryEventLog } from './memory-event-log';

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

async function chain(count = 3): Promise<SandboxEvent[]> {
  const log = new MemoryEventLog();
  for (let index = 0; index < count; index += 1) {
    await log.append({ ...input, eventType: `run.step.${index}` });
  }
  return [...log.events()];
}

describe('replayEventChain', () => {
  it('replays an empty chain to the genesis hash', () => {
    expect(replayEventChain([])).toEqual({ events: [], headHash: GENESIS_HASH });
  });

  it('accepts a linked chain and reports its head', async () => {
    const events = await chain();
    const replayed = replayEventChain(events);

    expect(replayed.events).toEqual(events);
    expect(replayed.events.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(replayed.events[0]?.prevHash).toBe(GENESIS_HASH);
    expect(replayed.events[1]?.prevHash).toBe(replayed.events[0]?.hash);
    expect(replayed.events[2]?.prevHash).toBe(replayed.events[1]?.hash);
    expect(replayed.headHash).toBe(replayed.events[2]?.hash);
  });

  it('rejects a sequence gap', async () => {
    const events = await chain();
    const tampered = [events[0], { ...(events[1] as SandboxEvent), seq: 5 }] as SandboxEvent[];

    expect(() => replayEventChain(tampered)).toThrow(EventChainError);
    expect(() => replayEventChain(tampered)).toThrow(/seq/);
  });

  it('rejects a broken prevHash link', async () => {
    const events = await chain();
    const tampered = [
      events[0],
      { ...(events[1] as SandboxEvent), prevHash: 'f'.repeat(64) },
    ] as SandboxEvent[];

    expect(() => replayEventChain(tampered)).toThrow(/prevHash/);
  });

  it('rejects a payload whose hash does not recompute', async () => {
    const events = await chain();
    const tampered = [
      events[0],
      {
        ...(events[1] as SandboxEvent),
        inputs: { tampered: true },
      },
      events[2],
    ] as SandboxEvent[];

    expect(() => replayEventChain(tampered)).toThrow(/hash/);
  });

  it('rejects an out-of-order chain', async () => {
    const events = await chain();

    expect(() => replayEventChain([...events].reverse())).toThrow(EventChainError);
  });
});

describe('MemoryEventLog.restore', () => {
  it('seeds a fresh log and continues the chain from the persisted head', async () => {
    const events = await chain();
    const log = new MemoryEventLog();

    log.restore(events);

    expect(log.events()).toEqual(events);
    expect(log.hash()).toBe(events.at(-1)?.hash);

    const next = await log.append({ ...input, eventType: 'run.resumed' });
    expect(next.seq).toBe(3);
    expect(next.prevHash).toBe(events.at(-1)?.hash);
    expect(log.events()).toHaveLength(4);
  });

  it('accepts an empty chain on a fresh log', () => {
    const log = new MemoryEventLog();
    log.restore([]);
    expect(log.events()).toEqual([]);
    expect(log.hash()).toBe(GENESIS_HASH);
  });

  it('refuses to seed a log that already has events', async () => {
    const events = await chain(1);
    const log = new MemoryEventLog();
    await log.append(input);

    expect(() => log.restore(events)).toThrow(/non-empty/);
    expect(log.events()).toHaveLength(1);
  });

  it('refuses a corrupted chain and leaves the log empty', async () => {
    const events = await chain();
    const tampered = [events[0], { ...(events[1] as SandboxEvent), seq: 5 }] as SandboxEvent[];
    const log = new MemoryEventLog();

    expect(() => log.restore(tampered)).toThrow(EventChainError);
    expect(log.events()).toEqual([]);
  });
});

describe('parseStoredSandboxEvent', () => {
  it('round-trips a persisted event through JSON', async () => {
    const [event] = await chain(1);
    const parsed = parseStoredSandboxEvent(JSON.parse(JSON.stringify(event)));

    expect(parsed).toEqual(event);
  });

  it('rejects a payload without chain metadata', async () => {
    const [event] = await chain(1);
    const { hash: _hash, ...withoutHash } = event as SandboxEvent;
    delete (withoutHash as Record<string, unknown>).seq;

    expect(() => parseStoredSandboxEvent(withoutHash)).toThrow(EventChainError);
  });

  it('rejects a malformed hash', async () => {
    const [event] = await chain(1);

    expect(() => parseStoredSandboxEvent({ ...event, hash: 'not-a-hash' })).toThrow(/hash/);
  });
});
