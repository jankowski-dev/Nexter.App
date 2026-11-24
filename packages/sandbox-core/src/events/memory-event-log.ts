import { assertJsonValue } from '../util/json-value';
import { eventHash, normalizeEventInput, replayEventChain, EventChainError } from './event-chain';
import { sandboxEventInputSchema } from './event-schema';
import { GENESIS_HASH, type SandboxEvent, type SandboxEventInput } from './event-types';
import type { EventLog } from './event-log';

export { EventChainError, eventHash, normalizeEventInput } from './event-chain';

export class MemoryEventLog implements EventLog {
  private readonly entries: SandboxEvent[] = [];

  async append(input: SandboxEventInput): Promise<SandboxEvent> {
    const event = this.buildEvent(input);
    this.commitEvent(event);
    return event;
  }

  events(): readonly SandboxEvent[] {
    return [...this.entries];
  }

  hash(): string {
    return this.entries.at(-1)?.hash ?? GENESIS_HASH;
  }

  /**
   * Seeds an empty log from a persisted chain.
   *
   * The whole chain is verified before anything is cached, so a corrupt tail
   * leaves the log untouched. A log that already holds events cannot be
   * reseeded: use a fresh instance per loaded run.
   */
  restore(events: readonly SandboxEvent[]): void {
    if (this.entries.length > 0) {
      throw new EventChainError(
        events.length,
        'Cannot restore a non-empty sandbox event log; create a fresh instance',
      );
    }
    const { events: verified } = replayEventChain(events);
    this.entries.push(...verified);
  }

  /** Validates the input and computes the next chained event without storing it. */
  protected buildEvent(input: SandboxEventInput): SandboxEvent {
    const parsed = sandboxEventInputSchema.parse(input);
    // Hash payloads must survive a JSON round-trip unchanged.
    assertJsonValue(parsed.inputs ?? {}, 'inputs');
    assertJsonValue(parsed.stateBefore, 'stateBefore');
    assertJsonValue(parsed.stateAfter, 'stateAfter');
    assertJsonValue(parsed.timing, 'timing');
    const prevHash = this.entries.at(-1)?.hash ?? GENESIS_HASH;
    const base = {
      ...normalizeEventInput(parsed),
      seq: this.entries.length,
      recordedAt: new Date().toISOString(),
      prevHash,
    };
    return { ...base, hash: eventHash(base) };
  }

  /** Appends an already built event to the in-memory chain. */
  protected commitEvent(event: SandboxEvent): void {
    this.entries.push(event);
  }
}
