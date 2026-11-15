import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  DataQualityCheck,
  DataQualityReport,
  DataQualitySample,
  DataQualitySection,
  DataQualitySeverity,
} from '@nexter/contracts';
import { type Database } from '@nexter/db';
import { DB } from '../../shared/db/db.module';

interface SampleRow {
  label: string;
  href: string | null;
  total: number;
}

@Injectable()
export class DataQualityService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async report(userId: string): Promise<DataQualityReport> {
    const sections: DataQualitySection[] = [
      {
        key: 'ledger',
        label: 'Учёт',
        checks: await Promise.all([
          this.check(
            'negative_balances',
            'Отрицательные балансы кошельков',
            'error',
            'Проверьте операции по этим активам.',
            sql`
              select acc.name || ': ' || a.symbol || ' ' || sum(p.amount)::text as label,
                     '/portfolio' as href,
                     count(*) over()::int as total
              from postings p
              join accounts acc on acc.id = p.account_id
              join assets a on a.id = p.asset_id
              where acc.user_id = ${userId} and acc.type = 'wallet'
              group by acc.id, acc.name, a.id, a.symbol
              having sum(p.amount) < 0
              limit 5
            `,
          ),
          this.check(
            'unbalanced_assets',
            'Несбалансированные проводки',
            'error',
            'Сумма проводок по активу должна быть нулевой.',
            sql`
              select a.symbol || ': ' || sum(p.amount)::text as label,
                     '/operations' as href,
                     count(*) over()::int as total
              from postings p
              join accounts acc on acc.id = p.account_id
              join assets a on a.id = p.asset_id
              where acc.user_id = ${userId}
              group by a.id, a.symbol
              having sum(p.amount) <> 0
              limit 5
            `,
          ),
          this.check(
            'transactions_without_postings',
            'Операции без проводок',
            'error',
            'Операция должна содержать хотя бы одну проводку.',
            sql`
              select t.type || ' · ' || to_char(t.occurred_at, 'DD.MM.YYYY') as label,
                     '/operations' as href,
                     count(*) over()::int as total
              from transactions t
              where t.user_id = ${userId}
                and not exists (select 1 from postings p where p.transaction_id = t.id)
              order by t.occurred_at desc
              limit 5
            `,
          ),
          this.check(
            'wallet_vs_lots',
            'Баланс кошелька не совпадает с лотами',
            'error',
            'Для не-кэш активов остаток лотов должен совпадать с балансом.',
            sql`
              with bal as (
                select p.asset_id, sum(p.amount) as amount
                from postings p
                join accounts acc on acc.id = p.account_id
                where acc.user_id = ${userId} and acc.type = 'wallet'
                group by p.asset_id
              ), rem as (
                select asset_id, sum(remaining_amount) as remaining
                from lots
                where user_id = ${userId}
                group by asset_id
              ), diffs as (
                select a.id, a.symbol, coalesce(b.amount, 0) as balance,
                       coalesce(r.remaining, 0) as lots,
                       coalesce(b.amount, 0) - coalesce(r.remaining, 0) as delta
                from assets a
                left join bal b on b.asset_id = a.id
                left join rem r on r.asset_id = a.id
                where a.is_cash_equivalent = false
                  and abs(coalesce(b.amount, 0) - coalesce(r.remaining, 0)) > 0.000000000001
              )
              select symbol || ' · баланс ' || balance::text || ' / лоты ' || lots::text as label,
                     '/portfolio' as href,
                     count(*) over()::int as total
              from diffs
              limit 5
            `,
          ),
        ]),
      },
      {
        key: 'fifo',
        label: 'Ордера и лоты',
        checks: await Promise.all([
          this.check(
            'group_without_lots',
            'Ордера без лотов',
            'error',
            'Проверьте импорт или ручную операцию.',
            sql`
              select a.symbol || ' · ордер от ' || to_char(g.opened_at, 'DD.MM.YYYY') as label,
                     '/trades/' || g.id as href,
                     count(*) over()::int as total
              from trade_groups g
              join assets a on a.id = g.asset_id
              where g.user_id = ${userId}
                and not exists (select 1 from lots l where l.trade_group_id = g.id)
              order by g.opened_at desc
              limit 5
            `,
          ),
          this.check(
            'lot_without_group',
            'Лоты без ордера',
            'error',
            'Не-кэш лот должен принадлежать ордеру.',
            sql`
              select a.symbol || ' · ' || l.amount::text as label,
                     '/portfolio' as href,
                     count(*) over()::int as total
              from lots l
              join assets a on a.id = l.asset_id
              left join trade_groups g on g.id = l.trade_group_id
              where l.user_id = ${userId}
                and a.is_cash_equivalent = false
                and (l.trade_group_id is null or g.id is null)
              limit 5
            `,
          ),
          this.check(
            'lot_integrity',
            'Некорректные остатки лотов',
            'error',
            'Остаток должен быть от нуля до исходного количества.',
            sql`
              select a.symbol || ' · остаток ' || l.remaining_amount::text ||
                     ' из ' || l.amount::text as label,
                     '/portfolio' as href,
                     count(*) over()::int as total
              from lots l
              join assets a on a.id = l.asset_id
              where l.user_id = ${userId}
                and (l.remaining_amount < 0
                  or l.remaining_amount > l.amount
                  or l.remaining_cost_basis_usd < 0)
              limit 5
            `,
          ),
          this.check(
            'group_status_drift',
            'Статус ордера расходится с лотами',
            'warning',
            'Статус должен быть open/partial/closed по остаткам лотов.',
            sql`
              with derived as (
                select g.id, g.status, a.symbol,
                       coalesce(sum(l.amount), 0) as total,
                       coalesce(sum(l.remaining_amount), 0) as remaining
                from trade_groups g
                join assets a on a.id = g.asset_id
                left join lots l on l.trade_group_id = g.id
                where g.user_id = ${userId} and g.status in ('open', 'partial', 'closed')
                group by g.id, g.status, a.symbol
              )
              select symbol || ' · ' || status || ' → ' ||
                     case
                       when remaining = 0 then 'closed'
                       when remaining < total then 'partial'
                       else 'open'
                     end as label,
                     '/trades/' || id as href,
                     count(*) over()::int as total
              from derived
              where status <> case
                when remaining = 0 then 'closed'
                when remaining < total then 'partial'
                else 'open'
              end
              limit 5
            `,
          ),
        ]),
      },
      {
        key: 'swaps',
        label: 'Свопы',
        checks: await Promise.all([
          this.check(
            'confirmed_unaccounted',
            'Подтверждённые свопы без учётной операции',
            'error',
            'Swap tracker должен повторить проводку.',
            sql`
              select o.chain || ' · ' || o.token_in_symbol || ' → ' || o.token_out_symbol ||
                     ' · ' || to_char(o.confirmed_at, 'DD.MM.YYYY HH24:MI') as label,
                     '/portfolio' as href,
                     count(*) over()::int as total
              from swap_orders o
              where o.user_id = ${userId}
                and o.status = 'CONFIRMED'
                and o.accounting_transaction_id is null
              order by o.confirmed_at desc
              limit 5
            `,
          ),
          this.check(
            'stuck_swaps',
            'Зависшие свопы',
            'warning',
            'Проверьте подпись, deadline или статус в сети.',
            sql`
              select o.chain || ' · ' || o.token_in_symbol || ' → ' || o.token_out_symbol ||
                     ' · ' || o.status as label,
                     '/portfolio' as href,
                     count(*) over()::int as total
              from swap_orders o
              where o.user_id = ${userId}
                and (
                  (o.status in ('SUBMITTED', 'PENDING') and o.updated_at < now() - interval '1 hour')
                  or (o.status = 'AWAITING_SIGNATURE' and o.updated_at < now() - interval '2 hours')
                  or (o.status in ('BUILT', 'APPROVAL_REQUIRED', 'READY')
                      and o.deadline is not null and to_timestamp(o.deadline) < now())
                )
              limit 5
            `,
          ),
          this.check(
            'swap_accounting_errors',
            'Ошибки учёта свопов',
            'error',
            'Проверьте swap_events и accounting errors.',
            sql`
              select o.token_in_symbol || ' → ' || o.token_out_symbol ||
                     ' · ' || e.value as label,
                     '/portfolio' as href,
                     count(*) over()::int as total
              from swap_orders o
              cross join lateral jsonb_array_elements_text(o.errors) e(value)
              where o.user_id = ${userId}
                and (e.value like 'SWAP_ACCOUNTING_%' or e.value = 'SWAP_TX_NOT_FOUND')
              limit 5
            `,
          ),
        ]),
      },
      {
        key: 'market',
        label: 'Рынок',
        checks: await Promise.all([
          this.check(
            'missing_quotes',
            'Активы без котировки',
            'warning',
            'Проверьте источник или добавьте ручную цену.',
            sql`
              select a.symbol || ' · ' || ch.code as label,
                     '/watchlist' as href,
                     count(*) over()::int as total
              from assets a
              join chains ch on ch.id = a.chain_id
              left join market_quotes q on q.asset_id = a.id
              where q.asset_id is null
              limit 5
            `,
          ),
          this.check(
            'stale_quotes',
            'Устаревшие котировки',
            'warning',
            'Котировка старше 15 минут или цена не положительная.',
            sql`
              select a.symbol || ' · ' || coalesce(q.source, '—') || ' · ' ||
                     to_char(q.fetched_at, 'DD.MM.YYYY HH24:MI') as label,
                     '/watchlist' as href,
                     count(*) over()::int as total
              from market_quotes q
              join assets a on a.id = q.asset_id
              where q.fetched_at < now() - interval '15 minutes' or q.price_usd <= 0
              limit 5
            `,
          ),
        ]),
      },
      {
        key: 'bots',
        label: 'Роботы',
        checks: await Promise.all([
          this.check(
            'stale_bots',
            'Роботы без свежего тика',
            'warning',
            'Проверьте, что runner включён и не падает.',
            sql`
              select b.name || ' · последний тик ' ||
                     coalesce(to_char(b.last_tick_at, 'DD.MM.YYYY HH24:MI'), 'нет') as label,
                     '/testing' as href,
                     count(*) over()::int as total
              from trading_bots b
              where b.user_id = ${userId}
                and b.status = 'running'
                and b.archived_at is null
                and (b.last_tick_at is null or b.last_tick_at < now() - interval '10 minutes')
              limit 5
            `,
          ),
          this.check(
            'orphan_bot_positions',
            'Позиции роботов без токена в списке',
            'info',
            'Ожидаемо после удаления токена: runner управляет только выходом.',
            sql`
              select b.name || ' · ' || a.symbol as label,
                     '/testing' as href,
                     count(*) over()::int as total
              from bot_positions p
              join trading_bots b on b.id = p.bot_id
              join assets a on a.id = p.asset_id
              where b.user_id = ${userId}
                and not exists (
                  select 1 from bot_tokens t
                  where t.bot_id = b.id and t.asset_id = p.asset_id
                )
              limit 5
            `,
          ),
          this.check(
            'bot_negative_cash',
            'Отрицательный кэш робота',
            'error',
            'Проверьте бумажные сделки и сброс состояния.',
            sql`
              select b.name || ' · ' || b.cash_usd::text as label,
                     '/testing' as href,
                     count(*) over()::int as total
              from trading_bots b
              where b.user_id = ${userId} and b.cash_usd < 0
              limit 5
            `,
          ),
        ]),
      },
      {
        key: 'onchain',
        label: 'Сеть',
        checks: await Promise.all([
          this.check(
            'reconciliation_mismatches',
            'Расхождения последней сверки',
            'warning',
            'Проверьте позиции и ончейн-балансы.',
            sql`
              with latest as (
                select id from reconciliation_runs
                where user_id = ${userId}
                order by started_at desc
                limit 1
              )
              select i.symbol || ' · ' || i.status as label,
                     '/settings/system' as href,
                     count(*) over()::int as total
              from reconciliation_items i
              join latest on latest.id = i.run_id
              where i.status in ('MISMATCH', 'MISSING_ONCHAIN', 'MISSING_LEDGER')
              limit 5
            `,
          ),
        ]),
      },
      {
        key: 'imports',
        label: 'Импорт',
        checks: await Promise.all([
          this.check(
            'stale_import_previews',
            'Старые предпросмотры импорта',
            'info',
            'Предпросмотр старше 24 часов можно удалить.',
            sql`
              select 'Notion · ' || coalesce(i.file_name, 'без файла') || ' · ' ||
                     to_char(i.created_at, 'DD.MM.YYYY') as label,
                     '/import' as href,
                     count(*) over()::int as total
              from imports i
              where i.user_id = ${userId}
                and i.status = 'preview'
                and i.created_at < now() - interval '24 hours'
              limit 5
            `,
          ),
        ]),
      },
      {
        key: 'metadata',
        label: 'Метаданные',
        checks: await Promise.all([
          this.check(
            'unverified_assets',
            'Непроверенные активы',
            'info',
            'Проверьте контракт и сеть перед торговлей.',
            sql`
              select symbol || ' · ' || name as label,
                     '/watchlist' as href,
                     count(*) over()::int as total
              from assets
              where is_verified = false
              limit 5
            `,
          ),
          this.check(
            'missing_gas',
            'Операции без сетевого сбора',
            'info',
            'Для ончейн-операций желательно указать gas.',
            sql`
              select type || ' · ' || to_char(occurred_at, 'DD.MM.YYYY') as label,
                     '/operations' as href,
                     count(*) over()::int as total
              from transactions
              where user_id = ${userId}
                and occurred_at > now() - interval '30 days'
                and (data_quality->>'networkFeeIncluded')::boolean is false
              limit 5
            `,
          ),
          this.check(
            'unreconciled',
            'Операции без ончейн-сверки',
            'info',
            'Ручные операции не обязаны быть сверены.',
            sql`
              select type || ' · ' || to_char(occurred_at, 'DD.MM.YYYY') as label,
                     '/operations' as href,
                     count(*) over()::int as total
              from transactions
              where user_id = ${userId}
                and occurred_at > now() - interval '30 days'
                and (data_quality->>'reconciled')::boolean is false
              limit 5
            `,
          ),
        ]),
      },
    ];

    const summary = { errors: 0, warnings: 0, info: 0, healthy: true };
    for (const section of sections) {
      for (const check of section.checks) {
        if (check.severity === 'error') summary.errors += check.count;
        else if (check.severity === 'warning') summary.warnings += check.count;
        else summary.info += check.count;
      }
    }
    summary.healthy = summary.errors === 0;

    return {
      generatedAt: new Date().toISOString(),
      summary,
      sections,
    };
  }

  private async check(
    code: string,
    label: string,
    severity: DataQualitySeverity,
    hint: string,
    query: SQL,
  ): Promise<DataQualityCheck> {
    const result = await this.db.execute(query);
    const rows = result.rows as unknown as SampleRow[];
    const samples: DataQualitySample[] = rows.map((row) => ({
      label: row.label,
      href: row.href,
    }));

    return {
      code,
      label,
      severity,
      count: rows[0]?.total ?? 0,
      hint,
      samples,
    };
  }
}
