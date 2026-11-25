# UX batch — settings sections, Viber trade notifications, equity history, finance form

Date: 2026-11-25
Status: **approved in conversation** (owner confirmed A1 + B1)
Scope: Nexter.App web/API plus the external `Nexter.Bot` service for Viber delivery. Paper/real-money behavior is unchanged; no trading logic is touched.

## Intent

Close eight owner remarks from the wider product review in one coherent UX batch:

1. Turn the Settings hub blocks “Общие” and “Данные и экспорт” into full sections.
2. Notify about closed trades (manual and robots) with P&L, including Viber through `Nexter.Bot`;
   add a dedicated `ViberBot` settings section.
3. Show both the 12-month chart and a monthly income/expense table.
4. Replace the small attachment icon in notes and make attaching obvious.
5. Fix pinned notes being displaced by newer notes.
6. Add a capital-movement chart to `Крипта → Обзор`, cards on the right, ranges hours/days/months.
7. Make the dashboard top cards compact.
8. Redesign the add-expense/income/transfer form: one drawer, a three-way type switch,
   frequent-category quick picks, and type-specific fields.

## Decisions

- **Viber delivery (A1).** The API writes a durable outbox row (`viber_notifications`). The
  external `Nexter.Bot` polls `GET /api/v1/bot/notifications/pending`, sends through its existing
  Viber token and queue, then acknowledges each row. Secrets remain in the bot.
- **Hourly equity (B1).** Add `portfolio_equity_points`, compacted to one point per user/hour,
  captured by `PortfolioSnapshotService`. Days use the existing daily `portfolio_snapshots`;
  months aggregate the same daily snapshots. Hourly history starts at deploy time; the UI must
  say so and must not fabricate pre-deploy points.
- **Master switches.** In-app notification toggles remain the master controls
  (`notifyTradesClosed`, `notifyPositionsClosed`, `notifyBotStopped`). The Viber section adds
  channel toggles and frequency. If the master is off, no in-app notification and no Viber row
  is created.
