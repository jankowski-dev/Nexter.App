import path from 'node:path';
import { Injectable } from '@nestjs/common';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import pdfmake from 'pdfmake';
import Roboto from 'pdfmake/fonts/Roboto';
import { Decimal } from 'decimal.js';
import type { SandboxReplayReportResponse } from '@nexter/contracts';

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

export interface SandboxReplayPdfMeta {
  id: string;
  name: string;
  periodDays: number;
  fromTime: Date;
  toTime: Date;
}

@Injectable()
export class SandboxReplayPdfService {
  async build(
    response: SandboxReplayReportResponse,
    meta: SandboxReplayPdfMeta,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { report, identity } = response;
    const definition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [36, 34, 36, 46],
      defaultStyle: { font: 'Roboto', fontSize: 8.5, color: '#27272a' },
      info: {
        title: `Nexter — исторический прогон ${meta.name}`,
        author: 'Nexter',
        subject: 'Отчёт исторического paper-прогона',
      },
      footer: (currentPage, pageCount) => ({
        margin: [36, 0, 36, 0],
        columns: [
          {
            text: 'Nexter · historical-paper · виртуальные деньги · не инвестиционная рекомендация',
            color: MUTED,
            fontSize: 7.5,
          },
          {
            text: `${currentPage} / ${pageCount}`,
            alignment: 'right',
            color: MUTED,
            fontSize: 7.5,
          },
        ],
      }),
      content: [
        headerBlock(meta, identity),
        { text: '', margin: [0, 0, 0, 8] },
        identityTable(identity),
        { text: '', margin: [0, 0, 0, 8] },
        summaryTable(report.metrics),
        sectionTitle('Динамика капитала'),
        {
          svg: equitySvg(report.equityCurve),
          width: PAGE_WIDTH,
          height: 150,
          margin: [0, 0, 0, 4],
        },
        sectionTitle('По стратегиям'),
        strategyTable(report.metrics.perStrategy),
        sectionTitle('По токенам'),
        tokenTable(report.metrics.perToken),
        sectionTitle(`Сделки · ${report.trades.length}`),
        tradesTable(report.trades),
        sectionTitle(`Журнал интентов · ${report.intentJournal.length}`),
        intentsTable(report.intentJournal),
        sectionTitle(`Контрфактические наблюдения · ${report.counterfactuals.length}`),
        counterfactualTable(report.counterfactuals),
        sectionTitle('Технические данные'),
        notesBlock(response.notes),
        {
          text: 'Сформировано без wall-clock: отчёт и его хеши воспроизводятся из сохранённого снимка.',
          color: MUTED,
          fontSize: 7,
          margin: [0, 8, 0, 0],
        },
      ],
    };

    const buffer = await pdfmake.createPdf(definition).getBuffer();
    return { buffer, filename: `nexter-replay-${meta.id}.pdf` };
  }
}

