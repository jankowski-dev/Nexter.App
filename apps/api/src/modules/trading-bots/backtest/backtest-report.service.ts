import { Injectable } from '@nestjs/common';
import path from 'node:path';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import pdfmake from 'pdfmake';
import Roboto from 'pdfmake/fonts/Roboto';
import type { BotBacktestRun, BotStrategyTemplate } from '@nexter/contracts';
import { decimal } from '../../../shared/money/decimal';

const FONTS_DIR = path.dirname(Roboto.Roboto.normal);
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((file) =>
  path.resolve(file).startsWith(`${path.resolve(FONTS_DIR)}${path.sep}`),
);
pdfmake.addFonts(Roboto);

const PAGE_WIDTH = 523;
const DARK = '#18181b';
const MUTED = '#71717a';
const BORDER = '#e4e4e7';
const GREEN = '#047857';
const RED = '#b91c1c';
const AMBER = '#b45309';

@Injectable()
export class BacktestReportService {
  async build(run: BotBacktestRun, strategy: BotStrategyTemplate): Promise<Buffer> {
    const missingDays = countMissingDays(run.candles);
    const firstDate = run.candles[0]?.date;
    const lastDate = run.candles[run.candles.length - 1]?.date;
    const createdLabel = new Date(run.createdAt).toLocaleString('ru-RU', { timeZone: 'UTC' });

    const definition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [36, 34, 36, 46],
      defaultStyle: { font: 'Roboto', fontSize: 9, color: '#27272a' },
      info: {
        title: `Nexter — бэктест ${strategy.name} / ${run.asset.symbol}`,
        author: 'Nexter',
        subject: 'Отчёт по историческому прогону стратегии',
      },
      footer: (currentPage, pageCount) => ({
        margin: [36, 0, 36, 0],
        columns: [
          {
            text: 'Nexter · исторический бэктест · не инвестиционная рекомендация',
            color: MUTED,
            fontSize: 8,
          },
          { text: `${currentPage} / ${pageCount}`, alignment: 'right', color: MUTED, fontSize: 8 },
        ],
      }),
      content: [
        headerBlock(run, strategy),
        { text: '', margin: [0, 0, 0, 10] },
        summaryCards(run),
        { text: '', margin: [0, 0, 0, 8] },
        comparisonBlock(run),
        sectionTitle('Исходные условия'),
        conditionsTable(run, strategy, missingDays, firstDate, lastDate),
        sectionTitle('Динамика капитала'),
        { svg: equitySvg(run), width: PAGE_WIDTH, height: 142, margin: [0, 0, 0, 4] },
        sectionTitle('Параметры стратегии', true),
        paramsTable(run, strategy),
        sectionTitle('Гайд по стратегии'),
        { text: strategy.guide, color: MUTED, fontSize: 8, margin: [0, 0, 0, 6] },
        sectionTitle(`Сделки · ${run.trades.length}`),
        tradesTable(run),
        { text: '', margin: [0, 0, 0, 8] },
        disclaimerBlock(missingDays),
        {
          text: `Сформировано: ${createdLabel} UTC · прогон ${run.id}`,
          color: MUTED,
          fontSize: 7.5,
          margin: [0, 8, 0, 0],
        },
      ],
    };

    return pdfmake.createPdf(definition).getBuffer();
  }
}

function headerBlock(run: BotBacktestRun, strategy: BotStrategyTemplate): Content {
  const source = sourceLabel(run.source);
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            fillColor: DARK,
            margin: [16, 14, 16, 14],
            stack: [
              {
                text: 'NEXTER  ·  ИСТОРИЧЕСКИЙ БЭКТЕСТ',
                color: '#a1a1aa',
                fontSize: 7.5,
                characterSpacing: 1.2,
              },
              {
                text: `${strategy.name} / ${run.asset.symbol}`,
                color: '#ffffff',
                fontSize: 18,
                bold: true,
                margin: [0, 4, 0, 0],
              },
              {
                text: `${run.asset.name} · ${run.asset.chainCode.toUpperCase()} · ${run.days} дней · ${source}`,
                color: '#d4d4d8',
                fontSize: 9,
                margin: [0, 3, 0, 0],
              },
            ],
          },
        ],
      ],
    },
    layout: 'noBorders',
  };
}

