import { BadRequestException, Injectable } from '@nestjs/common';
import type { TradeGroupSummary, Transaction } from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { LedgerService } from './ledger.service';
import { ReportingService } from './reporting.service';
import { TradeGroupsService } from './trade-groups.service';

type ExportDataset = 'transactions' | 'positions' | 'trade-groups';
type ExportFormat = 'csv' | 'json';

interface ExportMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class ExportService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly reporting: ReportingService,
    private readonly tradeGroups: TradeGroupsService,
    private readonly audit: AuditService,
  ) {}

  async export(
    userId: string,
    dataset: string,
    format: string,
    meta: ExportMeta,
  ): Promise<{ contentType: string; fileName: string; body: string }> {
    if (!['transactions', 'positions', 'trade-groups'].includes(dataset)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Unknown export dataset',
      });
    }
    if (!['csv', 'json'].includes(format)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Unknown export format',
      });
    }

    const typedDataset = dataset as ExportDataset;
    const typedFormat = format as ExportFormat;
    let rows: Array<Record<string, unknown>>;
    let json: unknown;

    if (typedDataset === 'transactions') {
      const transactions = await this.allTransactions(userId);
      rows = transactions.map((transaction) => ({
        id: transaction.id,
        occurredAt: transaction.occurredAt,
        type: transaction.type,
        subtype: transaction.subtype,
        source: transaction.source,
        sourceId: transaction.sourceId ?? '',
        tradeGroupId: transaction.tradeGroupId ?? '',
        notes: transaction.notes ?? '',
        feesUsd: transaction.feesUsd,
        postings: JSON.stringify(transaction.postings),
      }));
      json = transactions;
    } else if (typedDataset === 'positions') {
      const positions = await this.reporting.positions(userId);
      rows = [
        {
          asset: 'CASH',
          chain: 'cash',
          amount: positions.cashUsd,
          priceUsd: '1',
          valueUsd: positions.cashUsd,
          costBasisUsd: positions.cashUsd,
          unrealizedPnlUsd: '0',
          cashEquivalent: 'true',
        },
        ...positions.positions.map((position) => ({
          asset: position.asset.symbol,
          chain: position.asset.chainCode,
          amount: position.amount,
          priceUsd: position.priceUsd ?? '',
          valueUsd: position.valueUsd ?? '',
          costBasisUsd: position.costBasisUsd,
          unrealizedPnlUsd: position.unrealizedPnlUsd ?? '',
          cashEquivalent: 'false',
        })),
      ];
      json = positions;
    } else {
      const groups = await this.allTradeGroups(userId);
      rows = groups.map((group) => ({
        id: group.id,
        asset: group.asset.symbol,
        chain: group.asset.chainCode,
        status: group.status,
        openedAt: group.openedAt,
        closedAt: group.closedAt ?? '',
        buyUsd: group.buyUsd,
        sellUsd: group.sellUsd,
        realizedPnlUsd: group.realizedPnlUsd,
        unrealizedPnlUsd: group.unrealizedPnlUsd ?? '',
        totalPnlUsd: group.totalPnlUsd ?? '',
        remainingAmount: group.remainingAmount,
        remainingCostBasisUsd: group.remainingCostBasisUsd,
        returnPct: group.returnPct ?? '',
        holdingDays: group.holdingDays,
        source: group.source,
        notes: group.notes ?? '',
      }));
      json = groups;
    }

    await this.audit.log(
      {
        userId,
        action: 'export.generated',
        entityType: 'export',
        after: { dataset: typedDataset, format: typedFormat, rows: rows.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
      { strict: true },
    );

    const date = new Date().toISOString().slice(0, 10);
    return {
      contentType:
        typedFormat === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      fileName: `nexter-${typedDataset}-${date}.${typedFormat}`,
      body: typedFormat === 'csv' ? this.toCsv(rows) : JSON.stringify(json, null, 2),
    };
  }

  private async allTransactions(userId: string): Promise<Transaction[]> {
    const all: Transaction[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.ledger.list(userId, { limit: 100, cursor });
      all.push(...page.transactions);
      cursor = page.page.nextCursor ?? undefined;
      if (!page.page.hasMore) break;
    } while (cursor);

    return all;
  }

  private async allTradeGroups(userId: string): Promise<TradeGroupSummary[]> {
    const all: TradeGroupSummary[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.tradeGroups.list(userId, { limit: 100, cursor });
      all.push(...page.data);
      cursor = page.page.nextCursor ?? undefined;
      if (!page.page.hasMore) break;
    } while (cursor);

    return all;
  }

  private toCsv(rows: Array<Record<string, unknown>>): string {
    if (rows.length === 0) return '';

    const headers = Object.keys(rows[0] ?? {});
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      // CSV formula injection: Excel/Sheets evaluate leading =, +, - and @.
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };

    return [
      headers.map(escape).join(','),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
    ].join('\r\n');
  }
}
