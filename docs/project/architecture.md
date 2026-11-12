# Архитектура Nexter

## 1. Контекст системы

```mermaid
flowchart LR
  Owner[Владелец] -->|HTTPS| SPA[React SPA]
  SPA -->|/api/v1 + cookie + CSRF| API[NestJS API]
  API --> DB[(PostgreSQL)]
  API -->|котировки| DEX[DexScreener]
  API -->|fallback/native| CG[CoinGecko]
  API -->|quote/build| KYBER[KyberSwap Aggregator]
  API -->|balance/receipt/logs| RPC[BSC/Ethereum RPC]
  Worker[pg-boss worker] --> DB
  SPA -->|WalletConnect| Wallet[Tangem / внешний кошелёк]
  Wallet -->|подписанная tx| Chain[BSC / Ethereum]
  API -->|read-only indexer| Chain
  API -->|serve SPA| SPA
```

- **SPA** не хранит приватные ключи и не работает с БД напрямую.
- **API** — единственная точка записи в БД. Он же раздаёт статику SPA из `apps/web/dist`.
- **Worker** выполняет фоновые задачи pg-boss. Сейчас worker использует owner-роль БД, потому что pg-boss создаёт/меняет свою схему; API использует ограниченную роль `nexter_app`.
- **WalletConnect/Tangem** — единственный путь подписи. Сервер не может подписать транзакцию за владельца.
- **RPC/индексер** используется для проверки балансов, квитанций и reconciliation; он не является источником цен.

## 2. Слои API

```mermaid
flowchart TB
  Fastify[Fastify + NestJS bootstrap]
  Guards[Auth guard / CSRF / rate limit / import hook]
  Controllers[Controllers]
  Services[Domain services]
  Repos[Drizzle ORM]
  PG[(PostgreSQL)]
  Fastify --> Guards --> Controllers --> Services --> Repos --> PG
  Services --> External[DexScreener / CoinGecko / Kyber / RPC]
  Services --> Audit[AuditService]
```

- **Controllers** только валидируют вход через Zod (`ZodValidationPipe`) и вызывают сервисы.
- **Services** содержат бизнес-логику, транзакции и аудит.
- **Drizzle** используется напрямую; отдельного repository-слоя нет.
- **AuditService** пишет в `audit_log`; для критичных мутаций используется `strict: true` (ошибка аудита откатывает мутацию).
- **Auth guard** проверяет `HttpOnly` cookie-сессию; мутации требуют `x-csrf-token`.
- **Rate limit** — in-memory, по IP; в тестах лимиты выше.

## 3. Аутентификация и сессия

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant DB as PostgreSQL
  B->>A: POST /auth/login (email, password)
  A->>DB: verify Argon2 hash + TOTP
  A->>DB: create session (hashed token)
  A-->>B: Set-Cookie nexter_session (HttpOnly) + nexter_csrf
  B->>A: GET /api/v1/...
  A->>DB: session lookup / expiry / rotation
  A-->>B: data
  B->>A: POST/PATCH (x-csrf-token)
  A->>DB: mutation + audit
```

- TOTP обязателен после настройки; step-up TOTP используется для свопов выше `SWAP_STEP_UP_THRESHOLD_USD`.
- Сессии хранятся хэшами; cookie `Secure`/`SameSite` настраиваются окружением.
- Восстановление пароля — через recovery-код; сброс инвалидирует сессии.
- Публичной регистрации нет; первичная настройка — по `SETUP_TOKEN`.

## 4. Учётный контур (ledger)

```mermaid
flowchart LR
  Manual[Ручная операция] --> Tx[transactions]
  Import[Notion import] --> Tx
  Swap[Подтверждённый swap] --> Tx
  Tx --> Post[postings]
  Tx --> TD[trade_details]
  Tx --> Lots[lots]
  Lots --> Cons[lot_consumptions]
  Post --> Bal[wallet balances]
  Lots --> Pos[positions]
  Market[market_quotes] --> Pos
  Pos --> Dash[dashboard/portfolio]
