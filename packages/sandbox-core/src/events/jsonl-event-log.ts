import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stableStringify } from '../util/hash';
import { MemoryEventLog } from './memory-event-log';
import type { SandboxEvent, SandboxEventInput } from './event-types';

export class JsonlEventLog extends MemoryEventLog {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(private readonly filePath: string) {
    super();
  }

  static async open(filePath: string): Promise<JsonlEventLog> {
    await mkdir(dirname(filePath), { recursive: true });
    let existing: string | null = null;
    try {
      existing = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existing !== null && existing.trim().length > 0) {
      throw new Error(`Event log already exists and is not empty: ${filePath}`);
    }
    return new JsonlEventLog(filePath);
  }

  override append(input: SandboxEventInput): Promise<SandboxEvent> {
    const result = this.queue.then(() => this.appendQueued(input));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async close(): Promise<void> {
    await this.queue;
    this.closed = true;
  }

  private async appendQueued(input: SandboxEventInput): Promise<SandboxEvent> {
    if (this.closed) throw new Error(`Event log is closed: ${this.filePath}`);
    const event = this.buildEvent(input);
    // Persist the canonical form used for hashing so a replayed line hashes identically.
    await appendFile(this.filePath, `${stableStringify(event)}\n`, 'utf8');
    // Only advance seq/hash after the durable write succeeded.
    this.commitEvent(event);
    return event;
  }
}
