import { sha256Hex, stableStringify } from '../util/hash';
import { sandboxEventInputSchema } from './event-schema';
import { GENESIS_HASH, type SandboxEvent, type SandboxEventInput } from './event-types';

/**
 * Canonical hash of one sandbox event.
 *
 * `recordedAt` and `timing` are deliberately excluded: the same logical event
 * must hash identically when it is replayed from a different durable store.
 */
export function eventHash(event: Omit<SandboxEvent, 'hash'>): string {
  const { recordedAt: _recordedAt, timing: _timing, ...hashable } = event;
  return sha256Hex(stableStringify(hashable));
}

/** Typed failure while parsing, replaying or restoring an event chain. */
export class EventChainError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(message);
    this.name = 'EventChainError';
  }
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Applies the canonical defaults for an already validated event input.
 *
 * The host and the event log must agree on this shape byte for byte, because
 * the hash covers it. Keeping the defaults in one place means the in-memory
 * chain and a replayed payload cannot diverge.
 */
export function normalizeEventInput(
  parsed: SandboxEventInput,
): Omit<SandboxEvent, 'hash' | 'seq' | 'recordedAt' | 'prevHash'> {
  return {
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
  };
}

/**
 * Parses an untrusted stored event payload (for example a JSONB column) into a
 * validated `SandboxEvent`.
 *
 * Chain metadata is validated for type; continuity and hash values are checked
 * by `replayEventChain`. This function never trusts the stored columns over the
 * payload: it is the caller's job to compare the two.
 */
export function parseStoredSandboxEvent(value: unknown): SandboxEvent {
  if (!isRecord(value)) {
    throw new EventChainError(-1, 'Stored sandbox event payload must be a JSON object');
  }

  let parsed: SandboxEventInput;
  try {
    parsed = sandboxEventInputSchema.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new EventChainError(-1, `Stored sandbox event payload is invalid: ${detail}`);
  }

  const seq = value.seq;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    throw new EventChainError(-1, 'Stored sandbox event seq must be a non-negative integer');
  }
  const recordedAt = value.recordedAt;
  if (typeof recordedAt !== 'string' || Number.isNaN(Date.parse(recordedAt))) {
    throw new EventChainError(seq, 'Stored sandbox event recordedAt must be an ISO timestamp');
  }
  const prevHash = value.prevHash;
  const hash = value.hash;
  if (typeof prevHash !== 'string' || !HASH_PATTERN.test(prevHash)) {
    throw new EventChainError(seq, 'Stored sandbox event prevHash must be a 64-character hex hash');
  }
  if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)) {
    throw new EventChainError(seq, 'Stored sandbox event hash must be a 64-character hex hash');
  }

  return { ...normalizeEventInput(parsed), seq, recordedAt, prevHash, hash };
}

/** Result of replaying a stored chain. */
export interface EventChainReplay {
  readonly events: readonly SandboxEvent[];
  /** Hash of the last event, or the genesis hash for an empty chain. */
  readonly headHash: string;
}

/**
 * Verifies a persisted chain end to end: sequence numbering starts at zero and
 * grows by one, every `prevHash` links to its predecessor, and every `hash`
 * recomputes from the stored payload. Returns the verified chain and its head.
 */
export function replayEventChain(events: readonly SandboxEvent[]): EventChainReplay {
  const verified: SandboxEvent[] = [];
  let prevHash = GENESIS_HASH;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] as SandboxEvent;
    if (event.seq !== index) {
      throw new EventChainError(
        index,
        `Stored sandbox event chain is not contiguous: expected seq ${index}, received ${event.seq}`,
      );
    }
    if (event.prevHash !== prevHash) {
      throw new EventChainError(
        index,
        `Stored sandbox event prevHash mismatch at seq ${index}: expected ${prevHash}, received ${event.prevHash}`,
      );
    }
    const { hash, ...hashable } = event;
    const expected = eventHash(hashable);
    if (hash !== expected) {
      throw new EventChainError(
        index,
        `Stored sandbox event hash mismatch at seq ${index}: expected ${expected}, received ${hash}`,
      );
    }
    verified.push(event);
    prevHash = hash;
  }

  return { events: verified, headHash: prevHash };
}
