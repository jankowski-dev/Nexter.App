# AI Trading Control Center — техническая спецификация (v0.1)

Статус: проект, без реализации. Основано на решениях владельца от 2026-11-18.

Связанные документы:

- `docs/adr/0071-ai-trading-control-center.md` — архитектурное решение.
- `docs/plans/ai-trading-schema-contracts-2026-11.md` — схема БД и контракты сервисов.

## 1. Термины

- **Control Center** — раздел `ИИ-торговля`: приборная панель, настройки, сервисы, пайплайн, воркеры, одобрения, отчёты.
- **Orchestrator** — детерминированный сервис, который ведёт очередь задач и применяет правила. Не бот, не ИИ.
- **Profile** — набор настроек ИИ-торговли: вселенная, бюджет, риск, таймфреймы, approvals, модель.
- **Service** — жёстко запрограммированный обработчик задач: Data, Analyst, Backtest, Risk, Reporter.
- **WorkerBot** — paper-бот: одна стратегия, список токенов, один evaluation timeframe, бюджет.
- **Candidate** — стратегия + параметры + токен + таймфрейм, прошедшая анализ/бэктест.
- **Pipeline Run** — один запуск цепочки по профилю.
- **Job** — задача очереди для конкретного сервиса/токена/таймфрейма.
- **Artifact** — версионированный результат задачи (данные, признаки, AI-ответ, бэктест, аллокация).
- **Approval** — предложенное действие, ожидающее решения владельца.

## 2. Принятые решения

1. Отдельной сущности «Mainbot» нет. Есть Control Center и Orchestrator.
2. ИИ даёт анализ и оценку. Решение принимает policy engine по жёстким правилам. Сервисы исполняют.
3. Один worker = одна стратегия + список токенов.
4. Пока один профиль; схема и UI допускают несколько профилей позже.
5. Стартовые таймфреймы: `1h` и `1d`. Позже `4h`, `15m`, `5m`.
6. Общий виртуальный пул капитала; опционально изолированный бюджет worker-а.
7. Все действия в paper-режиме могут выполняться автоматически (переключатели в настройках). Каждое действие логируется и уведомляется.
8. Лимиты — по предложенной таблице (см. §9).
9. Ре-оптимизация: еженедельно + события; 1–2 shadow-кандидата.
10. Параметры сервисов — на усмотрение реализации, ключевые редактируются в UI.
11. Реальный режим — позже, отдельный проект. Хранение ключей на сервере противоречит правилу 1 проекта; требуется отдельный signer/HSM/AA и security review.
12. Максимум токенов у одного worker-а — **5**.
13. После `1h`/`1d` добавляем таймфреймы в порядке **`4h` → `15m` → `5m`**.
14. Текущий режим — **sandbox**: реальные рыночные данные и математика, виртуальные деньги. Реальные ордера, кошельки, ключи и подпись не используются. Будущий real-mode — только через внешний signer/HSM/AA, отдельным этапом.

## 3.1. Sandbox contract

- Цены, свечи, объёмы, ликвидность и комиссии — реальные/рыночные.
- Исполнение — paper: текущая котировка + slippage + fee; без реального ордера.
- Деньги, equity, P&L, DD — виртуальные; отдельный paper-леджер.
- Реальный ledger, кошельки, WalletConnect и подпись в AI-модуле не участвуют.
- Все расчёты — Decimal/Postgres numeric, без JS-float.
- Backtests — на реальной истории; forward — на реальных котировках.
- Никаких приватных ключей, seed-фраз и signing keys.
- Real-mode adapter и signer не реализуются в текущем этапе; только интерфейс `ExecutionAdapter` с `PaperAdapter`.

## 3. Архитектура

```
Пользователь
  → Control Center (settings, approvals, reports)
  → Orchestrator (policy + job graph)
      → Data Service
      → Analyst Service (AI)
      → Backtest Service
      → Risk Service
      → WorkerBot(s)
  ← Artifacts / Events / Reports
```

Правила:

- Сервисы не вызывают друг друга напрямую.
- Каждая стадия читает артефакт предыдущей и создаёт свой.
- Orchestrator управляет зависимостями, retry, cooldown и approvals.
- Один Profile может иметь несколько одновременных Pipeline Run, но активные воркеры ограничены.
- Все действия идемпотентны; повторный job не создаёт дубль.

## 4. Control Center (UI)

Раздел `ИИ-торговля` внутри Крипты. Вкладки/панели:

1. **Панель** — бюджет, свободный кэш, equity, P&L, DD, активные воркеры, очередь, ошибки, кнопки Start/Pause/Kill.
2. **Настройки** — профиль, AI-вселенная, таймфреймы, бюджет, риск, approvals, модель, расписание.
3. **Сервисы** — карточки Data/Analyst/Backtest/Risk/Reporter: статус, очередь, последний запуск, параметры, включить/выключить, логи.
4. **Пайплайн** — по токену/таймфрейму стадии, артефакты, ошибки, retry.
5. **Воркеры** — стратегия, токены, timeframe, allocation, equity, P&L, DD, статус, pause/stop.
6. **Лаборатория** — кандидаты, AI-оценка, метрики бэктеста, policy score, решение.
7. **Одобрения** — очередь действий с причиной и diff.
8. **Отчёты** — daily/weekly.
9. **Журнал** — решения, запуски, ошибки, стоимость ИИ.