```

- Каждая операция создаёт `transactions` + `postings` (двойная запись по счетам).
- Покупка создаёт `lots`; продажа списывает FIFO и создаёт `lot_consumptions` с realized P&L.
- `trade_groups` объединяют лоты/сделки одного актива; `trade_details` хранит reference/execution цены.
- `accounts` бывают `wallet`, `external`, `income`, `expense`, `equity`.
- Кэш-эквиваленты (USDT/USDC) не создают лоты; они учитываются как cash.
- Ручные корректировки (`adjustment`) создают лот по текущей стоимости; отрицательных adjustment в UI нет. Для уменьшения используется withdrawal/продажа.
- Ledger append-only: ошибки исправляются новыми операциями. Технические удаления ошибочных строк допустимы только как аварийная операция с audit-записью и бэкапом.

### 4.1. FIFO

- Лоты сортируются по `acquiredAt, createdAt`.
- Продажа/списание списывает самые старые лоты.
- `remainingAmount`, `remainingCostBasisUsd` обновляются.
- Если лот закрыт не полностью — группа становится `partial`.
- Частичное закрытие сделки передаёт `closeGroupIds` и ожидаемое количество; сервер проверяет остаток.
- Газ/комиссии: капитализируются в cost basis при покупке (если `includeGasInCostBasis`), иначе учитываются как fee.

## 5. Рыночные данные и оценка

```mermaid
sequenceDiagram
  participant R as MarketQuoteRefreshService
  participant D as DexScreener
  participant C as CoinGecko
  participant DB as market_quotes
  participant P as PricingService
  participant UI as Portfolio/Dashboard/Trades
  R->>DB: существующие котировки
  R->>D: contract tokens (60s)
  R->>C: native/low-liquidity + периоды (10min)
  R->>DB: upsert price/24h/7d/30d/1y/cap
  P->>DB: latestForAssets
  P-->>UI: price + changes + fetchedAt
```

- **Приоритет:** DexScreener для контрактных токенов с ликвидностью ≥ `MARKET_QUOTE_MIN_LIQUIDITY_USD` (по умолчанию $25k); CoinGecko — fallback/native.
- `market_quotes.fetched_at` — время последней проверки; `changed_at` — время изменения цены.
- `PricingService.latestForAssets` сначала читает `market_quotes`, затем fallback на manual `prices`.
- 7d/30d/1y и market cap приходят из CoinGecko; у токенов без CoinGecko поля `null`.
- Иконки проксируются через `/api/v1/watchlist/icon` (allowlist CoinGecko hosts), кэш 24ч на сервере + 24ч в браузере; ошибки icon-route — `no-store`.
- 3-месячный период намеренно не показывается: CoinGecko не отдаёт ровно 90 дней.

## 6. Свопы (BSC/Ethereum)

```mermaid
stateDiagram-v2
  [*] --> QUOTED: POST /swap/quote
  QUOTED --> BUILT: build + simulate
  BUILT --> APPROVAL_REQUIRED: нужен approve
  BUILT --> READY: approve не нужен
  APPROVAL_REQUIRED --> READY: approve подтверждён
  READY --> AWAITING_SIGNATURE: signing
  AWAITING_SIGNATURE --> READY: signing/cancel
  AWAITING_SIGNATURE --> SUBMITTED: submitted txHash
  SUBMITTED --> PENDING: tracker видит tx
  PENDING --> CONFIRMED: нужные confirmations
  CONFIRMED --> ACCOUNTED: accountingTransactionId
  QUOTED/BUILT/READY/APPROVAL_REQUIRED --> CANCELLED: cancel / expiry / supersede
  SUBMITTED/PENDING --> FAILED/DROPPED/REPLACED: tracker
