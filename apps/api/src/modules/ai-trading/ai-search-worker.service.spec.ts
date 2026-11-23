import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@nexter/db';
import { AiSearchWorkerService } from './ai-search-worker.service';
import type { AiSearchService } from './ai-search.service';

interface StaleRow {
  id: string;
  run_id: string;
  attempts: number;
  max_attempts: number;
}

function createDb(rows: StaleRow[]) {
  const updates: Array<Record<string, unknown>> = [];
  let executeCalls = 0;
  const db = {
    execute: vi.fn(async () => {
      executeCalls += 1;
      return { rows: executeCalls === 1 ? rows : [] };
    }),
    update: vi.fn(() => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          updates.push(value);
        },
      }),
    })),
  } as unknown as Database;
  return { db, updates };
}

async function recover(db: Database): Promise<void> {
  const service = new AiSearchWorkerService(db, {} as AiSearchService);
  await (
    service as unknown as {
      recoverStaleJobs(): Promise<void>;
    }
  ).recoverStaleJobs();
}

describe('AiSearchWorkerService stale job recovery', () => {
  it('fails an interrupted search instead of requeueing it', async () => {
    const { db, updates } = createDb([
      { id: 'job-1', run_id: 'run-1', attempts: 1, max_attempts: 3 },
    ]);

    await recover(db);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'failed',
      error: 'AI_SEARCH_INTERRUPTED',
    });
  });

  it('uses AI_SEARCH_STALE when attempts are exhausted', async () => {
    const { db, updates } = createDb([
      { id: 'job-2', run_id: 'run-2', attempts: 3, max_attempts: 3 },
    ]);

    await recover(db);

    expect(updates[0]).toMatchObject({
      status: 'failed',
      error: 'AI_SEARCH_STALE',
    });
  });
});