## 5. Настройки профиля

- название, enabled;
- AI-вселенная: отдельный список токенов (не группа `Основная`);
- таймфреймы по токену: `1h`, `1d` (позже другие);
- бюджет, cash buffer;
- max workers, max allocation на worker, max exposure на токен, max invested;
- risk per trade, daily loss, max DD;
- max AI spend/day, max backtest candidates/day;
- auto-approve toggles: worker create, params change, budget reallocate, pause/close, reoptimize;
- модель ИИ: model, temperature, max tokens, timeout, fallback;
- расписание: weekly review, events;
- reporters: daily/weekly, in-app/Viber.

## 6. Сервисы

### Data Service

Вход: профиль, токен, timeframe, период.
Выход: `dataset` artifact.

- источник: GeckoTerminal / CoinGecko;
- OHLCV, coverage, gaps, duplicates, stale, synthetic;
- минимальная ликвидность;
- кэш и персистентность в `market_candles`;
- инкрементальное обновление;
- при недостатке данных — статус `unavailable`, pipeline останавливается для этой пары.

### Analyst Service (AI)

Вход: dataset artifact.
Выход: `analysis` artifact.

- признаки: trend, volatility, drawdown, volume, liquidity, regime, correlations;
- AI-запрос с структурированным профилем;
- выход JSON: regime, confidence, candidates[], warnings;
- стратегии только из реестра, параметры в допустимых диапазонах;
- fallback при ошибке;
- сохранение prompt/response/usage.

### Backtest Service

Вход: dataset + candidates + constraints.
Выход: `backtest` artifact.

- walk-forward: train/validation/test;
- OOS обязателен;
- комиссии/слиппедж;
- метрики: return, max DD, Sharpe/Sortino, profit factor, win rate, expectancy, turnover, stability;
- сравнение с buy-and-hold;
- top-N, score;
- отсев нестабильных/малосделочных кандидатов.

### Risk Service

Вход: выбранные кандидаты + бюджет + текущие экспозиции.
Выход: `allocation` artifact.

- размер allocation на worker;
- per-token cap;
- max workers/exposure;
- cash buffer;
- correlation;
- проверка лимитов;
- план создания worker-а или отклонение.

### Reporter Service

Вход: run/period.
Выход: `report` artifact.

- daily/weekly;
- equity, P&L, DD, trades, win rate, profit factor;
- benchmark;
- AI rationale;
- service health, errors, stale data;
- AI cost;
- approvals.

## 7. WorkerBot

- одна стратегия + params;
- список токенов, максимум 5;
- один evaluation timeframe;
- allocation;
- max positions, position size, fee/slippage;
- daily loss, max DD, cooldown;
- paper execution через существующий bot engine;
- signals/trades/equity/events;
- P&L по каждому токену и агрегированный;
- pause/stop без потери истории.

Signal timeframe определяет, когда стратегия принимает решение. Исполнение и equity обновляются по текущим котировкам. ИИ в тиках не участвует.

## 8. Данные

`market_candles`:

- `asset_id`, `timeframe`, `open_time`, `open`, `high`, `low`, `close`, `volume`;
- `source`, `quality`, `fetched_at`;
- unique `(asset_id, timeframe, open_time)`.

Таймфреймы MVP: `1h`, `1d`. Далее: `4h`, `15m`, `5m` (в этом порядке). Проверка покрытия обязательна. Для intraday — отдельная проверка лимитов провайдера.

## 9. Лимиты (подтверждены)

| Лимит                        | Значение                      |
| ---------------------------- | ----------------------------- |
| Общий бюджет                 | задаёт пользователь           |
| Max workers                  | 10                            |
| Max на worker                | 25% бюджета                   |
| Max на токен                 | 20%                           |
| Max invested                 | 80%                           |
| Risk per trade               | 1%                            |
| Daily loss: profile / worker | 3% / 5%                       |
| Max DD: profile / worker     | 10% / 15%                     |
| Max AI spend                 | $5/день                       |
| Max backtest candidates      | 200/день                      |
| Stale data                   | 2× timeframe, котировки 5 мин |
| Cooldown после убытка        | 1 час                         |
| Correlation threshold        | 0.8                           |
| Re-optimization cooldown     | 7 дней на токен               |

При breach — автоматическая пауза/закрытие и уведомление.

## 10. Капитал

- Общий виртуальный пул: `cash_usd`.
- Allocation worker-а — резервирование, а не безвозвратный перевод.
- Опционально `isolated_budget` — отдельный бюджет worker-а.
- Risk Service ведёт резервы и не даёт двум worker-ам потратить один кэш.
- Paper-леджер отдельный; реальный ledger не затрагивается.

