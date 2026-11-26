#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pdfmake from 'pdfmake';
import Roboto from 'pdfmake/fonts/Roboto.js';
import {
  DEFAULT_PAPER_SETTINGS,
  DEFAULT_SETTINGS,
  buildBarDiagnostics,
  joinAnnotations,
  loadJsonlCandles,
  paperConfigVersion,
  parseAnnotationsCsv,
  renderAnnotationReport,
  renderAnnotationTemplate,
  renderChartPages,
  renderDiagnosticsCsv,
  runPaperFromCandles,
  settingsVersion,
  snapshotCandles,
} from '@nexter/sandbox-core';

const USAGE = `Usage:
  replay-diagnostics --candles <candles.jsonl> --out <dir> [--token <id>] [--seed 7] [--settings <json>] [--initial-capital 1000.00]
  replay-diagnostics --annotate <annotations.csv> --out <dir>

Options:
  --candles           JSONL candle file (tokenId,timeframe,openTime,open,high,low,close,volumeUsd)
  --out               output directory
  --token             token id when the file contains more than one token
  --from              optional ISO lower bound (openTime)
  --to                optional ISO upper bound (openTime)
  --seed              deterministic seed, default 7
  --settings          optional JSON file deep-merged over the default decision settings
  --initial-capital   default 1000.00
  --annotate          join an annotations CSV with an existing diagnostics.json
  --help              show this help`;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { seed: 7, initialCapital: '1000.00' };
  const tokens = argv.filter((token) => token !== '--');
  for (let index = 0; index < tokens.length; index += 1) {
    const flag = tokens[index];
    if (flag === '--help' || flag === '-h') return { help: true };
    const value = tokens[index + 1];
    if (!flag.startsWith('--') || value === undefined || value.startsWith('--')) {
      fail(USAGE);
    }
    index += 1;
    switch (flag) {
      case '--candles':
        args.candles = value;
        break;
      case '--out':
        args.out = value;
        break;
      case '--token':
        args.token = value;
        break;
      case '--from':
        args.from = value;
        break;
      case '--to':
        args.to = value;
        break;
      case '--seed':
        args.seed = Number(value);
        break;
      case '--settings':
        args.settings = value;
        break;
      case '--initial-capital':
        args.initialCapital = value;
        break;
      case '--annotate':
        args.annotate = value;
        break;
      default:
        fail(USAGE);
    }
  }
  if (!args.annotate && !args.candles) fail(USAGE);
  if (!args.out) fail(USAGE);
  return args;
}

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch;
  if (typeof base !== 'object' || base === null || typeof patch !== 'object' || patch === null) {
    return patch;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = key in result ? deepMerge(result[key], value) : value;
  }
  return result;
}

function round(value) {
  return Number(value).toFixed(2);
}

function metricsTable(metrics) {
  return {
    table: {
      widths: ['*', '*', '*'],
      body: [
        ['Метрика', 'Значение', 'Метрика'],
        [
          'Итоговый капитал',
          `$${round(metrics.finalEquityUsd)}`,
          `Доходность ${metrics.totalReturnPct}%`,
        ],
        ['Макс. просадка', `${metrics.maxDrawdownPct}%`, `Сделок ${metrics.tradeCount}`],
        [
          'Win rate',
          metrics.winRatePct === null ? '—' : `${metrics.winRatePct}%`,
          `Profit factor ${metrics.profitFactor ?? '—'}`,
        ],
        ['Комиссии', `$${round(metrics.feesPaidUsd)}`, `Время в рынке ${metrics.timeInMarketPct}%`],
      ],
    },
    fontSize: 10,
    margin: [0, 8, 0, 12],
  };
}

function markerForIntent(intent, priceAt) {
  const time = new Date(intent.fillTime ?? intent.decisionTime).toISOString();
  const price = intent.priceUsd ?? priceAt(time);
  if (intent.status === 'rejected') {
    return { time, side: 'reject', price, label: 'REJ' };
  }
  if (intent.status === 'expired') {
    return { time, side: 'expire', price, label: 'EXP' };
  }
  return {
    time,
    side: intent.side === 'buy' ? 'buy' : 'sell',
    price,
    label: intent.side === 'buy' ? 'BUY' : 'SELL',
  };
}

