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

`POST /swap/build`, `/swap/orders/:id/ready` and `/swap/approvals/build` return a buffered, actionable `gasLimit` (decimal string): the API takes the larger of the Kyber build gas and the RPC `eth_estimateGas`, adds 20% and clamps to `[150,000, 10,000,000]`. The web wallet must pass this value as the hex `gas` field of `eth_sendTransaction`; if it is absent, the wallet keeps its own estimator. See ADR 0092.

If the wallet broadcast a transaction but did not return its hash, the owner can recover it through `GET /swap/orders` and `POST /swap/orders/:id/submitted` with the hash from the wallet/explorer. `submitted` accepts `AWAITING_SIGNATURE`, built `EXPIRED`, and built `CANCELLED` orders; the UI surfaces recent stalled orders under `Крипта → Ордера`. The server verifies the on-chain transaction before accounting. See ADR 0093.

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

| Метод | Путь                          | Описание                                |
| ----- | ----------------------------- | --------------------------------------- |
| GET   | `/notifications?limit=`       | последние уведомления + unreadCount     |
| GET   | `/notifications/unread-count` | число непрочитанных                     |
| POST  | `/notifications/read-all`     | пометить все прочитанными               |
| GET   | `/notifications/viber/status` | статус очереди Viber и последняя ошибка |
| GET   | `/notifications/viber?limit=` | последние доставки Viber                |
| POST  | `/notifications/viber/test`   | поставить тестовое сообщение в очередь  |

Все ответы owner-scoped. Уведомления создаются сервером; отдельного пользовательского создания нет. Viber-очередь (`viber_notifications`) заполняется при закрытии сделки/остановке робота, если включены соответствующие тумблеры.

## 12. Bot API (server-to-server)

| Метод | Путь                            | Описание                                       |
| ----- | ------------------------------- | ---------------------------------------------- |
| GET   | `/bot/tasks/upcoming?minutes=5` | открытые задачи в окне напоминания             |
| POST  | `/bot/audio-notes`              | транскрипт + аудио; создаёт заметку и вложение |
| GET   | `/bot/audio-notes/:id`          | статус обработки аудиозаметки                  |
| GET   | `/bot/notifications/pending`    | очередь Viber + частота/время дайджеста        |
| POST  | `/bot/notifications/:id/ack`    | подтвердить `sent`/`failed`                    |

Bearer `BOT_API_TOKEN`; origin/CSRF exempt (`@SkipOrigin`). The external `jankowski-dev/Nexter.Bot` service transcribes locally and calls these endpoints. The audio limit is `settings.audio_max_mb` (default 8, max 20). Viber secrets (`VIBER_TOKEN`, `VIBER_USER_ID`) stay in `Nexter.Bot`; the API only exposes the outbox. Failed acks remain pending until three attempts, then `failed`.

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
| GET    | `/trading-bots/bots/:id/telemetry`       | schema-v1 JSON телеметрии робота              |

Стратегии — read-only code registry; отдельных CRUD-эндпоинтов стратегий больше нет. Бюджет — от $100 и кратен $100; токены должны быть активными записями Базы токенов. Running-боты не редактируются. Справочник стратегий доступен в `Настройки → Стратегии`; бэктест роботов удалён (ADR 0090). Подробности — в `trading-bots.md`.

## 14. Sandbox (`/sandbox`)

Owner-only paper sandbox; feature flag `SANDBOX_ENABLED`. It never touches the real ledger, wallets or swaps.

| Метод | Путь                               | Назначение                                          |
| ----- | ---------------------------------- | --------------------------------------------------- |
| GET   | `/sandbox/status`                  | feature flag и версия                               |
| GET   | `/sandbox/tokens`                  | вселенная токенов песочницы                         |
| GET   | `/sandbox/tokens/candidates`       | токены `Избранного` с признаком `eligible`/`reason` |
| POST  | `/sandbox/tokens`                  | добавить только кандидата из `Избранного`           |
| PATCH | `/sandbox/tokens/:id`              | включить/отключить или обновить метаданные          |
| POST  | `/sandbox/tokens/:id/refresh`      | загрузить историю 1h                                |
| GET   | `/sandbox/coverage`                | покрытие и свежесть свечей                          |
| GET   | `/sandbox/overview`                | сводка живых запусков                               |
| GET   | `/sandbox/runs`                    | список живых запусков                               |
| POST  | `/sandbox/runs`                    | создать черновик запуска                            |
| PATCH | `/sandbox/runs/:id`                | изменить черновик                                   |
| POST  | `/sandbox/runs/:id/start`          | запустить paper-цикл                                |
| POST  | `/sandbox/runs/:id/pause`          | пауза                                               |
| POST  | `/sandbox/runs/:id/resume`         | продолжить                                          |
| POST  | `/sandbox/runs/:id/stop`           | остановить                                          |
| POST  | `/sandbox/runs/:id/archive`        | архив                                               |
| POST  | `/sandbox/runs/:id/close/:tokenId` | закрыть позицию токена                              |
| GET   | `/sandbox/runs/:id/positions`      | позиции                                             |
| GET   | `/sandbox/runs/:id/trades`         | сделки                                              |
| GET   | `/sandbox/runs/:id/intents`        | журнал интентов                                     |
| GET   | `/sandbox/runs/:id/events`         | журнал событий                                      |
| GET   | `/sandbox/runs/:id/equity`         | кривая капитала                                     |
| GET   | `/sandbox/runs/:id/report.json`    | JSON-отчёт живого запуска                           |
| GET   | `/sandbox/runs/:id/report.md`      | Markdown-отчёт живого запуска                       |
| POST  | `/sandbox/replays/preflight`       | проверка покрытия исторического окна                |
| POST  | `/sandbox/replays`                 | создать исторический прогон (202, воркер)           |
| GET   | `/sandbox/replays`                 | история прогонов                                    |
| GET   | `/sandbox/replays/:id`             | детали прогона                                      |
| GET   | `/sandbox/replays/:id/report.json` | JSON-отчёт с `identity` (хеши, seed)                |
| GET   | `/sandbox/replays/:id/report.pdf`  | PDF-отчёт со всеми журналами и identity             |
| GET   | `/sandbox/replays/:id/chart`       | свечи окна оценки и маркеры действий                |
| GET   | `/sandbox/replays/:id/decisions`   | полный журнал решений (on-demand, постранично)      |
| POST  | `/sandbox/replays/:id/cancel`      | отменить прогон в очереди                           |
| POST  | `/sandbox/replays/:id/archive`     | архив                                               |

Новые токены песочницы добавляются только из группы `Избранное` по паре chain+contract; отсутствующий/неподдерживаемый контракт блокируется на сервере (`SANDBOX_TOKEN_NOT_IN_FAVORITES`, `SANDBOX_TOKEN_NOT_ELIGIBLE`). Исторический прогон исполняется на сохранённом gzip-снимке свечей; `chart` и `decisions` не меняют отчёт и его хеши. Markdown для исторических прогонов удалён — остаются PDF и JSON. См. ADR 0085, 0089 и `runbooks/sandbox.md`.
