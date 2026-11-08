import { BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { settings as settingsTable, type Database } from '@nexter/db';

const DEFAULT_TIMEZONE = 'Europe/Minsk';
const MAX_RANGE_DAYS = 3_660;

export interface ResolvedReportPeriod {
  from: string | null;
  to: string | null;
  timezone: string;
  fromInstant: Date | null;
  toInstantExclusive: Date | null;
}

export function resolveTimezone(value: string | null | undefined): string {
  const candidate = value ?? DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function isValidDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function resolveReportPeriod(
  db: Database,
  userId: string,
  from?: string,
  to?: string,
): Promise<ResolvedReportPeriod> {
  const [settingsRow] = await db
    .select({ timezone: settingsTable.timezone })
    .from(settingsTable)
    .where(eq(settingsTable.userId, userId))
    .limit(1);
  const timezone = resolveTimezone(settingsRow?.timezone);

  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Invalid report date',
    });
  }

  if (from && to && from > to) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Report start date must not be after the end date',
    });
  }

  if (from && to) {
    const rangeDays =
      (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;

    if (rangeDays > MAX_RANGE_DAYS) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Report period is too long',
      });
    }
  }

  if (!from && !to) {
    return {
      from: null,
      to: null,
      timezone,
      fromInstant: null,
      toInstantExclusive: null,
    };
  }

  const timezoneLiteral = sql.raw(`'${timezone.replaceAll("'", "''")}'`);
  const result = await db.execute(sql`
    select
      (${from ?? null}::date at time zone ${timezoneLiteral}) as from_ts,
      ((${to ?? null}::date + interval '1 day') at time zone ${timezoneLiteral}) as to_ts
  `);
  const row = result.rows[0] as
    { from_ts: Date | string | null; to_ts: Date | string | null } | undefined;

  return {
    from: from ?? null,
    to: to ?? null,
    timezone,
    fromInstant: row?.from_ts ? new Date(row.from_ts) : null,
    toInstantExclusive: row?.to_ts ? new Date(row.to_ts) : null,
  };
}