function buildMarkers(report, rows) {
  const priceAt = (time) => {
    const target = Date.parse(time);
    let best = rows[0]?.close ?? '0';
    let delta = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const current = Math.abs(Date.parse(row.closeTime) - target);
      if (current < delta) {
        delta = current;
        best = row.close;
      }
    }
    return best;
  };
  return report.intentJournal
    .filter((intent) => rows.some((row) => row.tokenId === intent.tokenId))
    .map((intent) => markerForIntent(intent, priceAt));
}

function countTop(rows, field, limit = 5) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[field];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function summaryMarkdown({ tokenId, timeframe, report, rows, files }) {
  const topRegimes = countTop(rows, 'regime');
  const topSignals = countTop(rows, 'signalReason');
  const topRisk = countTop(rows, 'riskReason');
  const lines = [
    `# Диагностический прогон ${tokenId}`,
    '',
    `- Таймфрейм: ${timeframe}`,
    `- Баров: ${rows.length}`,
    `- Период: ${rows[0]?.openTime ?? '—'} → ${rows[rows.length - 1]?.closeTime ?? '—'}`,
    `- Итоговый капитал: $${round(report.metrics.finalEquityUsd)}`,
    `- Доходность: ${report.metrics.totalReturnPct}%`,
    `- Макс. просадка: ${report.metrics.maxDrawdownPct}%`,
    `- Сделок: ${report.metrics.tradeCount}`,
    `- Комиссии: $${round(report.metrics.feesPaidUsd)}`,
    '',
    '## Режимы',
    '',
    ...topRegimes.map(([key, count]) => `- ${key}: ${count}`),
    '',
    '## Частые причины сигнала',
    '',
    ...topSignals.map(([key, count]) => `- ${key}: ${count}`),
    '',
    '## Частые причины риска',
    '',
    ...topRisk.map(([key, count]) => `- ${key}: ${count}`),
    '',
    '## Файлы',
    '',
    ...files.map((file) => `- ${file}`),
    '',
    'Разметка: откройте `chart.pdf`, заполните `annotations.csv` и запустите режим `--annotate`.',
  ];
  return `${lines.join('\n')}\n`;
}

const FONTS_DIR = path.dirname(Roboto.Roboto.normal);

async function buildPdf({ outDir, pages, title, report, tokenId, timeframe, snapshotId }) {
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((file) =>
    path.resolve(file).startsWith(`${path.resolve(FONTS_DIR)}${path.sep}`),
  );
  pdfmake.addFonts(Roboto);

  const content = [
    { text: title, fontSize: 22, bold: true },
    {
      text: `ETH/BSC 1h · ${tokenId} · ${timeframe} · snapshot ${snapshotId.slice(0, 16)}…`,
      fontSize: 10,
      color: '#71717a',
      margin: [0, 4, 0, 12],
    },
    metricsTable(report.metrics),
    {
      text: 'Как читать: каждый бар пронумерован; фон — режим; EMA24 синяя, EMA168 фиолетовая; треугольники — вход/выход. Красные/жёлтые метки — отклонённые/истёкшие интенты. Разметку вносите в annotations.csv по timestamp или номеру бара.',
      fontSize: 10,
      margin: [0, 8, 0, 0],
    },
  ];

  for (const [index, svg] of pages.entries()) {
    content.push({
      svg,
      width: 1120,
      height: 630,
      pageBreak: 'before',
      margin: [0, 0, 0, 0],
    });
    content.push({
      text: `page ${index + 1} / ${pages.length}`,
      fontSize: 8,
      color: '#71717a',
      alignment: 'right',
    });
  }

  const document = {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [24, 24, 24, 24],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    content,
  };
  const buffer = await pdfmake.createPdf(document).getBuffer();
  await writeFile(path.join(outDir, 'chart.pdf'), buffer);
  return buffer.length;
}

