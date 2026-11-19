# AI Trading — схема БД и контракты (v0.2, recommendation-only)

Статус: Phase 1–3 реализованы; v0.2 отражает переход к рекомендациям и short-swing поиску.
Связанные документы:

- `docs/adr/0072-recommendation-only-short-swing.md` — актуальная архитектура.
- `docs/plans/ai-trading-2026-11.md` — продукт и этапы.

## 1. Принципы

- `ai_profiles` — настройки; пока один профиль, схема допускает несколько.
- `ai_pipeline_runs` — запуск анализа/поиска; статус и summary.
- `ai_jobs` — durable-очередь для тяжёлых задач (поиск, бэктест).
- `ai_artifacts` — версионированные результаты: analysis, search, backtest, recommendation payload.
- `ai_candidates` — кандидаты и рекомендации; статус и metrics.
- `market_candles` — OHLCV по токену/таймфрейму.
- `trading_bots` с `origin='ai'` — paper-боты, созданные владельцем из рекомендации.
- Все денежные значения — `numeric`, в API — decimal strings.
- Нет ключей/seed/signing keys, нет авто-создания роботов.

## 2. Таблицы

### 2.1 `ai_profiles`

| Колонка                     | Тип           | Примечание                             |
| --------------------------- | ------------- | -------------------------------------- |
| `id`                        | uuid PK       |                                        |
| `user_id`                   | uuid FK users | owner                                  |
| `name`                      | text          | `AI Trading`                           |
| `enabled`                   | boolean       | профиль включён                        |
| `budget_usd`                | numeric(24,8) | виртуальный бюджет                     |
| `cash_usd`                  | numeric(24,8) | свободный кэш                          |
| `reserved_usd`              | numeric(24,8) | зарезервировано                        |
| `max_workers`               | int           | cap active AI bots (10)                |
| `max_worker_allocation_pct` | int           | 25                                     |
| `max_token_exposure_pct`    | int           | 20                                     |
| `max_invested_pct`          | int           | 80                                     |
| `risk_per_trade_pct`        | numeric       | 1                                      |
| `daily_loss_limit_pct`      | numeric       | 3                                      |
| `max_drawdown_pct`          | numeric       | 10                                     |
| `max_ai_spend_usd`          | numeric       | 5                                      |
| `max_backtests_per_day`     | int           | 200 persisted runs                     |
| `worker_max_tokens`         | int           | 5                                      |
| `model_settings`            | jsonb         | model, temperature, maxTokens, timeout |
| `schedule`                  | jsonb         | search/review schedule; no auto-start  |
| `created_at`, `updated_at`  | timestamptz   |                                        |

`auto_approve_*` columns removed by migration `0050`.

### 2.2 `ai_profile_tokens`

As before: `profile_id`, `asset_id`, `timeframes[]`, `priority`, `max_allocation_pct`, `enabled`. The AI universe is separate from the default watchlist group.

### 2.3 `ai_service_configs`

Data/Analyst/Backtest/Risk/Reporter configuration; kept. `backtest` config will hold the 5,000-evaluation budget and fold settings when search is implemented.

### 2.4 `ai_pipeline_runs`

- `id`, `profile_id`, `trigger`, `status` (`queued`/`running`/`succeeded`/`failed`/`cancelled`), `started_at`, `finished_at`, `summary` jsonb, `created_at`.
- A Search Run stores `summary` with token/timeframe/period/folds/variants/statistics.

### 2.5 `ai_jobs`

- durable queue for search/backtest jobs; `payload`, `status`, `attempts`, `run_at`, `locked_by`, `heartbeat_at`, `idempotency_key`.
- Jobs never create or start bots.

### 2.6 `ai_artifacts`

- `type`: `analysis`, `search`, `backtest`, `recommendation`.
- Search artifact payload: config, counts, distribution, top-N, rejection reasons, final holdout.
- Versioned; hash.

### 2.7 `ai_candidates`

| Колонка                     | Тип           | Примечание                                                        |
| --------------------------- | ------------- | ----------------------------------------------------------------- |
| `id`                        | uuid PK       |                                                                   |
| `profile_id`                | uuid FK       |                                                                   |
| `run_id`                    | uuid          | search/analysis run                                               |
| `asset_id`                  | uuid FK       |                                                                   |
| `timeframe`                 | text          | `1h`/`4h`/`1d`/`15m`                                              |
| `strategy_key`              | text          | registry                                                          |
| `params`                    | jsonb         | validated                                                         |
| `ai_score`, `ai_confidence` | numeric       | model ranking                                                     |
| `ai_rationale`              | text          | why                                                               |
| `metrics`                   | jsonb         | OOS, folds, holdout, invalidation, TTL, allocation                |
| `policy_score`              | numeric       |                                                                   |
| `status`                    | text          | `proposed`/`recommended`/`accepted`/`rejected`/`expired`/`closed` |
| `worker_id`                 | uuid nullable | created bot id (repurposed `worker_id`)                           |
| `created_at`, `updated_at`  | timestamptz   |                                                                   |

