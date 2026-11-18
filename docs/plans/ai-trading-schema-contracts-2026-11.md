# AI Trading — схема БД и контракты сервисов (design v0.1)

Статус: на ревью, без миграций и кода.
Связанный ADR: `docs/adr/0071-ai-trading-control-center.md`.

## 1. Принципы

- `ai_profiles` — настройки; пока один профиль, схема допускает несколько.
- `ai_jobs` — durable-очередь; статусы, heartbeat, retry, idempotency.
- `ai_artifacts` — версионированные результаты стадий; большие данные не дублируются в JSON.
- `market_candles` — OHLCV по токену/таймфрейму; источник для анализа и бэктестов.
- Worker-боты — существующие `trading_bots` с `origin='ai'`; paper only.
- Все денежные значения — `numeric`, в API — decimal strings.
- Никаких ключей/seed/signing keys.

## 2. Таблицы

### 2.1 `ai_profiles`

| Колонка                      | Тип           | Примечание                             |
| ---------------------------- | ------------- | -------------------------------------- |
| `id`                         | uuid PK       |                                        |
| `user_id`                    | uuid FK users | owner                                  |
| `name`                       | text          | `AI Trading` по умолчанию              |
| `enabled`                    | boolean       | глобальный выключатель профиля         |
| `budget_usd`                 | numeric(24,8) | виртуальный бюджет                     |
| `cash_usd`                   | numeric(24,8) | свободный кэш                          |
| `reserved_usd`               | numeric(24,8) | зарезервировано под воркеров           |
| `max_workers`                | int           | 10 по умолчанию                        |
| `max_worker_allocation_pct`  | int           | 25                                     |
| `max_token_exposure_pct`     | int           | 20                                     |
| `max_invested_pct`           | int           | 80                                     |
| `risk_per_trade_pct`         | numeric       | 1                                      |
| `daily_loss_limit_pct`       | numeric       | 3                                      |
| `max_drawdown_pct`           | numeric       | 10                                     |
| `max_ai_spend_usd`           | numeric       | 5                                      |
| `max_backtests_per_day`      | int           | 200                                    |
| `worker_max_tokens`          | int           | 5 (фиксировано для MVP)                |
| `auto_approve_worker_create` | boolean       | paper                                  |
| `auto_approve_params`        | boolean       | paper                                  |
| `auto_approve_budget`        | boolean       | paper                                  |
| `auto_approve_pause_close`   | boolean       | paper                                  |
| `auto_approve_reoptimize`    | boolean       | paper                                  |
| `model_settings`             | jsonb         | model, temperature, maxTokens, timeout |
| `schedule`                   | jsonb         | weekly review, event triggers          |
| `created_at`, `updated_at`   | timestamptz   |                                        |

Constraints: `max_workers >= 1`, `worker_max_tokens = 5` (MVP), budget >= 0.

### 2.2 `ai_profile_tokens`

| Колонка                    | Тип                 | Примечание                       |
| -------------------------- | ------------------- | -------------------------------- |
| `id`                       | uuid PK             |                                  |
| `profile_id`               | uuid FK ai_profiles | cascade                          |
| `asset_id`                 | uuid FK assets      |                                  |
| `timeframes`               | text[]              | `1h`,`1d`; позже `4h`,`15m`,`5m` |
| `priority`                 | int                 | порядок обработки                |
| `max_allocation_pct`       | numeric             | опционально                      |
| `enabled`                  | boolean             |                                  |
| `created_at`, `updated_at` | timestamptz         |                                  |

Unique `(profile_id, asset_id)`. Отдельный AI-список, не группа `Основная`.

### 2.3 `ai_service_configs`

| Колонка       | Тип         | Примечание                                    |
| ------------- | ----------- | --------------------------------------------- |
| `id`          | uuid PK     |                                               |
| `profile_id`  | uuid FK     |                                               |
| `service`     | text        | `data`,`analyst`,`backtest`,`risk`,`reporter` |
| `enabled`     | boolean     |                                               |
| `config`      | jsonb       | параметры сервиса                             |
| `concurrency` | int         | 1–4                                           |
| `updated_at`  | timestamptz |                                               |

Unique `(profile_id, service)`.

### 2.4 `ai_pipeline_runs`

| Колонка                     | Тип         | Примечание                                          |
| --------------------------- | ----------- | --------------------------------------------------- |
| `id`                        | uuid PK     |                                                     |
| `profile_id`                | uuid FK     |                                                     |
| `trigger`                   | text        | `manual`,`schedule`,`event`                         |
| `status`                    | text        | `queued`,`running`,`succeeded`,`failed`,`cancelled` |
| `started_at`, `finished_at` | timestamptz |                                                     |
| `summary`                   | jsonb       | counts, errors, tokens                              |
| `created_at`                | timestamptz |                                                     |

