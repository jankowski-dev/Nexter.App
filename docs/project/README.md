# Nexter — путеводитель по проекту

> Версия документа: 2026-11-17. Это живая документация: при изменении схемы, API или поведения обновляйте соответствующий раздел и `docs/decisions.md`.
>
> Быстрый старт для агента: [`agent-guide.md`](agent-guide.md). Архитектура ботов: [`trading-bots.md`](trading-bots.md).

## 1. Что это за приложение

Nexter — личный финансовый учёт владельца. Один пользователь, без публичной регистрации. Приложение объединяет:

- криптопортфель и журнал сделок;
- DEX-свопы через WalletConnect/Tangem (BSC и Ethereum);
- каталог токенов (База токенов), watchlist-группы и котировки;
- статистику и отчёты по FIFO;
- личные финансы в BYN;
- задачи, заметки, привычки;
- end-to-end зашифрованное хранилище паролей;
- импорт исторических данных из Notion;
- модуль бумажной торговли ботами с изолированным paper-ledger;
- независимая бумажная `Песочница` (`@nexter/sandbox-core`): живые прогоны, исторические прогоны с графиком действий, PDF/JSON-отчётами и выбранными токенами из `Избранного`;
- AI-настройки DeepSeek и аудиозаметки из Viber (отдельный `Nexter.Bot`);
- настраиваемый лимит аудио 1–20 МБ (по умолчанию 8 МБ).

Старый модуль `ИИ-торговля` и бэктест роботов удалены из кода и интерфейса (ADR 0090). Таблицы `ai_*` и `bot_backtest_runs` остаются в базе как исторические и не используются; удаление — отдельная destructive-миграция с бэкапом.

Приложение не является биржей, кастодиальным сервисом или налоговым калькулятором. Оно не хранит приватные ключи и seed-фразы. Все подписи выполняются в кошельке владельца.

Текущее состояние (2026-11-26): один API-сервис + Postgres (worker удалён), production `da8ea6a`, deployment `40d10d93-6e3d-4324-b5c4-12f76a07cee8`, 56 миграций (включая `0055`, переименовавшую группу `Основная` → `Избранное`), bundle `assets/index-COlw10cX.js`; `/health`/`/ready` 200. Свопы используют исправление газа из ADR 0092: build/ready/approval возвращают буферизованный `gasLimit`, кошелёк передаёт его как hex `gas`; неудачный XNY→USDC ордер остался `FAILED`, проверять нужно новым ордером. Восстановление зависших подписей (ADR 0093): через 90 секунд появляется ручной ввод хеша, а `Крипта → Ордера` показывает недавние `AWAITING_SIGNATURE` и отменённые ордера с подписанной сборкой; POP-ордер ждёт привязки хеша `0xfc69a3…9eb1`. TOTP replay и append-only audit trigger включены, аудио-лимит настраивается в `Настройки → ИИ → Аудио`. Раздел `Крипта` — один пункт меню с шестью вкладками: `Обзор`, `Токены`, `Ордера`, `Операции`, `Роботы`, `Статистика`. Справочник стратегий перенесён в `Настройки → Стратегии`. `Песочница` остаётся paper-only; шесть запусков `running` (пять Stage 3 + Quack AI), ручной старт роботов и прогонов — только за владельцем.

## 2. Технологический стек

| Слой            | Технологии                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Монорепозиторий | pnpm 10.20, TypeScript strict                                                                                     |
| API             | NestJS 11, Fastify 5, Drizzle ORM, PostgreSQL 17/18, Zod, Pino, Sentry                                            |
| Web             | React 19, TanStack Router, TanStack Query, Tailwind CSS 4, Vite                                                   |
| Тесты           | Vitest (unit/integration), Supertest, Playwright (E2E)                                                            |
| Деньги          | PostgreSQL `numeric`, `decimal.js`, строки в API                                                                  |
| Фоновые задачи  | Интервальные сервисы API под advisory locks (котировки, снапшоты, индексер, swap tracker, боты, песочница, audio) |
| Деплой          | Railway (API + Postgres), Dockerfile; Viber-бот — отдельный проект                                                |
| Бэкапы          | `pg_dump` custom format + AES-256-GCM, restore drill                                                              |

## 3. Структура репозитория

```text
apps/
  api/        NestJS API; также раздаёт собранный SPA из apps/web/dist
  web/        React SPA
  e2e/        Playwright acceptance tests
packages/
  contracts/  Zod-схемы и TypeScript-типы API (единый контракт web/api)
  db/         Drizzle schema, миграции, скрипты backup/restore/provision
  ui/         общие UI-компоненты (если используются)
  config/     общий tsconfig/конфигурация
docs/
  project/    эта документация
  adr/        архитектурные решения
  runbooks/   операции, восстановление, деплой, импорт
  decisions.md история продуктовых/архитектурных решений
```

### 3.1. Поток запроса

```text
Браузер (React SPA)
  → HTTPS /api/v1/*
  → Fastify + NestJS guards/interceptors
  → controller → service → Drizzle → PostgreSQL
  → JSON (Zod-контракт)
```

SPA и API живут на одном origin в production. Cookie-сессия (`HttpOnly`) + CSRF-токен (`nexter_csrf`) защищают мутации. Swagger доступен только при `ENABLE_DOCS=true` и `NODE_ENV=development/test` по `/api/docs`.