- **Frequency.** `instant` sends each event as it is polled; `hourly` batches pending events and
  sends at the first poll of a new local hour; `daily` batches and sends once per local day after
  `viberDigestTime`. The bot uses the timezone returned by the API (the owner's settings timezone).
- **Trade-close scope.** Manual/on-chain full closes of a trade group and every bot sell (a bot
  position is fully closed on sell) plus close-all. Partial manual sells do not notify; they are
  not a closed trade. Sandbox Stage 3 runs are not included in this batch.
- **Settings sections.** `/settings/general` owns timezone, gas-in-cost and the read-only base
  currency/FIFO rules; `/settings/accounting` keeps the default report period and links to general.
  `/settings/export` owns CSV/JSON exports and the import link; `/settings/data` keeps accounts and
  import and links to export. The two duplicate hub cards are removed.
- **Finance form.** One create drawer with a three-way segmented switch. In edit mode the type is
  fixed and the switch is disabled. Frequent categories come from a read-only
  `GET /finance/categories/suggestions?kind=...&limit=5` endpoint, with active categories ordered
  by `sortOrder` as the fallback. Empty titles fall back to the category name or “Расход”/“Доход”.
- **Notes.** Client sorting must place pinned notes first, then the selected date sort. The pin
  action is also available in the drawer. The attachment action becomes a clear
  “Прикрепить файл” button with a proper 4×4 icon; the list indicator becomes a readable pill.
- **Chart layout.** `Крипта → Обзор` becomes a two-column block: capital chart left, four compact
  cards in a 2×2 grid on the right; token blocks stay below. `StatCard` gains a `compact` size used
  by the overview and the dashboard.

## Architecture

### Database (additive migration `0054`)

- `settings` gains:
  - `notify_trades_closed boolean not null default true`
  - `viber_notifications_enabled boolean not null default true`
  - `viber_trade_closed_enabled boolean not null default true`
  - `viber_bot_stopped_enabled boolean not null default true`
  - `viber_frequency text not null default 'instant'` with check `instant|hourly|daily`
  - `viber_digest_time text not null default '20:00'` with `HH:MM` check
- `viber_notifications`: `id`, `user_id`, `type`, `title`, `body`, `payload jsonb`, `status`
  (`pending|sent|failed`), `attempts`, `error`, `sent_at`, `created_at`, `updated_at`.
  Index `(user_id, status, created_at)`. `nexter_app`: SELECT/INSERT/UPDATE, no DELETE.
- `portfolio_equity_points`: `id`, `user_id`, `bucket_at` (start of UTC hour), `captured_at`,
  `cash_usd`, `positions_value_usd`, `equity_usd`, `created_at`; unique `(user_id, bucket_at)`.
  `nexter_app`: SELECT/INSERT/UPDATE, no DELETE.

### API

- `ViberOutboxService`: enqueue, pending, ack, owner status/list/test.
- `TradingNotificationsService`: one place that creates the in-app notification and Viber outbox
  row for manual close, bot sell, bot close-all and bot stop; formats signed USD/percent.
- `LedgerService.createManual` notifies after commit for a fully closed `sell`/`swap` group,
  using this transaction's `lot_consumptions` for the realized P&L and cost basis.
- `BotRunnerService` notifies after each sell; `TradingBotsService.closePositions` includes total
  realized P&L and percent; bot-stop calls go through the same service.
- Bot API: `GET /bot/notifications/pending`, `POST /bot/notifications/:id/ack`; both bearer-only,
  origin-exempt and timing-safe.
- Owner API: `GET /notifications/viber/status`, `GET /notifications/viber?limit=`,
  `POST /notifications/viber/test`.
- `PortfolioSnapshotService.capture` also upserts the current UTC hour point and audits it as
  `accounting.portfolio_equity_point`. `ReportingService.equitySeries(userId, range)` returns
  `hour|day|month`; no range uses the existing endpoint unchanged. Viber outbox enqueue/ack/test
  writes are audited (`viber.enqueued`, `viber.acknowledged`/`viber.failed`, `viber.test_queued`).
- `FinanceService.categorySuggestions` returns the five most-used active categories of a kind,
  filled from active categories by `sortOrder` when there is little history.

### Web

- Settings routes/pages: `general`, `export`, `viber`; update hub and existing pages to avoid
  duplicate editing.
- Portfolio: `PortfolioEquityChart` with range tabs and honest empty/collection notes.
- Finance: `FinanceOperationDialog` (one drawer) and `finance-category-suggestions` query.
- Notes: `sortNotes` helper and improved pin/attachment actions.
- Dashboard and portfolio cards: `StatCard size="compact"`.

### Bot

- Poll pending notifications on a short interval; respect `instant|hourly|daily`, batch
  hourly/daily, format Russian messages with P&L, ack sent/failed.
- Keep the existing task-reminder and audio-note paths unchanged.

## Non-goals

- No real money, wallets, keys, signing or exchange execution.
- No changes to paper-trading strategies, risk limits or Stage 3 runs.
- No arbitrary-date replay presets.
- No editable Viber token/user id in the web UI; secrets stay in the bot environment.
- No per-event quiet hours in this batch.

## Evidence and tests

- API unit/e2e: outbox enqueue/pending/ack, trade-close P&L, bot sell/close-all/stop, settings
  validation, bot auth, equity series, finance suggestions.
- Web unit/static render: note ordering, finance chart+table, operation type/title helpers,
  compact card, equity chart labels.
- Bot pytest: message formatting, frequency gating, pending/ack client.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`; CI on the PR.

## Rollout and rollback

- Additive migration; encrypted production backup + restore check before applying. Stage 3 runs
  are not stopped or edited.
- API/web deploy together; `Nexter.Bot` deploy separately after the API endpoint exists.
- Rollback: deploy the previous API/web image and bot commit; the new tables/columns are inert.
  Do not drop them during rollback.
- `VIBER_TOKEN` stays only on the bot. The API needs only the existing `BOT_API_TOKEN`.