function summaryCards(run: BotBacktestRun): Content {
  const stats = run.stats;
  const cards: Content[] = [
    metricCard('Итоговый капитал', formatUsd(stats.finalEquityUsd), DARK),
    metricCard('Общий P&L', formatSignedUsd(stats.totalPnlUsd), pnlColor(stats.totalPnlUsd)),
    metricCard('Доходность', formatPct(stats.totalReturnPct), pnlColor(stats.totalReturnPct)),
    metricCard('Профит-фактор', stats.profitFactor ?? '—', DARK),
    metricCard('Общий доход', formatUsd(stats.grossProfitUsd), GREEN),
    metricCard('Общий убыток', formatUsd(stats.grossLossUsd), RED),
    metricCard('Win rate', stats.winRate ? `${stats.winRate}%` : '—', DARK),
    metricCard('Сделки', `${stats.tradesCount} · ${stats.wins}/${stats.losses}`, DARK),
    metricCard('Макс. просадка', `${stats.maxDrawdownPct}%`, RED),
    metricCard(
      'Купить и держать',
      formatPct(stats.buyHoldReturnPct),
      pnlColor(stats.buyHoldReturnPct ?? '0'),
    ),
  ];

  const rows: Content[][] = [];
  for (let index = 0; index < cards.length; index += 4) {
    const row = cards.slice(index, index + 4);
    while (row.length < 4) row.push({ text: '' });
    rows.push(row);
  }

  return {
    table: { widths: ['*', '*', '*', '*'], body: rows },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

function metricCard(label: string, value: string, color: string): Content {
  return {
    fillColor: '#f8fafc',
    margin: [8, 7, 8, 7],
    stack: [
      { text: label, color: MUTED, fontSize: 7.5 },
      { text: value, color, fontSize: 13, bold: true, margin: [0, 2, 0, 0] },
    ],
  };
}

function comparisonBlock(run: BotBacktestRun): Content {
  const stats = run.stats;
  const difference = decimal(stats.totalReturnPct)
    .minus(decimal(stats.buyHoldReturnPct ?? '0'))
    .toFixed(2);
  return {
    table: {
      widths: ['*', '*', '*'],
      body: [
        [
          comparisonCell('Стратегия', formatPct(stats.totalReturnPct)),
          comparisonCell('Купить и держать', formatPct(stats.buyHoldReturnPct)),
          comparisonCell('Разница', `${formatSignedNumber(difference)} п.п.`),
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

function comparisonCell(label: string, value: string): Content {
  return {
    fillColor: '#f4f4f5',
    margin: [8, 6, 8, 6],
    stack: [
      { text: label, fontSize: 7.5, color: MUTED },
      { text: value, fontSize: 10, bold: true, color: DARK, margin: [0, 1, 0, 0] },
    ],
  };
}

function conditionsTable(
  run: BotBacktestRun,
  strategy: BotStrategyTemplate,
  missingDays: number,
  firstDate: string | undefined,
  lastDate: string | undefined,
): Content {
  const stopLoss = numberParam(run.strategyParams.stopLossPct);
  const takeProfit = numberParam(run.strategyParams.takeProfitPct);
  const rows: Content[][] = [
    conditionRow('Стратегия', `${strategy.name} (${strategy.key})`),
    conditionRow('Токен', `${run.asset.symbol} · ${run.asset.name}`),
    conditionRow('Сеть', run.asset.chainCode.toUpperCase()),
    conditionRow(
      'Период',
      `${run.days} дней${firstDate && lastDate ? ` · ${formatDate(firstDate)} — ${formatDate(lastDate)}` : ''}`,
    ),
    conditionRow('Источник данных', `${sourceLabel(run.source)} · ${run.candles.length} свечей`),
    conditionRow(
      'Пропуски в данных',
      missingDays > 0 ? `${missingDays} дн.` : 'нет',
      missingDays > 0 ? AMBER : DARK,
    ),
    conditionRow('Начальный капитал', formatUsd(run.stats.initialCapitalUsd)),
    conditionRow('Комиссия / проскальзывание', '25 bps / 10 bps'),
    conditionRow('Вход и выход по сигналу', 'по цене закрытия дня'),
    conditionRow(
      'Стоп-лосс',
      run.useStopLoss && stopLoss !== null
        ? `${stopLoss}% · внутри дня, гэп — по открытию`
        : 'выключен',
      run.useStopLoss && stopLoss !== null ? DARK : AMBER,
    ),
    conditionRow(
      'Тейк-профит',
      run.useTakeProfit && takeProfit !== null
        ? `${takeProfit}% · внутри дня, гэп — по открытию`
        : 'выключен',
      run.useTakeProfit && takeProfit !== null ? DARK : AMBER,
    ),
    conditionRow('Реинвестирование', run.reinvestProfit ? 'включено' : 'выключено'),
    conditionRow(
      'Размер покупки',
      run.reinvestProfit ? 'от текущего капитала / maxAdds' : 'от стартового капитала / maxAdds',
    ),
  ];

  return {
    table: { widths: [150, '*'], body: rows },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => BORDER,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
  };
}

function conditionRow(label: string, value: string, color = DARK): Content[] {
  return [
    { text: label, color: MUTED, fontSize: 8.5 },
    { text: value, color, fontSize: 8.5 },
  ];
}

function paramsTable(run: BotBacktestRun, strategy: BotStrategyTemplate): Content {
  const fields = strategy.paramFields;
  const rows: Content[][] = fields.map((field) => {
    const value = run.strategyParams[field.key];
    return [
      { text: field.label, color: MUTED, fontSize: 8.5 },
      {
        text: value === undefined ? '—' : `${String(value)}${field.unit ? ` ${field.unit}` : ''}`,
        color: DARK,
        fontSize: 8.5,
        alignment: 'right',
      },
    ];
  });

  if (rows.length === 0) {
    rows.push([
      { text: 'Параметры не заданы', color: MUTED, fontSize: 8.5 },
      { text: '', fontSize: 8.5 },
    ]);
  }

  return {
    table: { widths: ['*', 'auto'], body: rows },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => BORDER,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
  };
}

function tradesTable(run: BotBacktestRun): Content {
  const rows: Content[][] = [
    [
      headerCell('Дата'),
      headerCell('Сторона'),
      headerCell('Цена'),
      headerCell('Кол-во'),
      headerCell('Сумма'),
      headerCell('P&L'),
      headerCell('Причина'),
    ],
  ];

  run.trades.forEach((trade, index) => {
    const fill = index % 2 === 1 ? '#fafafa' : undefined;
    rows.push([
      bodyCell(formatDate(trade.date), 7.5, fill),
      bodyCell(
        trade.side === 'buy' ? 'Покупка' : 'Продажа',
        7.5,
        fill,
        trade.side === 'buy' ? '#0369a1' : '#7c3aed',
      ),
      bodyCell(formatPrice(trade.priceUsd), 7.5, fill),
      bodyCell(formatAmount(trade.amount), 7.5, fill),
      bodyCell(formatUsd(trade.usdValue), 7.5, fill),
      trade.side === 'sell'
        ? bodyCell(formatSignedUsd(trade.realizedPnlUsd), 7.5, fill, pnlColor(trade.realizedPnlUsd))
        : bodyCell('—', 7.5, fill, MUTED),
      bodyCell(trade.reason, 7.5, fill),
    ]);
  });

  return {
    table: {
      headerRows: 1,
      widths: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*'],
      body: rows,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => BORDER,
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5,
    },
  };
}

function headerCell(text: string): Content {
  return { text, bold: true, color: '#52525b', fontSize: 7.5, fillColor: '#f4f4f5' };
}

function bodyCell(text: string, fontSize: number, fillColor?: string, color = '#27272a'): Content {
  return { text, fontSize, fillColor, color };
}

function sectionTitle(text: string, pageBreak = false): Content {
  return {
    text,
    fontSize: 10.5,
    bold: true,
    color: DARK,
    margin: [0, 10, 0, 5],
    ...(pageBreak ? { pageBreak: 'before' as const } : {}),
  };
}

function disclaimerBlock(missingDays: number): Content {
  const parts: Content[] = [
    {
      text: 'Методика. ',
      bold: true,
    },
    {
      text: 'Вход и выход по сигналам стратегии — по цене закрытия дня. Стоп-лосс и тейк-профит проверяются по high/low дневной свечи: при пересечении порога исполняются по порогу, при гэпе — по цене открытия; если задеты оба уровня, консервативно считается стоп. Комиссия 25 bps и проскальзывание 10 bps применяются к каждой сделке. Открытая позиция принудительно закрывается в последний день.',
    },
  ];
  if (missingDays > 0) {
    parts.push({
      text: ` В данных ${missingDays} пропущенных дн. Для низколиквидных токенов источник может отдавать неполный ряд: стоп/тейк могут сработать с задержкой, а гэп — исполниться по открытию следующей свечи.`,
      color: AMBER,
    });
  }
  parts.push({
    text: ' Прошлые результаты не гарантируют будущую доходность. Это бумажный бэктест, а не инвестиционная рекомендация.',
    color: MUTED,
  });

  return {
    table: {
      widths: ['*'],
      body: [[{ margin: [8, 6, 8, 6], stack: [{ text: parts, fontSize: 7.5, lineHeight: 1.25 }] }]],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      fillColor: () => '#f8fafc',
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

function equitySvg(run: BotBacktestRun): string {
  const width = 700;
  const height = 190;
  const left = 10;
  const right = 12;
  const top = 12;
  const bottom = 18;
  const points = run.equityCurve.map((point) => Number(point.equityUsd));
  if (points.length < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#f8fafc"/></svg>`;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || Math.max(1, Math.abs(max) * 0.01);
  const paddedMin = min - span * 0.08;
  const paddedMax = max + span * 0.08;
  const x = (index: number) => left + (index / (points.length - 1)) * (width - left - right);
  const y = (value: number) =>
    top + ((paddedMax - value) / (paddedMax - paddedMin)) * (height - top - bottom);
  const line = points
    .map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ');
  const area = `M ${left} ${height - bottom} L ${line.replaceAll(' ', ' L ')} L ${width - right} ${height - bottom} Z`;
  const grid = [0, 1, 2, 3].map((index) => {
    const gy = top + (index / 3) * (height - top - bottom);
    return `<line x1="${left}" x2="${width - right}" y1="${gy}" y2="${gy}" stroke="#e4e4e7" stroke-width="1" stroke-dasharray="3 5"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" rx="10" fill="#f8fafc"/>
    ${grid.join('')}
    <path d="${area}" fill="#10b981" fill-opacity="0.08"/>
    <polyline points="${line}" fill="none" stroke="#059669" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(points.length - 1)}" cy="${y(points[points.length - 1] as number)}" r="3.5" fill="#059669" stroke="#ffffff" stroke-width="1.5"/>
  </svg>`;
}

function countMissingDays(candles: Array<{ date: string }>): number {
  const dayMs = 86_400_000;
  let missing = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const previous = Date.parse(`${candles[index - 1]?.date}T00:00:00.000Z`);
    const current = Date.parse(`${candles[index]?.date}T00:00:00.000Z`);
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    const gap = Math.round((current - previous) / dayMs) - 1;
    if (gap > 0) missing += gap;
  }
  return missing;
}

function sourceLabel(source: string): string {
  if (source === 'coingecko') return 'CoinGecko';
  if (source === 'geckoterminal') return 'GeckoTerminal';
  return source;
}

function numberParam(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pnlColor(value: string): string {
  const parsed = Number(value);
  return parsed > 0 ? GREEN : parsed < 0 ? RED : DARK;
}

function formatUsd(value: string): string {
  return `$${decimal(value).toFixed(2)}`;
}

function formatSignedUsd(value: string): string {
  const parsed = decimal(value);
  return `${parsed.gt(0) ? '+' : ''}$${parsed.toFixed(2)}`;
}

function formatSignedNumber(value: string): string {
  const parsed = decimal(value);
  return `${parsed.gt(0) ? '+' : ''}${parsed.toFixed(2)}`;
}

function formatPct(value: string | null): string {
  if (value === null) return '—';
  const parsed = decimal(value);
  return `${parsed.gt(0) ? '+' : ''}${parsed.toFixed(2)}%`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function formatPrice(value: string): string {
  const parsed = decimal(value);
  if (parsed.gte(1)) return parsed.toFixed(4);
  if (parsed.gte(0.01)) return parsed.toFixed(6);
  return parsed.toFixed(8);
}

function formatAmount(value: string): string {
  const parsed = decimal(value);
  return parsed.gte(1) ? parsed.toFixed(4) : parsed.toFixed(8);
}
