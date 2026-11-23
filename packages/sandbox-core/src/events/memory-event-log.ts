import { sha256Hex, stableStringify } from '../util/hash';
import { sandboxEventInputSchema } from './event-schema';
import { GENESIS_HASH, type SandboxEvent, type SandboxEventInput } from './event-types';
import type { EventLog } from './event-log';

export function eventHash(event: Omit<SandboxEvent, 'hash'>): string {
  const { recordedAt: _recordedAt, timing: _timing, ...hashable } = event;
  return sha256Hex(stableStringify(hashable));
}

export class MemoryEventLog implements EventLog {
  private readonly entries: SandboxEvent[] = [];

  async append(input: SandboxEventInput): Promise<SandboxEvent> {
    const parsed = sandboxEventInputSchema.parse(input);
    const prevHash = this.entries.at(-1)?.hash ?? GENESIS_HASH;
    const base = {
      ...parsed,
      tokenId: parsed.tokenId ?? null,
      strategyId: parsed.strategyId ?? null,
      regime: parsed.regime ?? null,
      stateBefore: parsed.stateBefore ?? null,
      stateAfter: parsed.stateAfter ?? null,
      inputs: parsed.inputs ?? {},
      timing: parsed.timing ?? null,
      decision: parsed.decision ?? null,
      alternatives: parsed.alternatives ?? [],
      riskChecks: parsed.riskChecks ?? [],
      correlationId: parsed.correlationId ?? null,
      reasonCode: parsed.reasonCode ?? null,
      reasonText: parsed.reasonText ?? null,
      seq: this.entries.length,
      recordedAt: new Date().toISOString(),
      prevHash,
    };
    const event: SandboxEvent = { ...base, hash: eventHash(base) };
    this.entries.push(event);
    return event;
  }

  events(): readonly SandboxEvent[] {
    return [...this.entries];
  }

  hash(): string {
    return this.entries.at(-1)?.hash ?? GENESIS_HASH;
  }
}
