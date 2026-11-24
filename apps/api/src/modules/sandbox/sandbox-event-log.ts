import { and, asc, eq, gt } from 'drizzle-orm';
import {
  sandboxEvents,
  sandboxRuns,
  type DbExecutor,
  type DbTransaction,
  type SandboxEventRecord,
} from '@nexter/db';
import {
  EventChainError,
  MemoryEventLog,
  parseStoredSandboxEvent,
  replayEventChain,
  type SandboxEvent,
  type SandboxEventInput,
} from '@nexter/sandbox-core';
import { SandboxPersistenceError } from './sandbox.types';

/** Outcome of recomputing a stored chain against the persisted run head. */
export interface SandboxEventChainVerification {
  readonly ok: boolean;
  /**
   * Number of event rows read. When `ok`, this equals `event_seq` and is the
   * sequence the next event receives; error paths report the rows examined.
   */
  readonly count: number;
  /** Last stored sequence, or `null` for an empty chain. */
  readonly lastSeq: number | null;
  /** Last stored hash, or `null` when the chain could not be read. */
  readonly headHash: string | null;
  readonly errors: readonly string[];
}

/**
 * Durable, append-only `EventLog` backed by `sandbox_events`.
 *
 * The core `EventLog` interface is synchronous for reads because the Stage 1B
 * decision engine calls `events()`/`hash()` inside a decision cycle. This class
 * therefore keeps the run's verified chain in memory for the lifetime of one
 * transaction while every `append` writes through to Postgres first:
 *
 * 1. build and validate the next event with the Stage 1A hashing rules;
 * 2. compare the run's `event_seq`/`event_hash` with the in-memory head so a
 *    second writer (or a stale chain) fails closed;
 * 3. insert the event row and advance the run head in the same transaction;
 * 4. only then commit the event to the in-memory chain.
 *
 * The executor is typed as a transaction (`DbTransaction`), not the root
 * database: appending outside a transaction could persist an event without the
 * matching run state.
 *
 * A failed insert therefore never advances the cache. The instance is bound to
 * one transaction; on rollback it must be discarded, not reused.
 *
 * `sandbox_runs.event_seq` stores the number of persisted events (the sequence
 * the next event receives), so the first event (`seq = 0`) advances it to 1.
 * `event_hash` stores the head hash and starts at the genesis hash.
 */
export class SandboxEventLog extends MemoryEventLog {
  private constructor(
    private readonly tx: DbTransaction,
    readonly runId: string,
  ) {
    super();
  }

  /**
   * Loads and verifies the run's persisted chain, then returns a log positioned
   * at its head. A corrupt chain throws instead of silently continuing it.
   */
  static async load(tx: DbTransaction, runId: string): Promise<SandboxEventLog> {
    const head = await readRunHead(tx, runId);
    const events = (await readEventRows(tx, runId)).map((row) => eventFromRow(row));
    const log = new SandboxEventLog(tx, runId);
    try {
      log.restore(events);
    } catch (error) {
      if (error instanceof EventChainError) {
        throw new SandboxPersistenceError(
          'SANDBOX_EVENT_CHAIN_DESYNC',
          `Sandbox run ${runId} has an invalid event chain: ${error.message}`,
        );
      }
      throw error;
    }

    if (head.eventSeq !== log.events().length || head.eventHash !== log.hash()) {
      throw new SandboxPersistenceError(
        'SANDBOX_EVENT_CHAIN_DESYNC',
        `Sandbox run ${runId} persisted head is seq ${head.eventSeq} / ${head.eventHash}, ` +
          `loaded chain has count ${log.events().length} / ${log.hash()}`,
      );
    }

    return log;
  }