Index `(profile_id, created_at)`.

### 2.5 `ai_jobs`

| Колонка                     | Тип                           | Примечание                                              |
| --------------------------- | ----------------------------- | ------------------------------------------------------- |
| `id`                        | uuid PK                       |                                                         |
| `profile_id`                | uuid FK                       |                                                         |
| `run_id`                    | uuid FK ai_pipeline_runs      |                                                         |
| `service`                   | text                          | data/analyst/backtest/risk/reporter                     |
| `stage`                     | text                          | fetch/analyze/optimize/allocate/report/worker_create    |
| `asset_id`                  | uuid FK assets nullable       |                                                         |
| `timeframe`                 | text nullable                 |                                                         |
| `status`                    | text                          | queued/running/succeeded/failed/retrying/cancelled/dead |
| `priority`                  | int                           |                                                         |
| `attempts`                  | int                           |                                                         |
| `max_attempts`              | int                           |                                                         |
| `run_at`                    | timestamptz                   |                                                         |
| `locked_by`                 | text                          | worker id                                               |
| `locked_at`, `heartbeat_at` | timestamptz                   |                                                         |
| `payload`                   | jsonb                         |                                                         |
| `artifact_id`               | uuid FK ai_artifacts nullable |                                                         |
| `error`                     | text                          | safe message/code                                       |
| `idempotency_key`           | text                          | unique                                                  |
| `created_at`, `updated_at`  | timestamptz                   |                                                         |

Indexes:

- `(status, run_at, priority)` for polling;
- `(run_id)`;
- `(profile_id, status)`;
- unique `(idempotency_key)`.

### 2.6 `ai_artifacts`

| Колонка      | Тип                  | Примечание                                         |
| ------------ | -------------------- | -------------------------------------------------- |
| `id`         | uuid PK              |                                                    |
| `profile_id` | uuid FK              |                                                    |
| `run_id`     | uuid FK              |                                                    |
| `job_id`     | uuid FK nullable     |                                                    |
| `type`       | text                 | dataset/analysis/backtest/allocation/report/ai_raw |
| `version`    | text                 | schema/prompt/registry version                     |
| `payload`    | jsonb                | small/medium results                               |
| `hash`       | text                 | content hash                                       |
| `created_at` | timestamptz          |                                                    |
| `expires_at` | timestamptz nullable | retention                                          |

Index `(run_id, type)`, `(hash)`.

### 2.7 `ai_candidates`

| Колонка                     | Тип                           | Примечание                                                    |
| --------------------------- | ----------------------------- | ------------------------------------------------------------- |
| `id`                        | uuid PK                       |                                                               |
| `profile_id`                | uuid FK                       |                                                               |
| `run_id`                    | uuid FK                       |                                                               |
| `asset_id`                  | uuid FK                       |                                                               |
| `timeframe`                 | text                          |                                                               |
| `strategy_key`              | text                          | registry key                                                  |
| `params`                    | jsonb                         | validated                                                     |
| `ai_score`, `ai_confidence` | numeric                       |                                                               |
| `ai_rationale`              | text                          |                                                               |
| `metrics`                   | jsonb                         | backtest metrics                                              |
| `policy_score`              | numeric                       |                                                               |
| `status`                    | text                          | proposed/backtested/approved/rejected/shadow/promoted/retired |
| `worker_id`                 | uuid FK trading_bots nullable |                                                               |
| `created_at`, `updated_at`  | timestamptz                   |                                                               |

Index `(profile_id, status)`, `(asset_id, timeframe)`.

### 2.8 `ai_approvals`

| Колонка                      | Тип                    | Примечание                                                                                    |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `id`                         | uuid PK                |                                                                                               |
| `profile_id`                 | uuid FK                |                                                                                               |
| `run_id`                     | uuid FK nullable       |                                                                                               |
| `type`                       | text                   | worker_create/worker_update/budget_reallocate/worker_pause/worker_close/reoptimize/real_order |
| `payload`                    | jsonb                  | action details, diff                                                                          |
| `status`                     | text                   | pending/approved/rejected/expired                                                             |
| `requested_at`, `decided_at` | timestamptz            |                                                                                               |
| `decided_by`                 | uuid FK users nullable |                                                                                               |
| `reason`                     | text                   |                                                                                               |

Index `(profile_id, status)`.

### 2.9 `ai_reports`

| Колонка                    | Тип         | Примечание   |
| -------------------------- | ----------- | ------------ |
| `id`                       | uuid PK     |              |
| `profile_id`               | uuid FK     |              |
| `type`                     | text        | daily/weekly |
| `period_from`, `period_to` | date        |              |
| `payload`                  | jsonb       |              |
| `created_at`               | timestamptz |              |

