import { Injectable } from '@nestjs/common';
import path from 'node:path';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import pdfmake from 'pdfmake';
import Roboto from 'pdfmake/fonts/Roboto';
import type { BotBacktestRun } from '@nexter/contracts';
import { decimal } from '../../../shared/money/decimal';

const FONTS_DIR = path.dirname(Roboto.Roboto.normal);
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((file) =>
  path.resolve(file).startsWith(`${path.resolve(FONTS_DIR)}${path.sep}`),
);
pdfmake.addFonts(Roboto);

@Injectable()
export class BacktestReportService {
  async build(run: BotBacktestRun, strategyGuide: string): Promise<Buffer> {
    const stats = run.stats;
    const created = new Date(run.createdAt);
    const createdLabel = created.toLocaleString('ru-RU', { timeZone: 'UTC' });
    const missingDays = countMissingDays(run.candles);

    const definition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 46],
      defaultStyle: { font: 'Roboto', fontSize: 9, color: '#27272a' },
      info: {
        title: `Nexter — бэктест ${run.strategyName} / ${run.asset.symbol}`,
        author: 'Nexter',
        subject: 'Отчёт по историческому прогону стратегии',
      },
      footer: (currentPage, pageCount) => ({
        margin: [36, 0, 36, 0],
        columns: [
          { text: 'Nexter · бумажный бэктест, не инвестиционная рекомендация', color: '#71717a' },
          { text: `${currentPage} / ${pageCount}`, alignment: 'right', color: '#71717a' },
        ],
        fontSize: 8,
      }),
      content: [
        { text: 'Nexter — отчёт по бэктесту', fontSize: 18, bold: true, color: '#18181b' },
        {
          text: `${run.strategyName} · ${run.asset.symbol} · ${run.days} дней`,
          fontSize: 11,
          color: '#52525b',
          margin: [0, 3, 0, 12],
        },
        {
          columns: [
            infoBlock('Стратегия', `${run.strategyName}\n${run.strategyKey}`),
            infoBlock('Токен', `${run.asset.symbol}\n${run.asset.name}`),
            infoBlock('Сеть / источник', `${run.asset.chainCode}\n${run.source}`),
            infoBlock('Прогон', `${createdLabel}\n${run.id.slice(0, 8)}`),
          ],
          margin: [0, 0, 0, 14],
        },
        sectionTitle('Итоги прогона'),
        summaryTable(run),
        sectionTitle('Сравнение с удержанием'),
        {
          table: {
            widths: ['*', '*', '*'],
            body: [
              [headerCell('Стратегия'), headerCell('Купить и держать'), headerCell('Разница')],
              [
                `${formatPct(stats.totalReturnPct)}`,
                `${formatPct(stats.buyHoldReturnPct)}`,
                `${formatPct(
                  decimal(stats.totalReturnPct)
                    .minus(decimal(stats.buyHoldReturnPct ?? '0'))
                    .toFixed(2),
                )}`,
              ],
            ],
          },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 14],
        },
        sectionTitle('Параметры стратегии'),
        paramsTable(run),
        sectionTitle('Гайд по стратегии'),
        { text: strategyGuide, color: '#52525b', margin: [0, 0, 0, 14] },
        ...(missingDays > 0
          ? [
              {
                text: `В данных ${missingDays} пропущенных дн. Для низколиквидных токенов источник может отдавать неполный ряд: стоп/тейк могут сработать с задержкой, а гэп — исполниться по цене открытия.`,
                color: '#b45309',
                fontSize: 8,
                margin: [0, 0, 0, 12] as [number, number, number, number],
              },
            ]
          : []),
        sectionTitle(`Сделки (${run.trades.length})`),
        tradesTable(run),
        {
          text: 'Вход и выход по стратегии исполняются по цене закрытия дневной свечи; стоп-лосс и тейк-профит проверяются внутри дня по high/low и исполняются по порогу, а при гэпе — по цене открытия. Комиссия 25 bps и проскальзывание 10 bps. Открытая позиция принудительно закрывается в последний день периода. Прошлые результаты не гарантируют будущую доходность.',
          fontSize: 7.5,
          color: '#71717a',
          margin: [0, 12, 0, 0],
        },
      ],
    };

    return pdfmake.createPdf(definition).getBuffer();
  }
}

function infoBlock(label: string, value: string): Content {
  return {
    stack: [
      { text: label.toUpperCase(), fontSize: 7, color: '#a1a1aa', characterSpacing: 0.5 },
      { text: value, fontSize: 9, color: '#27272a', margin: [0, 2, 0, 0] },
    ],
  };
}

