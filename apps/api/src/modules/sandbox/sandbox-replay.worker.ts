import { parentPort } from 'node:worker_threads';
import { runPaperFromCandles, type RunReport } from '@nexter/sandbox-core';
import type { ReplayExecutionInput } from './sandbox-replay.executor';

/**
 * Worker-thread entrypoint for one historical replay.
 *
 * The CPU-heavy `runPaperFromCandles` runs here so the API event loop and the
 * live paper runner stay responsive. This module deliberately imports only
 * `@nexter/sandbox-core` and `node:worker_threads` at runtime, so the compiled
 * sibling `.js` can be started by path without pulling the Nest graph into the
 * thread.
 *
 * The main thread owns the persisted snapshot, status and audit; the worker
 * only turns one JSON-safe input into one deterministic report.
 */
export async function runReplayJob(input: ReplayExecutionInput): Promise<RunReport> {
  const { report } = await runPaperFromCandles(input);
  return report;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown replay error');
  return message.slice(0, 1000);
}

if (parentPort !== null) {
  const port = parentPort;
  port.on('message', (message: ReplayExecutionInput) => {
    void runReplayJob(message).then(
      (report) => {
        port.postMessage({ report });
        port.close();
      },
      (error: unknown) => {
        port.postMessage({ error: errorMessage(error) });
        port.close();
      },
    );
  });
}