### 2.10 `ai_usage`

| Колонка                              | Тип              | Примечание    |
| ------------------------------------ | ---------------- | ------------- |
| `id`                                 | uuid PK          |               |
| `profile_id`                         | uuid FK          |               |
| `run_id`                             | uuid FK nullable |               |
| `provider`                           | text             | deepseek      |
| `model`                              | text             |               |
| `prompt_tokens`, `completion_tokens` | int              |               |
| `cost_usd`                           | numeric(18,8)    |               |
| `latency_ms`                         | int              |               |
| `purpose`                            | text             | analysis/test |
| `created_at`                         | timestamptz      |               |

### 2.11 `market_candles`

| Колонка                        | Тип                    | Примечание               |
| ------------------------------ | ---------------------- | ------------------------ |
| `id`                           | uuid PK                |                          |
| `asset_id`                     | uuid FK assets         |                          |
| `timeframe`                    | text                   | 1m/5m/15m/1h/4h/1d       |
| `open_time`                    | timestamptz            | UTC                      |
| `open`, `high`, `low`, `close` | numeric(36,18)         |                          |
| `volume_usd`                   | numeric(30,8) nullable |                          |
| `source`                       | text                   | geckoterminal/coingecko  |
| `quality`                      | text                   | ok/partial/synthetic/bad |
| `fetched_at`                   | timestamptz            |                          |

Unique `(asset_id, timeframe, open_time)`, index `(asset_id, timeframe, open_time)`.

### 2.12 `trading_bots` расширение

Добавить nullable/безопасные колонки:

- `origin text not null default 'manual'` (`manual`/`ai`);
- `ai_profile_id uuid` FK `ai_profiles` set null;
- `ai_candidate_id uuid` FK `ai_candidates` set null;
- `evaluation_timeframe text` nullable;
- `allocation_usd numeric(24,8)` nullable;
- `isolated_budget boolean not null default false`;
- `strategy_source text not null default 'manual'` (`manual`/`registry`).

Существующие `bot_tokens`, `bot_positions`, `bot_trades`, `bot_equity_snapshots`, `bot_signals`, `bot_events` переиспользуются. `origin` + `ai_profile_id` дают фильтр AI-воркеров.

### 2.13 Что не создаём

- отдельную `ai_workers` таблицу — используем `trading_bots`;
- отдельный paper-ledger — используем существующие `bot_*` и бюджеты ботов;
- `automation_*` — не используем;
- ключи/кошельки/подписи — не храним.

## 3. Жизненный цикл задачи

`queued → running → succeeded`
`queued → running → retrying → running → ... → dead`
`queued/running → cancelled`

- `heartbeat_at` обновляется каждые 15–30 с.
- Stale `running` (> 2 минут без heartbeat) возвращается в `queued` с увеличением attempts.
- `max_attempts` по умолчанию 3; ошибки 429/5xx/timeout — retry, invalid payload — dead.
- Отмена run-а переводит queued jobs в `cancelled`, running jobs получают сигнал отмены.

## 4. Контракты сервисов

### 4.1 Data

```ts
type DataJobPayload = {
  profileId: string;
  runId: string;
  assetId: string;
  timeframe: '1h' | '1d' | '4h' | '15m' | '5m';
  from: string; // ISO
  to: string; // ISO
};

type DatasetArtifact = {
  assetId: string;
  timeframe: string;
  source: 'geckoterminal' | 'coingecko';
  from: string;
  to: string;
  candles: number;
  coveragePct: string;
  gaps: number;
  synthetic: boolean;
  quality: 'ok' | 'partial' | 'bad';
};
```

Свечи лежат в `market_candles`, артефакт хранит метаданные и диапазон.

### 4.2 Analyst

```ts
type AnalysisJobPayload = { datasetArtifactId: string };

type AnalysisArtifact = {
  datasetArtifactId: string;
  assetId: string;
  timeframe: string;
  features: Record<string, string | number | null>;
  regime: 'trend_up' | 'trend_down' | 'range' | 'high_vol' | 'low_vol' | 'unknown';
  confidence: number;
  candidates: Array<{
    strategyKey: string;
    confidence: number;
    params: Record<string, unknown>;
    rationale: string;
    risks: string[];
  }>;
  warnings: string[];
};
```

AI output проверяется Zod; `strategyKey` — только из registry; параметры clamp.

### 4.3 Backtest