function sectionTitle(text: string): Content {
  return {
    text,
    fontSize: 11,
    bold: true,
    color: '#18181b',
    margin: [0, 10, 0, 6],
  };
}

function summaryTable(run: BotBacktestRun): Content {
  const stats = run.stats;
  const rows: Content[][] = [
    [
      headerCell('Показатель'),
      headerCell('Значение'),
      headerCell('Показатель'),
      headerCell('Значение'),
    ],
    [
      bodyCell('Начальный капитал'),
      bodyCell(formatUsd(stats.initialCapitalUsd)),
      bodyCell('Итоговый капитал'),
      bodyCell(formatUsd(stats.finalEquityUsd)),
    ],
    [
      bodyCell('Общий P&L'),
      pnlCell(stats.totalPnlUsd),
      bodyCell('Доходность'),
      pnlCell(`${stats.totalReturnPct}%`),
    ],
    [
      bodyCell('Общая прибыль'),
      profitCell(stats.grossProfitUsd),
      bodyCell('Общий убыток'),
      lossCell(stats.grossLossUsd),
    ],
    [
      bodyCell('Профит-фактор'),
      bodyCell(stats.profitFactor ?? '—'),
      bodyCell('Win rate'),
      bodyCell(stats.winRate ? `${stats.winRate}%` : '—'),
    ],
    [
      bodyCell('Сделки'),
      bodyCell(String(stats.tradesCount)),
      bodyCell('Прибыльных / убыточных'),
      bodyCell(`${stats.wins} / ${stats.losses}`),
    ],
    [
      bodyCell('Макс. просадка'),
      bodyCell(`${stats.maxDrawdownPct}%`),
      bodyCell('Дней в периоде'),
      bodyCell(String(run.days)),
    ],
  ];
  return {
    table: { widths: ['*', '*', '*', '*'], body: rows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 6],
  };
}

function paramsTable(run: BotBacktestRun): Content {
  const entries = Object.entries(run.strategyParams);
  const rows: Content[][] = [
    [
      headerCell('Параметр'),
      headerCell('Значение'),
      headerCell('Параметр'),
      headerCell('Значение'),
    ],
  ];
  for (let index = 0; index < entries.length; index += 2) {
    const left = entries[index];
    const right = entries[index + 1];
    rows.push([
      bodyCell(left?.[0] ?? ''),
      bodyCell(left ? String(left[1]) : ''),
      bodyCell(right?.[0] ?? ''),
      bodyCell(right ? String(right[1]) : ''),
    ]);
  }
  return {
    table: { widths: ['*', '*', '*', '*'], body: rows },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 6],
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

  for (const trade of run.trades) {
    rows.push([
      bodyCell(trade.date, 7.5),
      bodyCell(trade.side === 'buy' ? 'Покупка' : 'Продажа', 7.5),
      bodyCell(formatPrice(trade.priceUsd), 7.5),
      bodyCell(formatAmount(trade.amount), 7.5),
      bodyCell(formatUsd(trade.usdValue), 7.5),
      trade.side === 'sell'
        ? pnlCell(formatSignedUsd(trade.realizedPnlUsd), 7.5)
        : bodyCell('—', 7.5),
      bodyCell(trade.reason, 7.5),
    ]);
  }

  return {
    table: {
      headerRows: 1,
      widths: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*'],
      body: rows,
    },
    layout: 'lightHorizontalLines',
  };
}

function headerCell(text: string): Content {
  return { text, bold: true, color: '#52525b', fontSize: 8 };
}

function bodyCell(text: string, fontSize = 8.5): Content {
  return { text, fontSize };
}

function profitCell(text: string): Content {
  return { text, color: '#047857', bold: true, fontSize: 8.5 };
}

function lossCell(text: string): Content {
  return { text, color: '#b91c1c', bold: true, fontSize: 8.5 };
}

function pnlCell(text: string, fontSize = 8.5): Content {
  const parsed = Number(text.replace('%', ''));
  return {
    text,
    color: parsed > 0 ? '#047857' : parsed < 0 ? '#b91c1c' : '#27272a',
    bold: parsed !== 0,
    fontSize,
  };
}

function formatUsd(value: string): string {
  return `$${decimal(value).toFixed(2)}`;
}

function formatSignedUsd(value: string): string {
  const parsed = decimal(value);
  return `${parsed.gt(0) ? '+' : ''}$${parsed.toFixed(2)}`;
}

function formatPct(value: string | null): string {
  if (value === null) return '—';
  const parsed = decimal(value);
  return `${parsed.gt(0) ? '+' : ''}${parsed.toFixed(2)}%`;
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
