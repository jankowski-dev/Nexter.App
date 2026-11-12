# Модель данных

Все таблицы создаются Drizzle-схемой `packages/db/src/schema/index.ts`; миграции лежат в `packages/db/drizzle/`. Деньги/количества — `numeric` (строки в API).

## 1. Пользователи и безопасность

| Таблица       | Назначение                                         | Ключевые поля/связи                                                               |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `users`       | Владелец                                           | id, email, passwordHash, totpSecret, recovery, timezone, baseCurrency             |
| `sessions`    | Сессии                                             | userId, tokenHash, expiresAt, createdAt, lastUsedAt                               |
| `audit_log`   | Аудит мутаций                                      | userId, action, entityType, entityId, before/after JSONB, ip, userAgent           |
| `rate_limits` | In-memory rate limit (таблица для персистентности) | key, points, windowStartedAt, blockedUntil                                        |
| `settings`    | Настройки владельца                                | userId, baseCurrency, displayCurrency, taxMethod, includeGasInCostBasis, timezone |

`users` — один владелец. Все бизнес-таблицы содержат `user_id` и owner-scoped запросы.

## 2. Активы, сети, счета

| Таблица                     | Назначение                                        | Связи                                                                                                          |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `chains`                    | BSC, Ethereum (и TRON/Solana для manual holdings) | code unique                                                                                                    |
| `assets`                    | Токены/монеты                                     | chainId → chains, symbol unique per chain, contractAddress, coingeckoId, logoUrl, isCashEquivalent, isVerified |
| `accounts`                  | Счета                                             | userId, type (`wallet`/`external`/`income`/`expense`/`equity`), chainId nullable                               |
| `watched_addresses`         | Адреса для reconciliation                         | userId, chain, address                                                                                         |
| `indexed_transfers`         | On-chain transfers                                | watched address, tx, amount, block                                                                             |
| `reconciliation_runs/items` | Результаты сверки                                 | run, item, status                                                                                              |

Актив всегда привязан к сети. Один и тот же символ на BSC и Ethereum — два разных `assets` (например, USDC). `accounts` с типом `wallet` используются для позиций; системные счета (`external`, `income`, `expense`, `equity`) — для двойной записи.

## 3. Ledger

| Таблица               | Назначение                   | Связи                                                                                                                             |
| --------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `transactions`        | Заголовок операции           | userId, type, subtype, source, importId, tradeGroupId, occurredAt, feesUsd, notes                                                 |
| `postings`            | Проводки по счетам/активам   | transactionId, accountId, assetId, amount, usdValue                                                                               |
| `trade_groups`        | Торговая группа/позиция      | userId, assetId, status, openedAt, closedAt                                                                                       |
| `trade_details`       | Детали сделки                | tradeGroupId, transactionId, referencePriceUsd, executionCostUsd                                                                  |
| `lots`                | FIFO-лоты                    | userId, assetId, tradeGroupId, acquisitionTransactionId, amount, remainingAmount, costBasisUsd, remainingCostBasisUsd, acquiredAt |
| `lot_consumptions`    | FIFO-списания                | lotId, disposalTransactionId, amount, costBasisUsd, proceedsUsd, realizedPnlUsd                                                   |
| `prices`              | Ручные/импортированные цены  | assetId, priceUsd, observedAt, source                                                                                             |
| `market_quotes`       | Последняя рыночная котировка | assetId PK, priceUsd, change24hPct, change7d/30d/1yPct, marketCapUsd, source, liquidityUsd, fetchedAt, changedAt                  |
| `portfolio_snapshots` | Дневной снимок капитала      | userId, snapshotDate, cashUsd, positionsValueUsd, equityUsd                                                                       |

`transactions` + `postings` — append-only. `lots`/`lot_consumptions` — производные FIFO-структуры. Удаление старых транзакций запрещено; исправления — новые операции.

## 4. Импорт Notion

| Таблица       | Назначение                                                    |
| ------------- | ------------------------------------------------------------- |
| `imports`     | Заголовок импорта (sourceHash, status, summary, committedAt)  |
| `import_rows` | Staging-строки (source/order/transaction), status, data JSONB |

`imports.sourceHash` защищает от повторного commit того же экспорта; `import_rows` удаляются при повторном preview/rollback.

## 5. Watchlist / База токенов

| Таблица            | Назначение                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `watchlist_groups` | Группы (Основная, пользовательские)                                                                                                                  |
| `watchlist`        | Карточка токена: assetId, groupId, thesis, tags, twitter/website, investors, priority, bscContractAddress, ethereumContractAddress, logoUrl override |