Index `(profile_id, status)`, `(asset_id, timeframe)`.

### 2.8 `ai_reports`, `ai_usage`, `market_candles`

- `ai_reports` — daily/weekly research/recommendation reports.
- `ai_usage` — DeepSeek tokens/cost/latency.
- `market_candles` — OHLCV; short-swing uses 1h/4h/1d, 15m optional.

### 2.9 Removed tables/columns

Dropped by `0050`:

- `automation_rules`, `automation_rule_state`, `automation_runs`;
- `ai_approvals`;
- `ai_profiles.auto_approve_*`;
- settings `automation_enabled`, `automation_mode`, `automation_max_order_usd`, `automation_max_daily_usd`, `automation_max_actions_per_day`, `automation_cooldown_minutes`, `automation_default_trailing_pct`, `automation_default_buy_drop_pct`.

Three settings values remain for per-order defaults and are exposed as `tradeDefaultStopLossPct`, `tradeDefaultTakeProfitPct`, `tradeDefaultBuyAmountUsd` (DB column names remain legacy for one release).

## 3. Search / recommendation contracts (target v0.2)

```ts
type AiSearchRequest = {
  assetId: string;
  timeframe: '1h' | '4h' | '1d' | '15m';
  horizonDays: 1 | 3 | 5 | 10;
  variants: number; // max 5000
  trainDays: 60;
  purgeDays: 2;
  oosDays: 10;
  holdoutDays: 30;
};

type AiSearchStats = {
  total: number;
  valid: number;
  rejected: number;
  best: string;
  average: string;
  median: string;
  worst: string;
  profitablePct: string;
  oosBest: string;
  oosMedian: string;
  oosWorst: string;
  stability: string;
  holdout: string;
};
```

A recommendation is a candidate with:

- `expiresAt`;
- `invalidationRules` (price/regime/time/data/drawdown);
- `suggestedAllocationUsd`;
- `expectedHorizonDays`;
- `searchRunId`.

## 4. API (target)

Existing:

- `GET/PUT /api/v1/ai-trading/profile`
- `GET/POST/PATCH/DELETE /api/v1/ai-trading/profile/tokens`
- `GET/PUT /api/v1/ai-trading/services`
- `GET /api/v1/ai-trading/dashboard`
- `GET /api/v1/ai-trading/coverage`
- `POST /api/v1/ai-trading/data/refresh`
- `GET /api/v1/ai-trading/lab`
- `POST /api/v1/ai-trading/lab/analyze`
- `POST /api/v1/ai-trading/lab/backtest`

New (Phase 4):

- `POST /api/v1/ai-trading/search` — start asynchronous search.
- `GET /api/v1/ai-trading/search/:runId` — status/progress/stats.
- `GET /api/v1/ai-trading/search/:runId/results` — top variants + distribution.
- `POST /api/v1/ai-trading/search/:runId/cancel`.
- `GET /api/v1/ai-trading/recommendations`.
- `POST /api/v1/ai-trading/recommendations/:candidateId/accept` — opens/prefills draft bot, does not start.
- `POST /api/v1/ai-trading/recommendations/:candidateId/reject`.
- `GET /api/v1/ai-trading/recommendations/:candidateId` — card + invalidation.
- `GET /api/v1/ai-trading/ai-bots` — active/recommended bots with invalidation status.

No approvals endpoints.

## 5. Migration plan

- `0050` (destructive, backup required): drop abandoned automation/approval tables and columns; keep three per-order defaults under new API names.
- No new tables required for the first Search Run; use `ai_pipeline_runs`/`ai_artifacts`/`ai_candidates`.
- If recommendation TTL/status needs dedicated columns later, add an additive migration; do not repurpose deprecated tables.
- Update `provision-app-role.mjs` in the same release as `0050`.

## 6. Review criteria

- No autonomous bot creation/start/stop path.
- No approvals/auto-approve code or schema.
- Search stats are persisted and reproducible.
- Recommendation → manual draft bot link is auditable.
- All money values are numeric/decimal; no secrets/keys.
- Migration is backed up, tested on a copy, and rollback is documented.
