import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { financeFxRates, type Database, type FinanceFxRate } from '@nexter/db';
import type {
  FinanceFxCurrency,
  FinanceFxRateSource,
  FinanceFxRatesResponse,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import { decimal } from '../../shared/money/decimal';

const QUOTED_CURRENCIES: readonly FinanceFxCurrency[] = ['USD', 'EUR', 'CNY'];
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
const NBRB_URL = 'https://api.nbrb.by/exrates/rates?periodicity=0';

interface FinanceMeta {
  ip?: string;
  userAgent?: string;
}

interface ParsedRate {
  currency: FinanceFxCurrency;
  rate: string;
  rateDate: string;
}

function isQuotedCurrency(value: string): value is FinanceFxCurrency {
  return (QUOTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * NBRB publishes `Cur_OfficialRate` for `Cur_Scale` units. Nexter stores the
 * BYN price of one unit, so the official rate is divided by the scale.
 */
export function parseNbrbRates(payload: unknown): ParsedRate[] {
  if (!Array.isArray(payload)) {
    throw new BadGatewayException({
      code: 'NBRB_UNAVAILABLE',
      message: 'NBRB returned an unexpected response',
    });
  }

  const found = new Map<FinanceFxCurrency, ParsedRate>();

  for (const item of payload) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const code = String(row.Cur_Abbreviation ?? '').toUpperCase();
    if (!isQuotedCurrency(code)) continue;

    const scale = Number(row.Cur_Scale ?? 1);
    const official = row.Cur_OfficialRate;
    if (!Number.isFinite(scale) || scale <= 0 || official === null || official === undefined) {
      continue;
    }

    const rate = decimal(String(official)).div(scale);
    if (!rate.isFinite() || rate.lte(0)) continue;

    const rawDate = String(row.Date ?? '');
    const rateDate = /^\d{4}-\d{2}-\d{2}/.test(rawDate)
      ? rawDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    found.set(code, { currency: code, rate: rate.toFixed(8), rateDate });
  }

  const missing = QUOTED_CURRENCIES.filter((currency) => !found.has(currency));
  if (missing.length > 0) {
    throw new BadGatewayException({
      code: 'NBRB_UNAVAILABLE',
      message: `NBRB response is missing: ${missing.join(', ')}`,
    });
  }

  return QUOTED_CURRENCIES.map((currency) => found.get(currency)!);
}

function toContract(row: FinanceFxRate) {
  if (!isQuotedCurrency(row.currency)) {
    throw new Error(`Unexpected finance FX currency: ${row.currency}`);
  }

  return {
    currency: row.currency,
    rate: row.rate,
    source: row.source as FinanceFxRateSource,
    rateDate: row.rateDate,
    fetchedAt: row.fetchedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class FinanceFxRatesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<FinanceFxRatesResponse> {
    const rows = await this.db
      .select()
      .from(financeFxRates)
      .where(eq(financeFxRates.userId, userId));
    return this.toResponse(rows);
  }

  async refresh(userId: string, meta: FinanceMeta): Promise<FinanceFxRatesResponse> {
    const parsed = await this.fetchNbrb();
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(financeFxRates)
        .where(eq(financeFxRates.userId, userId));
      const manual = new Set(
        existing.filter((row) => row.source === 'manual').map((row) => row.currency),
      );

      for (const rate of parsed) {
        if (manual.has(rate.currency)) continue;
        await tx
          .insert(financeFxRates)
          .values({
            userId,
            currency: rate.currency,
            rate: rate.rate,
            source: 'nbrb',
            rateDate: rate.rateDate,
            fetchedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [financeFxRates.userId, financeFxRates.currency],
            set: {
              rate: rate.rate,
              source: 'nbrb',
              rateDate: rate.rateDate,
              fetchedAt: now,
              updatedAt: now,
            },
          });
      }

      await this.audit.log(
        {
          userId,
          action: 'finance.rates_refreshed',
          entityType: 'finance_fx_rates',
          entityId: userId,
          after: {
            rates: parsed,
            manualSkipped: [...manual],
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.list(userId);
  }

  async setManual(
    userId: string,
    currency: FinanceFxCurrency,
    rate: string,
    meta: FinanceMeta,
  ): Promise<FinanceFxRatesResponse> {
    const now = new Date();
    const before = await this.find(userId, currency);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(financeFxRates)
        .values({
          userId,
          currency,
          rate,
          source: 'manual',
          rateDate: now.toISOString().slice(0, 10),
          fetchedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [financeFxRates.userId, financeFxRates.currency],
          set: {
            rate,
            source: 'manual',
            rateDate: now.toISOString().slice(0, 10),
            fetchedAt: now,
            updatedAt: now,
          },
        });

      await this.audit.log(
        {
          userId,
          action: 'finance.rate_manual_override',
          entityType: 'finance_fx_rates',
          entityId: userId,
          before: before ? toContract(before) : null,
          after: { currency, rate, source: 'manual' },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.list(userId);
  }

  async reset(
    userId: string,
    currency: FinanceFxCurrency,
    meta: FinanceMeta,
  ): Promise<FinanceFxRatesResponse> {
    const parsed = await this.fetchNbrb();
    const target = parsed.find((rate) => rate.currency === currency);
    if (!target) {
      throw new BadGatewayException({
        code: 'NBRB_UNAVAILABLE',
        message: `NBRB has no rate for ${currency}`,
      });
    }

    const now = new Date();
    const before = await this.find(userId, currency);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(financeFxRates)
        .values({
          userId,
          currency,
          rate: target.rate,
          source: 'nbrb',
          rateDate: target.rateDate,
          fetchedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [financeFxRates.userId, financeFxRates.currency],
          set: {
            rate: target.rate,
            source: 'nbrb',
            rateDate: target.rateDate,
            fetchedAt: now,
            updatedAt: now,
          },
        });

      await this.audit.log(
        {
          userId,
          action: 'finance.rate_reset',
          entityType: 'finance_fx_rates',
          entityId: userId,
          before: before ? toContract(before) : null,
          after: target,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );
    });

    return this.list(userId);
  }

  private async find(userId: string, currency: FinanceFxCurrency): Promise<FinanceFxRate | null> {
    const [row] = await this.db
      .select()
      .from(financeFxRates)
      .where(and(eq(financeFxRates.userId, userId), eq(financeFxRates.currency, currency)))
      .limit(1);
    return row ?? null;
  }

  private toResponse(rows: FinanceFxRate[]): FinanceFxRatesResponse {
    const now = Date.now();
    const byCurrency = new Map(rows.map((row) => [row.currency, row]));
    const stale = QUOTED_CURRENCIES.some((currency) => {
      const row = byCurrency.get(currency);
      if (!row) return true;
      if (row.source === 'manual') return false;
      return now - row.fetchedAt.getTime() > STALE_AFTER_MS;
    });

    return {
      rates: [...rows]
        .sort(
          (left, right) =>
            QUOTED_CURRENCIES.indexOf(left.currency as FinanceFxCurrency) -
            QUOTED_CURRENCIES.indexOf(right.currency as FinanceFxCurrency),
        )
        .map(toContract),
      stale,
    };
  }

  private async fetchNbrb(): Promise<ParsedRate[]> {
    const url = process.env.NBRB_API_URL ?? NBRB_URL;
    let response: Response;

    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException({
        code: 'NBRB_UNAVAILABLE',
        message: 'Could not fetch NBRB rates',
      });
    }

    if (!response.ok) {
      throw new BadGatewayException({
        code: 'NBRB_UNAVAILABLE',
        message: `NBRB responded with ${response.status}`,
      });
    }

    return parseNbrbRates(await response.json());
  }
}
