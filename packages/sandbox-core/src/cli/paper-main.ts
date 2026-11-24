import { parsePaperArgs, runPaperFromFiles } from './paper';

async function main(): Promise<void> {
  const args = parsePaperArgs(process.argv.slice(2));
  const { report, artifacts } = await runPaperFromFiles(args);
  console.log(`Paper run ${report.runId} -> ${artifacts.outputDir}`);
  console.log(`Final equity: ${report.metrics.finalEquityUsd} USD`);
  console.log(`Return: ${report.metrics.totalReturnPct}%`);
  console.log(`Max drawdown: ${report.metrics.maxDrawdownPct}%`);
  console.log(`Closed trades: ${report.metrics.tradeCount}`);
  console.log(`Report hash: ${report.reportHash}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