  override async append(input: SandboxEventInput): Promise<SandboxEvent> {
    if (input.runId !== this.runId) {
      throw new SandboxPersistenceError(
        'SANDBOX_EVENT_PAYLOAD_INVALID',
        `Sandbox event belongs to run ${input.runId}, not ${this.runId}`,
      );
    }

    // Validates the Stage 1A schema and chains onto the verified in-memory head.
    const event = this.buildEvent(input);
    const head = await this.readRunHead();
    const expectedSeq = this.events().length;
    if (head.eventSeq !== expectedSeq || head.eventHash !== this.hash()) {
      throw new SandboxPersistenceError(
        'SANDBOX_EVENT_CHAIN_DESYNC',
        `Sandbox run ${this.runId} persisted head is seq ${head.eventSeq} / ${head.eventHash}, ` +
          `loaded chain head is seq ${expectedSeq} / ${this.hash()}`,
      );
    }

    await this.tx.insert(sandboxEvents).values(toRow(this.runId, event));
    await this.tx
      .update(sandboxRuns)
      .set({ eventSeq: event.seq + 1, eventHash: event.hash })
      .where(eq(sandboxRuns.id, this.runId));

    // Durable write succeeded: only now advance the in-memory chain.
    this.commitEvent(event);
    return event;
  }

  /**
   * Re-reads every persisted row and recomputes the chain from the stored
   * payload, then compares the recomputed count/head with the run row. Gaps,
   * broken links, bad hashes, column/payload mismatches and a truncated run
   * head all surface as `ok: false` with a message instead of throwing.
   */
  async verify(): Promise<SandboxEventChainVerification> {
    return verifyChain(this.tx, this.runId);
  }

  /** Throws `SANDBOX_EVENT_CHAIN_DESYNC` when the persisted chain is invalid. */
  async assertVerified(): Promise<void> {
    const verification = await this.verify();
    if (!verification.ok) {
      throw new SandboxPersistenceError(
        'SANDBOX_EVENT_CHAIN_DESYNC',
        `Sandbox run ${this.runId} event chain failed verification: ${verification.errors.join('; ')}`,
      );
    }
  }

  /**
   * Verifies a run's persisted chain without loading it into a mutable log.
   * Read-only, so it accepts the root database as well as a transaction. Used by
   * reports and health checks that must not continue the chain.
   */
  static async verifyRun(
    executor: DbExecutor,
    runId: string,
  ): Promise<SandboxEventChainVerification> {
    return verifyChain(executor, runId);
  }

  private async readRunHead(): Promise<{ eventSeq: number; eventHash: string }> {
    return readRunHead(this.tx, this.runId);
  }
}

async function readRunHead(
  executor: DbExecutor,
  runId: string,
): Promise<{ eventSeq: number; eventHash: string }> {
  const [row] = await executor
    .select({ eventSeq: sandboxRuns.eventSeq, eventHash: sandboxRuns.eventHash })
    .from(sandboxRuns)
    .where(eq(sandboxRuns.id, runId))
    .limit(1);

  if (!row) {
    throw new SandboxPersistenceError(
      'SANDBOX_RUN_NOT_FOUND',
      `Sandbox run ${runId} does not exist`,
    );
  }

  return row;
}

/** Reads a bounded slice of the persisted chain, oldest first. */
export async function listSandboxEvents(
  executor: DbExecutor,
  runId: string,
  options: { afterSeq?: number; limit?: number } = {},
): Promise<SandboxEvent[]> {
  const conditions = [eq(sandboxEvents.runId, runId)];
  if (options.afterSeq !== undefined) conditions.push(gt(sandboxEvents.seq, options.afterSeq));

  const limit = Math.min(Math.max(options.limit ?? 500, 1), 5_000);
  const rows = await executor
    .select()
    .from(sandboxEvents)
    .where(and(...conditions))
    .orderBy(asc(sandboxEvents.seq))
    .limit(limit);

  return rows.map((row) => eventFromRow(row));
}

/**
 * Reads the complete persisted chain, oldest first.
 *
 * Reserved for report generation, which must reproduce the run's
 * `eventCount`/`eventHash` audit check. The owner journal endpoint uses the
 * bounded `listSandboxEvents` instead.
 */