`watchlist` — метаданные поверх `assets`. `bscContractAddress`/`ethereumContractAddress` — справочные адреса (ADR 0033), не меняют identity актива.

## 6. Swap

| Таблица                   | Назначение                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `swap_orders`             | Ордер: chain, tokens, amounts, status, calldata, router, txHash, deadline, quote expiry, approval linkage, accountingTransactionId |
| `swap_order_close_groups` | Связь close-ордера с trade_groups + expected_amount                                                                                |
| `swap_events`             | События state machine (quote_created, built, ready, signing, signing_cancelled, submitted, confirmed, failed, ...)                 |
| `token_approvals`         | Approve-транзакции: token/spender/amount/status/txHash                                                                             |

`swap_orders` — не ledger; accounting создаётся только после `CONFIRMED` + подтверждения receipt.

## 7. Финансы (BYN)

| Таблица                                   | Назначение                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `finance_accounts`                        | Счета (cash/card/bank/credit), валюта, opening balance, credit limit      |
| `finance_categories`                      | Категории income/expense + цвет                                           |
| `finance_transactions`                    | Операции: kind, amount, currency, account, category, FX rate, cancelledAt |
| `finance_transfers`                       | Переводы между счетами (card_topup, credit, ...)                          |
| `finance_imports` / `finance_import_rows` | Preview/commit/rollback импорта                                           |

Модуль изолирован от крипто-ledger. Кредит — liability; net worth = assets − debt.

## 8. Задачи, заметки, привычки

| Таблица       | Назначение                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks`       | title, description, status, priority, tags, dueAt, completedAt, relatedAssetId, seriesId, recurrence, recurrenceEndsAt, occurrenceIndex, archivedAt |
| `task_images` | attachments tasks (data URL, 5 × 1.5 MB)                                                                                                            |
| `notes`       | title, body Markdown, tags, pinned, relatedAssetId/TradeGroupId, archivedAt                                                                         |
| `note_images` | attachments notes (images/files, data URL, 5 × 1.5 MB)                                                                                              |
| `habits`      | name, startedOn, archivedAt                                                                                                                         |

`tasks.seriesId` объединяет повторяющиеся occurrences; `occurrenceIndex` — номер. `note_images`/`task_images` хранят MIME и data URL; лимит проверяется сервисом.

## 9. Vault

| Таблица         | Назначение                                              |
| --------------- | ------------------------------------------------------- |
| `vault_configs` | userId unique, salt, iterations, wrappedDataKey, iv     |
| `vault_items`   | userId, ciphertext, iv, createdAt/updatedAt, archivedAt |

Сервер не хранит мастер-пароль и не может расшифровать данные. Поиск выполняется в браузере после unlock.

## 10. Диагностика

| Таблица              | Назначение                                                  |
| -------------------- | ----------------------------------------------------------- |
| `external_api_calls` | provider, endpoint, status, latencyMs, errorCode, createdAt |

Используется для диагностики лимитов KyberSwap/CoinGecko; не содержит секретов.

## 11. Бумажные торговые боты

| Таблица                | Назначение                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot_strategies`       | Экземпляр стратегии: key registry, name, description, version, params jsonb, archivedAt                                                         |
| `trading_bots`         | Бот: strategyId, status, budget/cash, maxPositions, positionSizePct, fee/slippage bps, daily loss, cooldown, peakEquity/maxDrawdown, timestamps |
| `bot_tokens`           | Разрешённые токены бота; `(botId, assetId)` unique                                                                                              |
| `bot_positions`        | Открытая paper-позиция: amount, avgCostUsd, costBasisUsd; average-cost учёт                                                                     |
| `bot_trades`           | Paper-сделки: side, amount, fill price, usdValue, fee, slippage, realizedPnl, reason, signal                                                    |
| `bot_equity_snapshots` | Снимки equity при сделках и раз в 5 минут                                                                                                       |
| `bot_events`           | Журнал created/started/stopped/buy/sell/error/reset/archived                                                                                    |
| `bot_quote_samples`    | Минутные цены токенов активных ботов для индикаторов и истории                                                                                  |

Таблицы изолированы от реального ledger: paper-сделки не пишут в `transactions`, `postings`, `lots` или `trade_groups`. `budgetUsd` неизменяем после создания; `reset` возвращает `cashUsd` к бюджету и удаляет paper-позиции/сделки/снимки. Полное описание — в `trading-bots.md`.
