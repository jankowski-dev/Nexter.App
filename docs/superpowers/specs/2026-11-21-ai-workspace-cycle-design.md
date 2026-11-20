# AI workspace and one-click research cycle — design

Date: 2026-11-21. Status: awaiting owner approval.

## Intent

Replace the nine-tab AI trading page with one compact workspace and add a one-click research cycle:

1. load/refresh data;
2. run mass search;
3. persist recommendations;
4. create draft paper bots from top recommendations.

The owner starts every bot manually. The cycle never starts, stops or reallocates a bot.

## Why

- Current tabs (`Панель`, `Вселенная`, `Данные`, `Лаборатория`, `Поиск`, `Рекомендации`, `Мои ИИ-роботы`, `Сервисы`, `Настройки`) mix the old foundation with the recommendation-only flow.
- Four top stat cards repeat information already available below.
- The page blocks on dashboard/tokens/services queries, so one failed legacy service config makes the whole page look broken.
- The owner has to manually visit data → search → recommendations → bots, and cannot see where a failure happened.

## Goals

- One page: a compact status/toolbar, a live cycle card, recommendations and AI bot health side by side.
- Drawers for `Вселенная`, `Данные`, `Настройки`.
- Independent loading/error states per block; no whole-page failure because a secondary query failed.
- One `Запустить цикл` button with visible steps and stop-on-first-error.
- Full step logging in existing `ai_pipeline_runs` and `ai_jobs`, plus audit events.
- Auto-create up to N **draft** bots; never auto-start.

## Non-goals

- No auto-start/stop/reallocation of bots.
- No real trading, signing, keys or wallet changes.
- No new database table or migration in the first version.
- No all-universe 8 × 5,000 search in one click; the cycle runs for the selected token/timeframe.

## Approaches considered

### A. Single page + drawers (chosen)

One AI workspace, drawers for legacy management screens. Fast to scan, no tab-state/lag, matches “one page”.

### B. Compact tabs with lazy loading

Keep tabs but load each section independently and remove legacy tabs. Less work, but still context switching and the page remains fragmented.

### C. Wizard

Data → Search → Recommendations → Bots as a linear wizard. Good for the first run, bad for daily monitoring of recommendations and bot health.

## UI sketch

```text
ИИ-торговля                         [Профиль] [Настройки] [Вселенная] [Данные]

Токен [XRP v]  ТФ [1h v]  Горизонт [5d v]  Вариантов [5000 v]  [Запустить цикл]

Цикл #123 · выполняется · шаг 2/4
[✓ Данные 4320/4320] [→ Поиск 3120/5000] [ Рекомендации] [ Черновики]

┌─────────────── Рекомендации ───────────────┐ ┌──── ИИ-роботы ────┐
│ Активные 3 · Принятые 1 · Истёкшие 0        │ │ Норма 2 · Внимание 0│
│ XRP · 1h · momentum · OOS +12% · до 25.11  │ │ XRP draft ...        │
│ [Создать черновик]                          │ │ ...                  │
└─────────────────────────────────────────────┘ └──────────────────────┘
```

- Top stat cards removed.
- `Панель`, `Лаборатория`, `Сервисы` removed as tabs/sections.
- `Вселенная`, `Данные`, `Настройки` become drawers opened from the header.
- Recommendations and bots load independently; each shows its own retry.

## Cycle behavior

`POST /api/v1/ai-trading/cycle` with `{ assetId, timeframe, horizonDays, variants, maxDrafts }`.

1. **data** — refresh 180 days for the selected token/timeframe; fail if coverage < required after refresh.
2. **search** — start the existing async search; poll until terminal; fail on `failed`/`cancelled`.
3. **recommendations** — read top candidates, compute TTL/expiry; success with zero candidates is a warning, not a hard error.
4. **drafts** — create up to `maxDrafts` (default 3) prefilled `draft` bots from the best non-accepted recommendations, using the existing `TradingBotsService.createBot` with `aiCandidateId`; never start them.