```

- Quote/build делает KyberSwap; сервер проверяет `amountIn`, router, calldata, selectors, recipient, minOut, executor, fees, deadline.
- `swap_order_close_groups` хранит выбранные группы и ожидаемое количество; сервер проверяет остаток и блокирует параллельные закрытия.
- Подпись — только WalletConnect/Tangem. Сервер не видит ключей.
- После `SUBMITTED` tracker опрашивает RPC, ждёт confirmations, проверяет receipt и создаёт accounting transactions.
- Если hash подписан, но submit не удался — `submit_failed`; повторная отправка использует тот же hash (без второй подписи).
- Если пользователь отклонил запрос, но кошелёк не вернул ошибку, UI позволяет нажать «Отменить ожидание»; подпись возвращается в READY, approval оставляется до ответа/expiry. Если hash всё же придёт, он будет отправлен на сервер.

## 7. Импорт Notion

- Legacy import: загрузка `source.json`, `orders.json`, `transactions.json` (raw Notion rows).
- `preview` парсит и проверяет, `detectExisting` сравнивает существующие лоты/группы, `commit` пишет ledger, `rollback` возможен только для последнего импорта без более поздних операций.
- Исторический 429-order control применяется только к исходному экспорту с numeric ID ≤ 466; более поздние экспорты используют preview totals и per-row detection (ADR 0032).
- `import_rows` хранит staging-строки; audit получает только сводку.
- Notion MCP — внешний инструмент для выгрузки; в репозитории нет токена Notion.

## 8. Финансы (BYN)

```mermaid
flowchart LR
  Acc[finance_accounts] --> Tx[finance_transactions]
  Cat[finance_categories] --> Tx
  Acc --> Tr[finance_transfers]
  Tx --> Summary[finance/summary]
  Tr --> Summary
```

- Отдельный модуль, не влияет на крипто-ledger.
- Базовая валюта BYN; USD/EUR счета хранят native balance и курс.
- `credit` — liability; net worth = assets − debt.
- Операции отменяются (soft cancel), не удаляются; отменённые исключены из статистики.
- Импорт — preview/commit/rollback, staging в `finance_import_rows`.

## 9. Задачи, заметки, привычки

- `tasks`: soft archive, recurrence series (`series_id`, `recurrence`, `occurrence_index`), tags, images.
- Recurring update/delete применяется ко всей серии (content/delete); completion — per occurrence.
- `notes`: Markdown subset, soft archive, pin, images/attachments (data URL, 5 × 1.5 MB), notebook journal UI.
- `habits`: name + start date + archive; streak вычисляется в UI/API.
- Все мутации аудируются; тела заметок и ciphertext vault не логируются.

## 10. Vault

- Браузер: PBKDF2-SHA-256 (600k) → master key; случайный AES-256-GCM data key; элементы шифруются data key.
- Сервер хранит salt, iterations, wrapped key, ciphertext, IV; не может расшифровать.
- Мастер-пароль не сохраняется; потеря = потеря vault.
- Vault блокируется при reload; есть manual lock.
- UI: поиск по расшифрованным названию/логину/URL, пароль show/copy, архив/редактирование.

## 11. Reconciliation

- Read-only индексер on-chain transfers; `watched_addresses`, `indexed_transfers`, `reconciliation_runs/items`.
- Сверяет балансы/ledger с chain; не исправляет ledger автоматически.
- `RECONCILIATION_ENABLED` по умолчанию false.
- Data acceptance отложен до clean cutover (ADR 0014).

## 12. Аудит и наблюдаемость

- `audit_log`: action, entity, before/after, ip, userAgent, timestamp.
- Settings → Audit (`/settings/audit`) — просмотр и фильтр.
- `external_api_calls`: провайдер, endpoint, status, latency, errorCode.
- Pino JSON logs: request id, method, url без query, status, responseTime; секреты редактируются.
- Sentry — только safe error context.
- `/health` — liveness; `/ready` — DB readiness.

## 13. Бумажные торговые боты (см. `trading-bots.md`)

```mermaid
flowchart LR
  Bot[Bot] --> Strategy[Strategy registry]
  Strategy --> Signal[Signal]
  Signal --> Risk[Risk/position sizing]
  Risk --> Paper[Paper execution venue]
  Paper --> BotLedger[bot_trades/bot_positions]
  BotLedger --> Stats[Bot stats/equity]
  Quotes[market_quotes] --> Strategy
  Future[Future live venue] -.-> Swap[SwapService]
```

- `BotRunnerService` просыпается каждые 60 секунд, берёт advisory lock `nexter:bot-runner` на отдельном соединении и обрабатывает всех `running` ботов.
- Стратегии — код-реестр; параметры валидируются Zod. Paper execution считает комиссию/проскальзывание и пишет только в `bot_*` таблицы.
- `bot_quote_samples` даёт минутную историю для индикаторов; retention 30 дней.
- UI `/testing` показывает full-width карточки, статистику, позиции, сделки и события.
- Ключевое ограничение: реальная автоторговля не может использовать WalletConnect/Tangem без ручного подтверждения. Для live нужен отдельный подписант/session key/AA и отдельный security review; сервер не должен хранить приватные ключи.