export async function listAllSandboxEvents(
  executor: DbExecutor,
  runId: string,
): Promise<SandboxEvent[]> {
  return (await readEventRows(executor, runId)).map((row) => eventFromRow(row));
}

async function readEventRows(executor: DbExecutor, runId: string): Promise<SandboxEventRecord[]> {
  return executor
    .select()
    .from(sandboxEvents)
    .where(eq(sandboxEvents.runId, runId))
    .orderBy(asc(sandboxEvents.seq));
}

/**
 * Verifies the stored chain and its persisted run head. The run row is the
 * commit record of the chain, so a truncated `event_seq`/`event_hash` (for
 * example after a partial restore) must fail even when the rows link cleanly.
 */
async function verifyChain(
  executor: DbExecutor,
  runId: string,
): Promise<SandboxEventChainVerification> {
  let rows: SandboxEventRecord[] = [];
  try {
    const [run] = await executor
      .select({ eventSeq: sandboxRuns.eventSeq, eventHash: sandboxRuns.eventHash })
      .from(sandboxRuns)
      .where(eq(sandboxRuns.id, runId))
      .limit(1);
    if (!run) {
      return {
        ok: false,
        count: 0,
        lastSeq: null,
        headHash: null,
        errors: [`Sandbox run ${runId} does not exist`],
      };
    }

    rows = await readEventRows(executor, runId);
    const events = rows.map((row) => eventFromRow(row));
    const { headHash } = replayEventChain(events);
    const lastSeq = events.at(-1)?.seq ?? null;

    if (run.eventSeq !== events.length || run.eventHash !== headHash) {
      return {
        ok: false,
        count: events.length,
        lastSeq,
        headHash,
        errors: [
          `Sandbox run ${runId} persisted head is seq ${run.eventSeq} / ${run.eventHash}, ` +
            `chain has count ${events.length} / ${headHash}`,
        ],
      };
    }

    return { ok: true, count: events.length, lastSeq, headHash, errors: [] };
  } catch (error) {
    return {
      ok: false,
      count: rows.length,
      lastSeq: null,
      headHash: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Reconstructs one event from its stored payload and proves the key columns
 * agree with it. The payload is the canonical source; the columns are indexes.
 */
function eventFromRow(row: SandboxEventRecord): SandboxEvent {
  let event: SandboxEvent;
  try {
    event = parseStoredSandboxEvent(row.payload);
  } catch (error) {
    throw new SandboxPersistenceError(
      'SANDBOX_EVENT_PAYLOAD_INVALID',
      `sandbox_events ${row.runId}#${row.seq} payload is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const matches =
    event.runId === row.runId &&
    event.seq === row.seq &&
    event.hash === row.hash &&
    event.prevHash === row.prevHash &&
    event.module === row.module &&
    event.eventType === row.eventType &&
    event.severity === row.severity &&
    event.tokenId === row.tokenId &&
    event.strategyId === row.strategyId &&
    event.regime === row.regime &&
    new Date(event.clockTime).getTime() === row.clockTime.getTime() &&
    new Date(event.recordedAt).getTime() === row.recordedAt.getTime();

  if (!matches) {
    throw new SandboxPersistenceError(
      'SANDBOX_EVENT_PAYLOAD_INVALID',
      `sandbox_events ${row.runId}#${row.seq} columns do not match the stored payload`,
    );
  }

  return event;
}

/** Maps a canonical event to its append-only row. */
function toRow(runId: string, event: SandboxEvent): typeof sandboxEvents.$inferInsert {
  return {
    runId,
    seq: event.seq,
    clockTime: new Date(event.clockTime),
    module: event.module,
    eventType: event.eventType,
    severity: event.severity,
    tokenId: event.tokenId,
    strategyId: event.strategyId,
    regime: event.regime,
    // JSONB stores the full canonical event; `recordedAt`/`timing` are present
    // for audit but excluded from the hash.
    payload: event as unknown as Record<string, unknown>,
    hash: event.hash,
    prevHash: event.prevHash,
    recordedAt: new Date(event.recordedAt),
  };
}