Each step:

- creates/updates an `ai_jobs` row (`service='ai_cycle'`, `stage=<step>`, status/payload/error/timestamps);
- updates `ai_pipeline_runs.summary.steps` and `status`;
- writes audit `ai_trading.cycle_started`, `ai_trading.cycle_step_*`, `ai_trading.cycle_completed|failed`.

Stop at the first failed step. The UI shows the failed step, exact message and the step log; the next click starts a new cycle. No partial silent continuation.

Draft budget: `min(profile.budgetUsd, budgetUsd × maxWorkerAllocationPct / 100)`, minimum 100 USD; the owner can edit the draft before starting. If the token is not an active default-group watchlist entry, the drafts step fails with an explicit message instead of silently creating an unstartable bot.

## API

- `POST /ai-trading/cycle` → `{ cycleId }`.
- `GET /ai-trading/cycle/:cycleId` → status, steps, result counts, error.
- Reuse `ai_pipeline_runs`, `ai_jobs`, `ai_artifacts`, `ai_candidates`; no migration.
- Existing manual search/recommendation endpoints remain for advanced use.

## Frontend

- New `AiWorkspace` layout replaces the tabbed page.
- Queries: profile/tokens/recommendations/bot health load in parallel; coverage and services only inside their drawers or cycle.
- Cycle query polls only while `queued/running`.
- Legacy `LabSection`, `ServicesSection`, top stat cards and tab bar are deleted.
- Existing recommendation accept drawer and bot health cards are reused.

## Current audit (2026-11-21)

Done: data 180d/Binance fallback, deterministic 5,000-variant search, 8 OOS folds + holdout, stats/histogram/export, TTL, accept→draft, bot health monitor, search history.

Still open: reject endpoint, suggested allocation/invalidation metadata, 20 searches/day + idempotency, durable `ai_jobs` usage, Risk service limits/correlation, Reporter reports, hard invalidation signals (stop/take/regime/correlation), buy-and-hold/default comparison, train→OOS degradation, event-loop yielding during 5,000×8 backtests, stale-run recovery, lab/services legacy UI.

## Implementation phases

1. **Workspace UI** — one page, remove top cards and `Панель`/`Лаборатория`/`Сервисы`, move `Вселенная`/`Данные`/`Настройки` to drawers, independent query errors. No API change.
2. **Cycle backend** — `POST/GET /ai-trading/cycle`, reuse `ai_pipeline_runs`/`ai_jobs`, stop-on-first-error, audit per step, auto-create drafts only.
3. **Cycle UI** — toolbar + step progress + log; recommendations and bot health side by side; poll only while running.
4. **Hardening** — event-loop yielding/worker execution, idempotency and daily cap, stale-run recovery, reject endpoint, allocation/invalidation metadata.

## Risks

- DeepSeek/AI is not used for the search cycle; strategy search is deterministic. No AI latency in the critical path.
- Long data refresh can take 1–2 minutes; the cycle shows per-step progress and does not look frozen.
- Auto-draft creation changes ADR 0072 wording (“owner creates”); add ADR 0074 documenting auto-drafts/manual start.
- If a token has no 180-day history, the cycle fails at step 1 with a clear message and never creates a bot.
- The current search runs 5,000 × 8 backtests synchronously in the API process. Phase 4 must yield between variants or run in a worker; otherwise a cycle can make the whole UI feel laggy.
- `ai_jobs` is currently unused. The cycle will write one job per step and mark stale `running` cycles failed on startup, so a restart does not leave an eternal spinner.
- TTL currently equals the trading horizon (1–10 days), which leaves little review time; Phase 4 can add a review grace period without changing the search.
- Creating drafts does not reserve `ai_profiles.cash_usd`; treat the profile budget as a planning number until bots are started.

## Rollback

Redeploy the previous API/web image. Cycle rows in `ai_pipeline_runs`/`ai_jobs` are telemetry and may remain; no schema rollback.