function headerBlock(
  meta: SandboxReplayPdfMeta,
  identity: SandboxReplayReportResponse['identity'],
): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            fillColor: DARK,
            margin: [14, 12, 14, 12],
            stack: [
              {
                text: 'NEXTER  ·  ИСТОРИЧЕСКИЙ PAPER-ПРОГОН',
                color: '#a1a1aa',
                fontSize: 7,
                characterSpacing: 1.1,
              },
              { text: meta.name, color: '#ffffff', fontSize: 17, bold: true, margin: [0, 3, 0, 0] },
              {
                text: `${meta.periodDays} дней · ${formatTime(meta.fromTime)} → ${formatTime(meta.toTime)} · seed ${identity.seed}`,
                color: '#d4d4d8',
                fontSize: 8.5,
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

function identityTable(identity: SandboxReplayReportResponse['identity']): Content {
  return {
    table: {
      widths: ['*', '*'],
      body: [
        [
          { text: 'Report hash', color: MUTED, fontSize: 7 },
          { text: identity.reportHash, fontSize: 6.5 },
        ],
        [
          { text: 'Event hash / count', color: MUTED, fontSize: 7 },
          { text: `${identity.eventHash} · ${identity.eventCount}`, fontSize: 6.5 },
        ],
        [
          { text: 'Data snapshot', color: MUTED, fontSize: 7 },
          {
            text: `${identity.dataSnapshotId} · candle ${identity.candleSnapshotHash}`,
            fontSize: 6.5,
          },
        ],
        [
          { text: 'Config / settings', color: MUTED, fontSize: 7 },
          { text: `${identity.configVersion} · ${identity.settingsVersion}`, fontSize: 6.5 },
        ],
      ],
    },
    layout: {
      hLineColor: () => BORDER,
      vLineColor: () => BORDER,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
  };
}

function summaryTable(metrics: SandboxReplayReportResponse['report']['metrics']): Content {
  return {
    table: {
      widths: ['*', '*', '*', '*'],
      body: [
        [
          metric('Итоговый капитал', money(metrics.finalEquityUsd), DARK),
          metric('Доходность', pct(metrics.totalReturnPct), color(metrics.totalReturnPct)),
          metric('Макс. просадка', pct(metrics.maxDrawdownPct), RED),
          metric('Сделки', `${metrics.tradeCount} · ${metrics.wins}/${metrics.losses}`, DARK),
        ],
        [
          metric('Реализованный P&L', money(metrics.realizedPnlUsd), color(metrics.realizedPnlUsd)),
          metric('Комиссии', money(metrics.feesPaidUsd), DARK),
          metric('Кэш', money(metrics.finalCashUsd), DARK),
          metric('Позиции', money(metrics.finalPositionsValueUsd), DARK),
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 4,
      paddingTop: () => 2,
      paddingBottom: () => 2,
    },
  };
}

function metric(label: string, value: string, tone: string): Content {
  return {
    stack: [
      { text: label, color: MUTED, fontSize: 7 },
      { text: value, color: tone, fontSize: 11, bold: true, margin: [0, 1, 0, 0] },
    ],
  };
}

function strategyTable(
  rows: SandboxReplayReportResponse['report']['metrics']['perStrategy'],
): Content {
  return dataTable(
    ['Стратегия', 'Сделки', 'Победы', 'Поражения', 'P&L', 'Win rate'],
    rows.map((row) => [
      row.strategyKey,
      String(row.tradeCount),
      String(row.wins),
      String(row.losses),
      money(row.realizedPnlUsd),
      row.winRatePct === null ? '—' : pct(row.winRatePct),
    ]),
  );
}

function tokenTable(rows: SandboxReplayReportResponse['report']['metrics']['perToken']): Content {
  return dataTable(
    ['Токен', 'Сделки', 'Победы', 'Поражения', 'P&L', 'Win rate'],
    rows.map((row) => [
      row.tokenId,
      String(row.tradeCount),
      String(row.wins),
      String(row.losses),
      money(row.realizedPnlUsd),
      row.winRatePct === null ? '—' : pct(row.winRatePct),
    ]),
  );
}

function tradesTable(rows: SandboxReplayReportResponse['report']['trades']): Content {
  return dataTable(
    ['Токен', 'Стратегия', 'Вход', 'Цена', 'Выход', 'Цена', 'P&L', 'Причина'],
    rows.map((row) => [
      row.tokenId,
      row.strategyKey,
      formatTime(row.entryAt),
      price(row.entryPriceUsd),
      row.exitAt === null ? '—' : formatTime(row.exitAt),
      price(row.exitPriceUsd),
      money(row.realizedPnlUsd),
      row.exitReasonCode ?? '—',
    ]),
    [90, 70, 58, 48, 58, 48, 52, 80],
  );
}

function intentsTable(rows: SandboxReplayReportResponse['report']['intentJournal']): Content {
  return dataTable(
    ['Время', 'Токен', 'Сторона', 'Статус', 'Сумма', 'Причина'],
    rows.map((row) => [
      formatTime(row.fillTime ?? row.decisionTime),
      row.tokenId,
      row.side,
      row.status,
      money(row.filledUsd),
      `${row.reasonCode}${row.reasonText ? ` · ${row.reasonText}` : ''}`,
    ]),
    [62, 90, 36, 42, 48, 205],
  );
}

function counterfactualTable(
  rows: SandboxReplayReportResponse['report']['counterfactuals'],
): Content {
  return dataTable(
    ['Время', 'Токен', 'Причина', 'Вход', 'Выход', 'Return', 'Outcome'],
    rows.map((row) => [
      formatTime(row.decisionTime),
      row.tokenId,
      row.reasonCode,
      row.entryPriceUsd === null ? '—' : price(row.entryPriceUsd),
      row.exitPriceUsd === null ? '—' : price(row.exitPriceUsd),
      row.returnPct === null ? '—' : pct(row.returnPct),
      row.outcome,
    ]),
    [62, 90, 100, 48, 48, 48, 87],
  );
}

function notesBlock(notes: readonly string[]): Content {
  return {
    stack: notes.map((note) => ({
      text: `• ${note}`,
      color: MUTED,
      fontSize: 7.5,
      margin: [0, 1],
    })),
  };
}

function sectionTitle(text: string): Content {
  return {
    text,
    color: DARK,
    fontSize: 10,
    bold: true,
    margin: [0, 10, 0, 4],
  };
}

function dataTable(header: string[], rows: string[][], widths?: number[]): Content {
  const body: Content[][] = [
    header.map((cell) => ({ text: cell, bold: true, color: MUTED, fontSize: 6.8 })),
    ...rows.map((row) => row.map((cell) => ({ text: cell, fontSize: 6.8 }))),
  ];
  return {
    table: {
      headerRows: 1,
      widths: widths ?? Array.from({ length: header.length }, () => '*'),
      body,
    },
    layout: {
      hLineColor: () => BORDER,
      vLineColor: () => BORDER,
      paddingTop: () => 2,
      paddingBottom: () => 2,
      paddingLeft: () => 2,
      paddingRight: () => 2,
    },
  };
}

function equitySvg(points: SandboxReplayReportResponse['report']['equityCurve']): string {
  if (points.length === 0) return '';
  const width = 720;
  const height = 150;
  const pad = 12;
  const values = points.map((point) => Number(point.equityUsd));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const path = points
    .map((point, index) => {
      const x = pad + index * step;
      const y = height - pad - ((Number(point.equityUsd) - min) / span) * (height - pad * 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${path}" fill="none" stroke="#047857" stroke-width="2"/></svg>`;
}

function formatTime(value: number | Date): string {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16);
}

function money(value: string): string {
  return `$${new Decimal(value).toFixed(2)}`;
}

function price(value: string | null): string {
  if (value === null) return '—';
  return new Decimal(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function pct(value: string): string {
  return `${new Decimal(value).toFixed(2)}%`;
}

function color(value: string): string {
  const number = new Decimal(value);
  if (number.gt(0)) return GREEN;
  if (number.lt(0)) return RED;
  return DARK;
}
