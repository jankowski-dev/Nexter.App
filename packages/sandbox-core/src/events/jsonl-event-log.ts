import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MemoryEventLog } from './memory-event-log';
import type { SandboxEvent, SandboxEventInput } from './event-types';

export class JsonlEventLog extends MemoryEventLog {
  private constructor(private readonly filePath: string) {
    super();
  }

  static async open(filePath: string): Promise<JsonlEventLog> {
    await mkdir(dirname(filePath), { recursive: true });
    return new JsonlEventLog(filePath);
  }

  override async append(input: SandboxEventInput): Promise<SandboxEvent> {
    const event = await super.append(input);
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  async close(): Promise<void> {
    // appendFile opens/closes per write; close exists for future streaming.
  }
}