async function runExport(args) {
  const settings = args.settings
    ? deepMerge(DEFAULT_SETTINGS, JSON.parse(await readFile(args.settings, 'utf8')))
    : DEFAULT_SETTINGS;
  const paper = DEFAULT_PAPER_SETTINGS;
  const candles = await loadJsonlCandles(args.candles);
  if (candles.length === 0) throw new Error('No candles found');

  const tokens = [...new Set(candles.map((candle) => candle.tokenId))];
  const tokenId = args.token ?? tokens[0];
  if (!tokenId || !tokens.includes(tokenId)) throw new Error(`Token ${tokenId} not found`);

  const timeframes = [...new Set(candles.map((candle) => candle.timeframe))];
  if (timeframes.length !== 1) throw new Error(`Mixed timeframes: ${timeframes.join(', ')}`);
  const timeframe = timeframes[0];

  const from = args.from ? Date.parse(args.from) : null;
  const to = args.to ? Date.parse(args.to) : null;
  const selected = candles.filter((candle) => {
    if (candle.tokenId !== tokenId) return false;
    if (from !== null && candle.openTime < from) return false;
    if (to !== null && candle.openTime > to) return false;
    return true;
  });
  if (selected.length === 0) throw new Error('No candles in the selected token/window');

  const dataSnapshotId = snapshotCandles(selected).id;
  const configVersion = paperConfigVersion({
    runId: 'diagnostic-replay',
    seed: args.seed,
    timeframe,
    tokenIds: [tokenId],
    initialCapitalUsd: args.initialCapital,
    feeBps: paper.feeBps,
    slippageBps: paper.slippageBps,
    liquidityCapPct: paper.liquidityCapPct,
    maxPendingBars: paper.maxPendingBars,
    cooldownHoursAfterStop: paper.cooldownHoursAfterStop,
    counterfactualHorizonHours: paper.counterfactualHorizonHours,
  });

  const { report, events } = await runPaperFromCandles({
    runId: 'diagnostic-replay',
    seed: args.seed,
    configVersion,
    dataSnapshotId,
    tokenIds: [tokenId],
    candles: selected,
    settings,
    paper,
    initialCapitalUsd: args.initialCapital,
  });

  const rows = buildBarDiagnostics({
    candles: selected,
    events,
    report,
    tokenId,
    timeframe,
  });
  const markers = buildMarkers(report, rows);
  const pages = renderChartPages({
    rows,
    markers,
    barsPerPage: 360,
    title: `ETH/BSC 1h diagnostic · ${tokenId}`,
  });

  const outDir = path.resolve(args.out);
  await mkdir(path.join(outDir, 'chart'), { recursive: true });
  for (const [index, svg] of pages.entries()) {
    await writeFile(
      path.join(outDir, 'chart', `page-${String(index + 1).padStart(2, '0')}.svg`),
      svg,
    );
  }

  const files = [
    'diagnostics.csv',
    'diagnostics.json',
    'annotations.csv',
    'chart.pdf',
    `chart/page-01.svg … page-${String(pages.length).padStart(2, '0')}.svg`,
    'summary.md',
  ];

  await writeFile(path.join(outDir, 'diagnostics.csv'), renderDiagnosticsCsv(rows));
  await writeFile(
    path.join(outDir, 'diagnostics.json'),
    `${JSON.stringify(
      {
        tokenId,
        timeframe,
        runId: 'diagnostic-replay',
        seed: args.seed,
        configVersion,
        dataSnapshotId,
        settingsVersion: settingsVersion(settings),
        rows,
      },
      null,
      2,
    )}\n`,
  );
  const annotationsPath = path.join(outDir, 'annotations.csv');
  try {
    await access(annotationsPath);
  } catch {
    await writeFile(annotationsPath, renderAnnotationTemplate());
  }
  await writeFile(
    path.join(outDir, 'summary.md'),
    summaryMarkdown({ tokenId, timeframe, report, rows, files }),
  );
  const pdfBytes = await buildPdf({
    outDir,
    pages,
    title: 'ETH/BSC diagnostic replay',
    report,
    tokenId,
    timeframe,
    snapshotId: dataSnapshotId,
  });

  console.log(
    JSON.stringify(
      {
        outDir,
        bars: rows.length,
        pages: pages.length,
        pdfBytes,
        finalEquityUsd: report.metrics.finalEquityUsd,
        totalReturnPct: report.metrics.totalReturnPct,
        maxDrawdownPct: report.metrics.maxDrawdownPct,
        tradeCount: report.metrics.tradeCount,
      },
      null,
      2,
    ),
  );
}

async function runAnnotate(args) {
  const outDir = path.resolve(args.out);
  const diagnostics = JSON.parse(await readFile(path.join(outDir, 'diagnostics.json'), 'utf8'));
  const annotations = parseAnnotationsCsv(await readFile(args.annotate, 'utf8'));
  const joined = joinAnnotations(annotations, diagnostics.rows);
  const report = renderAnnotationReport(joined);
  await writeFile(path.join(outDir, 'annotation-report.md'), report);
  console.log(
    JSON.stringify({
      outDir,
      marks: annotations.length,
      matched: joined.filter((item) => item.bar).length,
    }),
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
} else if (args.annotate) {
  await runAnnotate(args);
} else {
  await runExport(args);
}