## 4. Основные подсистемы

| Подсистема          | Назначение                                             | Ключевые таблицы                                                                                                                      |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                | Вход, TOTP, сессии, CSRF, rate limit                   | `users`, `sessions`, `rate_limits`                                                                                                    |
| Accounting          | Счета, транзакции, проводки, FIFO-лоты, сделки         | `accounts`, `transactions`, `postings`, `lots`, `lot_consumptions`, `trade_groups`, `trade_details`                                   |
| Portfolio/Dashboard | Позиции, оценка, P&L, снапшоты, графики                | `assets`, `market_quotes`, `portfolio_snapshots`                                                                                      |
| Market data         | DexScreener/CoinGecko, кэш иконок, refresh             | `market_quotes`, `assets`                                                                                                             |
| Watchlist           | База токенов, группы, контракты, метаданные            | `watchlist`, `watchlist_groups`, `assets`                                                                                             |
| Swap                | KyberSwap quote/build/simulate, WalletConnect, трекинг | `swap_orders`, `swap_order_close_groups`, `swap_events`, `token_approvals`                                                            |
| Imports             | Notion legacy import, staging, preview/commit/rollback | `imports`, `import_rows`                                                                                                              |
| Reports             | Периоды, realized P&L, статистика, CSV                 | вычисляется из accounting                                                                                                             |
| Finance             | BYN-модуль: счета, категории, операции, переводы       | `finance_accounts`, `finance_categories`, `finance_transactions`, `finance_transfers`                                                 |
| Tasks/Notes/Habits  | Личные задачи, журнал, привычки                        | `tasks`, `task_images`, `notes`, `note_images`, `habits`                                                                              |
| Vault               | E2E-шифрование паролей в браузере                      | `vault_configs`, `vault_items`                                                                                                        |
| Reconciliation      | Read-only сверка с on-chain                            | `watched_addresses`, `indexed_transfers`, `reconciliation_runs/items`                                                                 |
| Audit               | Журнал всех мутаций                                    | `audit_log`                                                                                                                           |
| Trading bots        | Бумажная торговля встроенными стратегиями              | `trading_bots`, `bot_tokens`, `bot_positions`, `bot_trades`, `bot_equity_snapshots`, `bot_events`, `bot_quote_samples`, `bot_signals` |
| Sandbox             | Независимая paper-песочница и исторические прогоны     | `sandbox_tokens`, `sandbox_runs`, `sandbox_events`, `sandbox_replays`, `sandbox_candles`                                              |

## 5. Ключевые принципы

1. **Один владелец.** Нет публичной регистрации. Все данные owner-scoped.
2. **Деньги — только строки/`numeric`.** В TS использовать `decimal.js`; не приводить деньги к `number`.
3. **Ledger append-only.** Исправления — новые транзакции, а не редактирование старых. Ручные операции и импорт пишут проводки и лоты.
4. **Каждая мутация аудируется.** `audit_log` пишется в той же транзакции, где меняются данные.
5. **Никаких приватных ключей/seed на сервере.** Подпись — только в кошельке владельца.
6. **Единый источник цен.** `market_quotes` (DexScreener 60с / CoinGecko 10мин) → `PricingService` → portfolio/dashboard/trades/watchlist. Не создавать отдельные источники цен без ADR.
7. **Русский UI, английский код.** Идентификаторы и комментарии — English; тексты интерфейса — Russian.
8. **Схема меняется только через ADR + миграцию.** Миграции аддитивные, с бэкапом и restore-проверкой.
9. **Секреты не попадают в репозиторий/логи.** Env-переменные, ключи, токены — только в Railway/локальном `.env`.
10. **Сначала preview, потом commit.** Импорт и опасные операции показывают preview/итоги; destructive-операции требуют подтверждения.

## 6. Быстрый локальный запуск

```bash
npx pnpm@10.20.0 install
npx pnpm@10.20.0 build:packages
npx pnpm@10.20.0 dev
```

Нужны `.env` (см. `apps/api/.env.example`, если есть) и PostgreSQL. Для production-подобной проверки:

```bash
npx pnpm@10.20.0 format:check
npx pnpm@10.20.0 lint
npx pnpm@10.20.0 typecheck
npx pnpm@10.20.0 test
npx pnpm@10.20.0 test:e2e
npx pnpm@10.20.0 build
```

## 7. Где искать ответы

| Вопрос                                  | Документ                                   |
| --------------------------------------- | ------------------------------------------ |
| Как устроены модули и потоки данных     | [`architecture.md`](architecture.md)       |
| Какие таблицы и связи                   | [`data-model.md`](data-model.md)           |
| Какие есть API-эндпоинты                | [`api.md`](api.md)                         |
| Как деплоить, бэкапить, восстанавливать | [`operations.md`](operations.md)           |
| Модель угроз и ограничения              | [`security.md`](security.md)               |
| Что делать при типовых ошибках          | [`troubleshooting.md`](troubleshooting.md) |
| Как агенту безопасно менять код         | [`agent-guide.md`](agent-guide.md)         |
| Архитектура торговых ботов              | [`trading-bots.md`](trading-bots.md)       |
