import { parseReplayArgs, runReplayFromFile } from './replay';

async function main(): Promise<void> {
  const args = parseReplayArgs(process.argv.slice(2));
  const result = await runReplayFromFile(args);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