## 11. Одобрения

В paper по умолчанию все действия auto (по решению владельца), но с уведомлением и audit.

| Действие                  | Paper         | Real (future)   |
| ------------------------- | ------------- | --------------- |
| Pipeline run              | auto          | auto            |
| Создание worker           | auto          | approval        |
| Смена параметров          | auto          | approval        |
| Перераспределение бюджета | auto          | approval        |
| Pause/close по риску      | auto + notify | auto + notify   |
| Pause/close вручную       | auto          | approval        |
| Ре-оптимизация            | auto          | approval        |
| Покупка/продажа           | paper only    | approval + TOTP |

Каждый auto-approve переключаем в настройках.

## 12. Ре-оптимизация

### Триггеры

- еженедельный обзор;
- DD worker-а > 15%;
- underperformance vs buy-and-hold 14 дней;
- profit factor < 1 / падение win rate;
- смена режима;
- новый токен;
- плохие данные;
- ручная кнопка.

### Правила

- не чаще 1 раза в 7 дней на токен;
- 1–2 shadow-кандидата;
- shadow allocation 10–20%, наблюдение 7–14 дней;
- promote только при лучших OOS + paper;
- старый worker работает до promotion;
- risk-стопы срабатывают сразу, без ожидания ре-оптимизации;
- real — только approval.

### Действия

- refresh params;
- switch strategy;
- replace worker;
- retire strategy (если плоха на большинстве токенов).

## 13. Отчёты

Daily:

- equity, P&L, DD, cash;
- trades, win rate, profit factor;
- benchmark;
- AI rationale;
- service health/errors/stale data;
- AI cost.

Weekly:

- по стратегиям/токенам;
- лучшие/худшие worker-ы;
- кандидаты на замену;
- approvals/auto actions;
- рекомендации.

## 14. Надёжность и производительность

- Postgres job queue: `FOR UPDATE SKIP LOCKED`;
- statuses, heartbeat, retry/backoff, dead-letter;
- advisory locks для singleton;
- idempotency keys; unique `(profile, token, timeframe, stage)`;
- artifacts versioned (data/features/prompt/strategy registry);
- AI/backtests вне горячего пути tick;
- cache candles/results; batch; concurrency 2–4;
- timeouts/cancellation;
- в v1 job-runner в API-процессе; отдельный worker-процесс при тяжёлых бэктестах.

## 15. Данные/БД

- `ai_profiles`
- `ai_profile_tokens`
- `ai_service_configs`
- `ai_pipeline_runs`
- `ai_jobs`
- `ai_artifacts`
- `ai_candidates`
- `ai_approvals`
- `ai_reports`
- `ai_usage`
- `market_candles`
- extend `trading_bots`: `origin`, `ai_profile_id`, `ai_candidate_id`, `evaluation_timeframe`, `allocation_usd`, `isolated_budget`.
- reuse `bot_trades`, `bot_positions`, `bot_equity_snapshots`, `bot_signals`, `bot_backtest_runs`.

## 16. Этапы

**Phase 0** — спецификация, ADR, схема, wireframes.
**Phase 1** — Control Center shell, profile/settings, AI universe, service configs.
**Phase 2** — Data Service, `market_candles`, coverage UI.
**Phase 3** — Analyst + Backtest + Lab UI.
**Phase 4** — Orchestrator + Risk + worker creation + paper workers.
**Phase 5** — approvals, reports, journal, monitoring.
**Phase 6** — shadow tournament + reoptimization + auto-approve + multi-profile.
**Phase 7** — hardening + real execution adapter (separate security project).

## 17. MVP

- 1 профиль;
- 5 токенов в AI-списке;
- `1h` + `1d`;
- 3 стратегии;
- Data/Analyst/Backtest/Risk;
- 3–5 worker-ов;
- auto-approve в paper (как решено), уведомления;
- shadow 1–2 кандидата;
- dashboard, pipeline, reports;
- без полноценной еженедельной ре-оптимизации (ручной запуск).

## 18. Безопасность

- Сейчас только sandbox/paper: реальные данные и математика, виртуальные деньги, без кошельков и ключей.
- Приватные ключи/seed-фразы на сервере запрещены правилом 1 проекта.
- Будущий real-режим: отдельный кошелёк, внешний signer (HSM/KMS/ERC-4337 session key), API формирует intents, подпись — вне API; allowlist, лимиты, kill switch, TOTP, отдельный security review.
- ИИ: недоверенный текст — данные; JSON schema; no tools; no code generation; cost caps; redaction.

## 19. Открытые вопросы

1. Нужен ли профилю отдельный «intraday» и «long-term» бюджет уже в MVP или позже?
2. Подтвердить порядок `4h → 15m → 5m` (или изменить).
3. Какие параметры сервисов точно должны быть в UI (data range, concurrency, model, thresholds)?
4. Нужен ли отдельный экран «История решений ИИ» с полными промптами/ответами (с redaction)?
5. Формат real-режима: внешний signer/AA — подтверждено, реализация отложена до Phase 7.