```ts
type BacktestJobPayload = {
  datasetArtifactId: string;
  candidates: AnalysisArtifact['candidates'];
  constraints: {
    minTrades: number;
    maxDrawdownPct: number;
    feeBps: number;
    slippageBps: number;
    folds: number;
  };
};

type BacktestArtifact = {
  datasetArtifactId: string;
  results: Array<{
    strategyKey: string;
    params: Record<string, unknown>;
    metrics: Record<string, string | number | null>;
    oosMetrics: Record<string, string | number | null>;
    score: number;
    accepted: boolean;
    reasons: string[];
  }>;
};
```

### 4.4 Risk / allocation

```ts
type AllocationJobPayload = {
  backtestArtifactId: string;
  budgetUsd: string;
  currentExposureUsd: string;
};

type AllocationArtifact = {
  selected: Array<{
    strategyKey: string;
    params: Record<string, unknown>;
    assetIds: string[];
    timeframe: string;
    allocationUsd: string;
    isolatedBudget: boolean;
    limits: Record<string, string | number>;
  }>;
  rejected: Array<{ strategyKey: string; reason: string }>;
};
```

### 4.5 Worker create

```ts
type WorkerCreatePayload = AllocationArtifact['selected'][number] & {
  profileId: string;
  runId: string;
  candidateId: string;
};
```

Создаёт `trading_bots` + `bot_tokens` + `bot_events` + audit. Идемпотентность по `candidateId`.

### 4.6 Reporter

```ts
type ReportJobPayload = {
  profileId: string;
  period: 'daily' | 'weekly';
  from: string;
  to: string;
};
```

## 5. API (future, design)

- `GET/PUT /api/v1/ai-trading/profile`
- `GET/POST/PATCH/DELETE /api/v1/ai-trading/profile/tokens`
- `GET/PUT /api/v1/ai-trading/services`
- `POST /api/v1/ai-trading/runs` (start), `GET /runs`, `GET /runs/:id`, `POST /runs/:id/cancel`
- `GET /api/v1/ai-trading/jobs`, `POST /jobs/:id/retry`
- `GET /api/v1/ai-trading/candidates`
- `GET /api/v1/ai-trading/approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject`
- `GET /api/v1/ai-trading/reports`, `GET /reports/:id`
- `POST /api/v1/ai-trading/kill`
- `GET /api/v1/ai-trading/workers` (или фильтр existing bots `origin=ai`)
- `GET /api/v1/ai-trading/system`

Все owner-only, CSRF, audit. Kill switch и approvals — аудит.

## 6. Индексы и ограничения

- `ai_jobs(status, run_at, priority)` — очередь.
- `ai_jobs(run_id)`, `ai_jobs(profile_id, status)`.
- `ai_jobs.idempotency_key` unique.
- `ai_artifacts(run_id, type)`, `ai_artifacts(hash)`.
- `ai_candidates(profile_id, status)`, `(asset_id, timeframe)`.
- `market_candles(asset_id, timeframe, open_time)` unique.
- `ai_profile_tokens(profile_id, asset_id)` unique.
- `ai_service_configs(profile_id, service)` unique.

## 7. Retention

- `market_candles`: хранить 2–3 года для 1d; intraday — 90–180 дней (настраиваемо).
- `ai_artifacts`: 180 дней, AI raw — 90 дней; большие — по политике.
- `ai_jobs`: 180 дней.
- `ai_usage`: 1 год.
- `ai_reports`: 1 год.
- Всё — additive; без удаления исторических worker-ов.

## 8. Миграция (future)

Одна аддитивная миграция `0049_ai_trading_core.sql`:

- `market_candles`;
- `ai_profiles`, `ai_profile_tokens`, `ai_service_configs`;
- `ai_pipeline_runs`, `ai_jobs`, `ai_artifacts`, `ai_candidates`, `ai_approvals`, `ai_reports`, `ai_usage`;
- `ALTER TABLE trading_bots ADD ...`;
- grants `nexter_app` SELECT/INSERT/UPDATE; DELETE только там, где нужно (tokens/approvals? по политике);
- backfill `trading_bots.origin='manual'`.

Перед production: ADR accepted, encrypted backup, restore check, migration on copy, `/ready`, grants check, rollback = previous image.

## 9. Границы

- Сейчас только paper/sandbox: реальные данные и математика, виртуальные деньги.
- Никаких кошельков, ключей, подписи, реального ledger.
- Real-mode — отдельный ADR/security review и внешний signer/HSM/AA; не реализуется в этой миграции.

## 10. Критерии ревью

- Схема покрывает profile/universe/services/jobs/artifacts/candidates/approvals/reports/usage.
- Идемпотентность и восстановление после рестарта.
- Нет дублирования paper-леджера.
- Все суммы — numeric/decimal.
- Нет ключей/секретов.
- Миграция аддитивная; grants проверены.
- UI может построить панель/пайплайн/воркеры/лабораторию/одобрения/отчёты без дополнительных таблиц.
