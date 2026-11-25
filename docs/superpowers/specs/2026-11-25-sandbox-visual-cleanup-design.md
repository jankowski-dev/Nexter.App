# Sandbox visual timeline, report PDF and legacy cleanup

Date: 2026-11-25
Status: **approved by owner** (recommendations 1A + 2A accepted; the rest accepted as described)
Scope: Sandbox replay UX, token source, report artifacts, and removal of the old AI-trading/backtest modules. Paper-only; no real money, wallets, keys, signing or exchange execution.

## Intent

Make a historical replay explain itself: show the price path, every actionable decision, its reason and its result on one chart; make the report a compact PDF/JSON artifact instead of a long page and Markdown; use the owner's favorites token base for new sandbox tokens; move the read-only strategy guide into Settings; and remove the obsolete AI-trading and bot-backtest modules so the application reflects the sandbox-first direction.

## Decisions

1. **Replay timeline (1A).** The page shows an interactive per-token price chart with markers for buys, sells, rejected/expired intents and hindsight counterfactuals; clicking a marker shows its reason, price, fees and P&L. A separate "Все решения" control loads the full decision journal (hold/block/risk checks) by deterministically re-running the persisted replay snapshot on demand and caching the result in API memory. No live/real order is created and no report hash changes.
2. **Report artifacts (2 + 5).** The page no longer shows report hashes, snapshot ids, config/settings versions, seed or the six technical notes. They move into the report identity block in JSON and the PDF. The primary download is a detailed PDF; JSON remains available. Markdown export is removed.
3. **Report pagination and layout (4 + 6).** Trades, intents, counterfactuals and decisions show 20 rows with `Ещё`. The "По стратегиям" and "По токенам" tables are full-width stacked blocks with horizontal scrolling instead of a two-column split.
4. **Replay list and creation (7 + 8).** The whole replay card is clickable; the separate `Открыть` button is removed. `Новый прогон` becomes a drawer; the replay page shows the history list and a compact `Новый прогон` action.
5. **Chart first (9).** On a completed replay, the order is: header/subtitle → action chart → report summary/artifacts → metrics → strategies/tokens → journals.
6. **Favorites token source (3).** The default watchlist group is renamed to `Избранное` (UI + existing default row). New sandbox tokens may only be added from the default `Избранное` group, derived from the asset's chain and contract; a missing/unsupported contract blocks the add with a clear reason. Existing sandbox tokens used by Stage 3 are not removed or edited.
7. **Legacy removal (10).** Remove the AI-trading module, its contracts/API/UI/tab/settings routes and its dependent searches; remove the bot backtest module/API/UI/buttons/settings fields. Keep the manual paper-bot `Роботы` runner and its strategy registry, and keep the DeepSeek/AI settings used by notes/audio. Do **not** drop `ai_*` or `bot_backtest_runs` tables in this batch; they stay inert for a later approved destructive cleanup.
8. **Strategies (11).** Remove `Стратегии` from the Crypto tabs and add a read-only `Настройки → Стратегии` page using the existing strategy registry metadata. The registry itself remains for robot creation and sandbox decisions.

## Architecture

### Replay timeline API

- `SandboxReplayRepository` gains owner-scoped reads for the stored report plus gzip candle snapshot and detail/settings/paper.
- `SandboxReplayChartService` (sandbox module) exposes:
  - `getChart(userId, id)` → per-token evaluation-window candles + action markers. Actions come from `report.intentJournal`, enriched with trade P&L; counterfactuals are optional markers. The snapshot is decoded with `decodeReplaySnapshot` and filtered to `[fromTime, toTime]`.
  - `getDecisions(userId, id, query)` → a bounded page of decision events. It re-runs `runPaperFromCandles` using the persisted snapshot, frozen settings/paper and seed, maps events with a `decision`, and caches up to a small number of replays by `(id, reportHash)`.
- New authenticated routes:
  - `GET /api/v1/sandbox/replays/:id/chart`
  - `GET /api/v1/sandbox/replays/:id/decisions?limit=&offset=&tokenId=`
  - `GET /api/v1/sandbox/replays/:id/report.pdf`
- Contracts add chart/decision/identity/candidate schemas. The report response gains an `identity` object; existing report fields remain unchanged.
- The chart/decisions endpoints are read-only and never persist derived artifacts.

### PDF

- `SandboxReplayPdfService` uses the existing `pdfmake` + Roboto stack from the backtest report service.
- Contents: dark header, replay identity, summary metrics, equity SVG, per-strategy and per-token tables, every trade, every intent, every counterfactual, technical notes/hashes, page numbers.
- The controller sets `application/pdf` and a filename only after a successful report read; errors stay JSON.

### Favorites token source

- A data migration renames the existing default group `Основная` → `Избранное` when no name conflict exists; `ensureDefaultGroup` creates `Избранное`.
- `GET /api/v1/sandbox/tokens/candidates` returns default-group assets with derived `chain:contract` keys, plus `eligible`/`reason` for unsupported chains or missing contracts.
- `POST /api/v1/sandbox/tokens` resolves the candidate again server-side and uses its chain/contract/symbol/name; arbitrary keys are rejected with `SANDBOX_TOKEN_NOT_IN_FAVORITES` / `SANDBOX_TOKEN_NOT_ELIGIBLE`. Existing rows remain valid.
- The token drawer replaces the free-form key/chain form with a candidate select and an explicit disabled reason.

### Legacy removal boundaries

- Remove `apps/api/src/modules/ai-trading` and its registration; remove `packages/contracts/src/ai-trading.ts`; remove AI-trading web feature, API client functions/types, Crypto `ai` tab, and AI-specific error strings.
- Remove `apps/api/src/modules/trading-bots/backtest`, `backtest.controller.ts`, module providers/imports; remove web backtest panel/chart/utils, robot `Тестировать` buttons/drawers, `BotBacktest*` contracts/API helpers, and backtest default settings fields from the contract/UI/service (DB columns stay dormant).
- Keep `apps/api/src/modules/ai` (DeepSeek), `ai_settings`, notes/audio AI, `trading-bots` runner, `bot_*` tables, and all current manual robot controls.
- Do not drop legacy DB tables or columns; a future ADR/backup can remove them.

## Non-goals

- No real-money execution, wallet, key, signing or swap path.
- No change to sandbox decision/risk rules, Stage 3 runs or historical report hashes.
- No arbitrary-date replay window; still 30/90/180 days.
- No DB drop of `ai_*`/`bot_backtest_runs` in this batch.
- No third-party analytics.

## Testing and rollout

- Unit/contracts: chart/decision schemas, title/date helpers, token candidate derivation, no-AI/no-backtest import boundaries.
- API: chart/decisions route auth and data, PDF magic/identity, candidate validation, token creation rejection, default-group rename.
- Web: chart marker selection/one-token and empty states, report pagination, clickable card, drawer creation, settings strategy page, removed tabs.
- Bot/e2e: existing sandbox replay tests updated; no DB drop.
- Full `format:check`, lint, typecheck, test, build; CI includes DB e2e.
- Production rollout is a separate owner approval: backup/restore, migration for the group rename, API deploy, then UI verification. Stage 3 runs must remain `running`.
