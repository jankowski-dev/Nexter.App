# API — справочник

Базовый путь: `/api/v1`. Все ответы — JSON (кроме CSV/иконок). Контракты описаны Zod-схемами в `packages/contracts`; Swagger доступен локально по `/api/docs` при `ENABLE_DOCS=true` и `NODE_ENV=development/test`.

## 1. Общие правила

- Аутентификация: cookie `nexter_session` (HttpOnly, Secure в production).
- Мутации (`POST`, `PATCH`, `DELETE`) требуют header `x-csrf-token` со значением cookie `nexter_csrf`.
- Owner-only: все данные фильтруются по `userId`.
- Ошибки:
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {}, "requestId": "..." } }
  ```
- Дефолтный `Cache-Control: no-store` для `/api/v1/*`, кроме `/api/v1/watchlist/icon` (public 24h).
- Деньги — строки; не использовать JS `number` для финансовых расчётов.
- Idempotency: ручные транзакции и импорт поддерживают `Idempotency-Key`/sourceHash.

## 2. Health

| Метод | Путь      | Описание       |
| ----- | --------- | -------------- |
| GET   | `/health` | liveness       |
| GET   | `/ready`  | readiness + DB |

## 3. Auth

| Метод  | Путь                    | Описание                                |
| ------ | ----------------------- | --------------------------------------- |
| POST   | `/auth/setup`           | первичная настройка owner (setup token) |
| POST   | `/auth/login`           | email + password                        |
| GET    | `/auth/status`          | инициализирован ли owner                |
| POST   | `/auth/2fa/verify`      | TOTP-проверка при входе                 |
| POST   | `/auth/2fa/setup`       | начать настройку TOTP                   |
| POST   | `/auth/2fa/enable`      | подтвердить TOTP                        |
| POST   | `/auth/logout`          | завершить сессию                        |
| GET    | `/auth/me`              | текущий owner/состояние 2FA             |
| GET    | `/auth/csrf`            | текущий CSRF-токен                      |
| POST   | `/auth/recovery/verify` | восстановление по коду                  |
| POST   | `/auth/password`        | смена пароля                            |
| POST   | `/auth/password/reset`  | сброс пароля                            |
| POST   | `/auth/recovery-codes`  | перегенерация recovery codes            |
| GET    | `/auth/sessions`        | активные сессии                         |
| DELETE | `/auth/sessions/:id`    | отозвать сессию                         |
| POST   | `/auth/step-up`         | step-up TOTP для свопов                 |

## 4. Accounting

| Метод | Путь                          | Описание                                                                      |
| ----- | ----------------------------- | ----------------------------------------------------------------------------- |
| GET   | `/accounts`                   | счета                                                                         |
| GET   | `/accounts/:id`               | счёт                                                                          |
| GET   | `/assets`                     | все активы                                                                    |
| GET   | `/assets/:id`                 | актив                                                                         |
| GET   | `/positions`                  | позиции + cash/equity/missingPrices                                           |
| GET   | `/positions/:assetId`         | позиция по активу                                                             |
| GET   | `/portfolio/assets/:assetId`  | полная карточка актива (position/quote/lots/trades/transactions/prices)       |
| GET   | `/dashboard/summary`          | сводка                                                                        |
| GET   | `/dashboard/equity-curve`     | equity curve                                                                  |
| GET   | `/dashboard/allocation`       | аллокация                                                                     |
| GET   | `/dashboard/pnl`              | месячный P&L                                                                  |
| GET   | `/dashboard/active-positions` | активные позиции                                                              |
| GET   | `/dashboard/recent-trades`    | последние сделки                                                              |
| GET   | `/dashboard/data-quality`     | quality issues                                                                |
| GET   | `/transactions`               | журнал операций (cursor/page)                                                 |
| POST  | `/transactions`               | ручная операция (buy/sell/swap/transfer/deposit/withdrawal/income/adjustment) |
| GET   | `/trade-groups`               | сделки/группы (filters: status, assetId, pnl, view, period)                   |
| GET   | `/trade-groups/:id`           | детали группы (lots, consumptions, audit, legs)                               |
| PATCH | `/trade-groups/:id/notes`     | заметка группы                                                                |
| POST  | `/trade-groups/:id/sell`      | ручная продажа группы                                                         |
| GET   | `/prices/:assetId`            | история ручных цен                                                            |
| POST  | `/prices/:assetId`            | установить ручную цену fallback                                               |
| GET   | `/reports`                    | period report (`from`,`to`)                                                   |
| GET   | `/export/:dataset.:format`    | CSV export (transactions/trades/etc.)                                         |
| POST  | `/dashboard/snapshot`         | ручной snapshot                                                               |

## 5. Watchlist / База токенов

| Метод  | Путь                                | Описание                                                               |
| ------ | ----------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/watchlist`                        | список (cursor, groupId, includeArchived, search)                      |
| POST   | `/watchlist`                        | добавить существующий asset                                            |
| PATCH  | `/watchlist/:id`                    | изменить карточку (thesis/tags/links/investors/contracts/logo/archive) |
| DELETE | `/watchlist/:id`                    | архив                                                                  |
| GET    | `/watchlist/groups`                 | группы                                                                 |
| POST   | `/watchlist/groups`                 | создать группу                                                         |
| PATCH  | `/watchlist/groups/:id`             | изменить группу                                                        |
| DELETE | `/watchlist/groups/:id`             | удалить группу (перевод в Основную)                                    |
| GET    | `/watchlist/search?chain=&address=` | on-chain metadata + CoinGecko/DexScreener + alreadyInWatchlist         |
| POST   | `/watchlist/from-contract`          | создать/привязать asset и добавить в watchlist                         |
| GET    | `/watchlist/icon?url=`              | прокси иконки (CoinGecko hosts, 24h cache)                             |

## 6. Swap

| Метод | Путь                              | Описание                                                  |
| ----- | --------------------------------- | --------------------------------------------------------- |
| GET   | `/swap/config`                    | enabled/kill switch/chains/tokens/wallet allowlist        |
| POST  | `/swap/preview`                   | non-persisting quote (5s cache, 500ms debounce on client) |
| POST  | `/swap/quote`                     | persist quote order (`closeGroupIds` для продажи)         |
| POST  | `/swap/build`                     | build + simulate calldata                                 |
| POST  | `/swap/approvals/build`           | build approve                                             |
| POST  | `/swap/approvals/submitted`       | attach approval tx hash                                   |
| GET   | `/swap/approvals`                 | approvals list                                            |
| POST  | `/swap/orders/:id/ready`          | READY после approval                                      |
| POST  | `/swap/orders/:id/signing`        | AWAITING_SIGNATURE                                        |
| POST  | `/swap/orders/:id/signing/cancel` | вернуть READY после отклонения                            |
| POST  | `/swap/orders/:id/submitted`      | attach swap tx hash                                       |
| GET   | `/swap/orders`                    | список ордеров                                            |
| GET   | `/swap/orders/:id`                | детали ордера                                             |
| POST  | `/swap/orders/:id/cancel`         | отменить unsigned order                                   |

## 7. Imports

| Метод | Путь                          | Описание                                                  |
| ----- | ----------------------------- | --------------------------------------------------------- |
| GET   | `/imports`                    | история импортов                                          |
| GET   | `/imports/:id`                | импорт + rows                                             |
| GET   | `/imports/:id/reconciliation` | сверка                                                    |
| POST  | `/imports/notion/preview`     | preview (content-type `application/x-notion-import+json`) |
| POST  | `/imports/:id/commit`         | commit                                                    |
| POST  | `/imports/:id/rollback`       | rollback (только последний)                               |

## 8. Finance (BYN)

| Метод | Путь                                | Описание                                                              |
| ----- | ----------------------------------- | --------------------------------------------------------------------- |
| GET   | `/finance/accounts`                 | счета                                                                 |
| POST  | `/finance/accounts`                 | создать счёт                                                          |
| PATCH | `/finance/accounts/:id`             | изменить/архивировать                                                 |
| GET   | `/finance/categories`               | категории                                                             |
| POST  | `/finance/categories`               | создать                                                               |
| PATCH | `/finance/categories/:id`           | изменить                                                              |
| GET   | `/finance/transactions`             | журнал (period, cancelled)                                            |
| POST  | `/finance/transactions`             | операция                                                              |
| PATCH | `/finance/transactions/:id/cancel`  | отменить                                                              |
| PATCH | `/finance/transactions/:id/restore` | вернуть                                                               |
| GET   | `/finance/transfers`                | переводы                                                              |
| POST  | `/finance/transfers`                | перевод                                                               |
| GET   | `/finance/summary`                  | сводка (`from/to` или `all=true`); погашение кредита входит в расходы |
| POST  | `/finance/import/preview`           | preview                                                               |
| POST  | `/finance/import/commit`            | commit                                                                |
| POST  | `/finance/import/rollback`          | rollback                                                              |

## 9. Tasks / Notes / Habits

| Метод  | Путь                         | Описание                                           |
| ------ | ---------------------------- | -------------------------------------------------- |
| GET    | `/tasks`                     | список (status/search/range/archived)              |
| POST   | `/tasks`                     | создать (recurrence → series)                      |
| PATCH  | `/tasks/:id`                 | изменить (`applyToSeries` default true для series) |
| POST   | `/tasks/:id/images`          | attachment                                         |
| DELETE | `/tasks/:id/images/:imageId` | удалить attachment                                 |
| GET    | `/notes`                     | список (search/archive/offset/limit)               |
| GET    | `/notes/:id`                 | детали + attachments                               |
| POST   | `/notes`                     | создать                                            |
| POST   | `/notes/improve`             | улучшить текст заметки через ИИ                    |
| PATCH  | `/notes/:id`                 | изменить/архивировать/pin                          |
| POST   | `/notes/:id/images`          | attachment (image/file)                            |
| DELETE | `/notes/:id/images/:imageId` | удалить attachment                                 |
| GET    | `/habits`                    | привычки                                           |
| POST   | `/habits`                    | создать                                            |
| PATCH  | `/habits/:id`                | изменить/архивировать                              |

## 10. Vault

| Метод  | Путь                | Описание                    |
| ------ | ------------------- | --------------------------- |
| GET    | `/vault`            | config + items (ciphertext) |
| POST   | `/vault/initialize` | salt/iterations/wrapped key |
| POST   | `/vault/items`      | создать encrypted item      |
| PATCH  | `/vault/items/:id`  | изменить ciphertext         |
| DELETE | `/vault/items/:id`  | архив                       |

## 11. Audit / Settings / Reconciliation

| Метод | Путь                        | Описание                                        |
| ----- | --------------------------- | ----------------------------------------------- |
| GET   | `/audit-log`                | audit entries (action/entityType/period/cursor) |
| GET   | `/settings`                 | настройки, включая `audioMaxMb`                 |
| PATCH | `/settings`                 | изменить; `audioMaxMb` 1–20                     |
| GET   | `/settings/system-status`   | read-only статус котировок/ботов/свопов         |
| GET   | `/settings/data-quality`    | read-only проверки качества данных              |
| GET   | `/reconciliation/runs`      | запуски сверки                                  |
| GET   | `/reconciliation/runs/:id`  | детали                                          |
| POST  | `/reconciliation/runs`      | запустить (если enabled)                        |
| GET   | `/reconciliation/addresses` | watched addresses                               |

## 11.1. Notifications

| Метод | Путь                          | Описание                            |
| ----- | ----------------------------- | ----------------------------------- |
| GET   | `/notifications?limit=`       | последние уведомления + unreadCount |
| GET   | `/notifications/unread-count` | число непрочитанных                 |
| POST  | `/notifications/read-all`     | пометить все прочитанными           |

Все ответы owner-scoped. Уведомления создаются сервером; отдельного пользовательского создания нет.

## 12. Bot API (server-to-server)

| Метод | Путь                            | Описание                                       |
| ----- | ------------------------------- | ---------------------------------------------- |
| GET   | `/bot/tasks/upcoming?minutes=5` | открытые задачи в окне напоминания             |
| POST  | `/bot/audio-notes`              | транскрипт + аудио; создаёт заметку и вложение |
| GET   | `/bot/audio-notes/:id`          | статус обработки аудиозаметки                  |

Bearer `BOT_API_TOKEN`; origin/CSRF exempt (`@SkipOrigin`). The external `jankowski-dev/Nexter.Bot` service transcribes locally and calls these endpoints. The audio limit is `settings.audio_max_mb` (default 8, max 20).

## 13. Trading bots (paper)

| Метод  | Путь                                     | Описание                                      |
| ------ | ---------------------------------------- | --------------------------------------------- |
| GET    | `/trading-bots/strategies`               | read-only registry стратегий                  |
| GET    | `/trading-bots/bots`                     | список ботов + статистика (`includeArchived`) |
| POST   | `/trading-bots/bots`                     | создать бота                                  |
| GET    | `/trading-bots/bots/:id`                 | бот + стратегия + токены + позиции            |
| PATCH  | `/trading-bots/bots/:id`                 | настройки (только не-running)                 |
| POST   | `/trading-bots/bots/:id/start`           | запуск                                        |
| POST   | `/trading-bots/bots/:id/stop`            | остановка                                     |
| POST   | `/trading-bots/bots/:id/close-positions` | принудительное закрытие всех позиций          |
| POST   | `/trading-bots/bots/:id/reset`           | сброс paper-состояния                         |
| DELETE | `/trading-bots/bots/:id`                 | archive + purge telemetry                     |
| GET    | `/trading-bots/bots/:id/trades?limit=`   | сделки                                        |
| GET    | `/trading-bots/bots/:id/events?limit=`   | события                                       |
| GET    | `/trading-bots/bots/:id/equity?limit=`   | equity curve                                  |
| GET    | `/trading-bots/bots/:id/signals`         | последние решения по токенам                  |
| GET    | `/trading-bots/bots/:id/trade-summaries` | P&L по токенам                                |
| GET    | `/trading-bots/bots/:id/telemetry`       | schema-v1 JSON для AI-анализа                 |
| POST   | `/trading-bots/backtests`                | запустить/сохранить backtest                  |
| POST   | `/trading-bots/backtests/preview`        | preview без сохранения                        |
| GET    | `/trading-bots/backtests`                | список прогонов                               |
| GET    | `/trading-bots/backtests/:id/report.pdf` | PDF-отчёт                                     |
| DELETE | `/trading-bots/backtests/:id`            | удалить прогон                                |

Стратегии — read-only code registry; отдельных CRUD-эндпоинтов стратегий больше нет. Бюджет — от $100 и кратен $100; токены должны быть активными записями Базы токенов. Running-боты не редактируются. Подробности — в `trading-bots.md`.

## 14. AI trading (research/recommendation)

Owner-only; CSRF and audit. The module is recommendation-only: it does not create or start bots.

| Метод        | Путь                             | Назначение                                           |
| ------------ | -------------------------------- | ---------------------------------------------------- |
| GET          | `/ai-trading/profile`            | профиль: бюджет, лимиты, модель                      |
| PUT          | `/ai-trading/profile`            | обновить профиль                                     |
| GET/POST     | `/ai-trading/profile/tokens`     | AI-вселенная                                         |
| PATCH/DELETE | `/ai-trading/profile/tokens/:id` | изменить/мягко отключить токен                       |
| GET          | `/ai-trading/services`           | конфиги Data/Analyst/Backtest/Risk/Reporter          |
| PUT          | `/ai-trading/services/:service`  | изменить конфиг сервиса                              |
| GET          | `/ai-trading/recommendations`    | рекомендации по всем запускам                        |
| GET          | `/ai-trading/dashboard`          | бюджет, токены, роботы, очередь                      |
| GET          | `/ai-trading/coverage`           | покрытие свечей по токенам/ТФ                        |
| POST         | `/ai-trading/cycle`              | один цикл: данные → поиск → рекомендации → черновики |
| GET          | `/ai-trading/cycle/:cycleId`     | статус/шаги/ошибки цикла                             |
| POST         | `/ai-trading/data/refresh`       | загрузить OHLCV (GeckoTerminal/CoinGecko/Binance)    |
| GET          | `/ai-trading/lab`                | последний анализ по токену/ТФ                        |
| POST         | `/ai-trading/lab/analyze`        | анализ + кандидаты                                   |
| POST         | `/ai-trading/lab/backtest`       | train/OOS бэктест кандидата                          |

The one-click research cycle is implemented as `POST /ai-trading/cycle` (202) with `GET /ai-trading/cycle/:cycleId`; `GET /ai-trading/cycles?limit=20` returns the owner-scoped cycle history (status, symbol/timeframe, steps, counts and a sanitized error) for the Reporter drawer. The cycle stops at the first failed step, writes step logs to `ai_pipeline_runs`/`ai_jobs`, creates only draft bots and never starts them. `POST /ai-trading/cycle/:cycleId/cancel` cancels a queued/running cycle, cancels its linked search, marks unfinished steps skipped and is idempotent for an already cancelled cycle; finished cycles return `AI_CYCLE_NOT_CANCELLABLE` (409). The cycle has a 90-minute hard search cap and aborts only after 10 minutes without progress; search progress is written every 50 evaluated variants. Stale recovery is 45 minutes; transient database errors during status polling are retried and raw SQL is never exposed to the client.

Mass search is implemented: asynchronous `POST /ai-trading/search`, `GET /search/runs` (recent runs), `GET /search/:runId` (progress/stats), `GET /search/:runId/results` and `POST /search/:runId/cancel`. Search variants run in a bounded Node worker-thread pool (`AI_SEARCH_WORKERS`, production 6) with a sequential fallback; cancellation terminates all workers. Search results expose candidate `expiresAt`/`expired` (horizon TTL, default 7 days) and `nearMisses` (positive OOS but failed a filter/holdout; not recommendations). Accept a candidate by creating a draft bot through `POST /trading-bots/bots` with `aiCandidateId`; the bot is created as `draft` and never started automatically, and stale candidates return `AI_RECOMMENDATION_EXPIRED`. `GET /ai-trading/recommendations` lists recommended/accepted candidates with TTL, suggested allocation and invalidation rules; `GET /recommendations/:id` and `POST /recommendations/:id/reject` are available. The risk layer caps drafts by worker slots, per-bot allocation, `maxInvestedPct` and `maxTokenExposurePct` before creating them. `GET /ai-trading/bots/health` returns invalidation health for AI-origin bots, including drawdown, daily loss, stale ticks, missing/malformed/non-positive or older-than-5-minutes position quotes, stop/take hits using the bot strategy params (`stopLossPct`, `hardStopPct`, `closeLossThresholdPct`, `takeProfitPct`), horizon, negative P&L, errors and missing recommendations. The monitor is advisory and never stops a bot. No approvals endpoints.
