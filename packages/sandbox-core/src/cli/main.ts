import { runReplayFromFile } from './replay';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const read = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const filePath = read('--file');
  if (!filePath) {
    throw new Error(
      'Usage: replay --file <candles.jsonl> [--out events.jsonl] [--run-id id] [--seed 7]',
    );
  }
  const runId = read('--run-id') ?? `sandbox-${Date.now()}`;
  const seed = Number(read('--seed') ?? 7);
  const outputPath = read('--out') ?? `sandbox-events-${runId}.jsonl`;
  const result = await runReplayFromFile({ filePath, outputPath, runId, seed });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
