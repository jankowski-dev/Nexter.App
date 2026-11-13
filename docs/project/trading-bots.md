# Trading bots — бумажная торговля (UI-24)

> Статус: **реализовано и развёрнуто в production 2026-11-12**. Миграция `0032` применена после encrypted backup и restore-check. API live, bundle `assets/index-CJwbitFy.js`; paper-runner включён. Ботов пока не создано.
>
> Это paper-only система. Реальные свопы, подписи и приватные ключи не используются. Бумажные сделки не пишут в `transactions`/`postings` и не влияют на реальный ledger, отчёты и налоги.

## 1. Что умеет система

- Несколько независимых ботов; у каждого своя стратегия, бюджет, список токенов и риск-параметры.
- Боты работают на сервере по минутному тику, даже когда браузер закрыт.
- Виртуальные покупки/продажи по последним `market_quotes` с симулированными комиссией и проскальзыванием.
- Открытые позиции, история сделок, журнал событий, equity curve.
- Статистика: realized/unrealized/total P&L, cash/equity, profit factor, win rate, wins/losses, число сделок, max drawdown.
- Запуск/остановка, сброс бумажного состояния, архивирование.
- Стратегии — встроенный реестр алгоритмов; владелец создаёт экземпляр с названием, описанием и параметрами.

## 2. Границы v1

- **Paper only.** Нет реальных транзакций и подписей.
- **Long-only spot.** Без шортов, плеча, маржи и деривативов.
- **Minute tick.** Решение раз в 60 секунд по `market_quotes`; цена исполнения — последняя котировка с симулированным slippage.
- **Warm-up.** Индикаторам нужна история `bot_quote_samples`; при первом запуске первые сигналы обычно появляются через 20–30 минут (зависит от окон стратегии).
- **No backtest.** История начинается с первого запуска; исторический бэктест — отдельный будущий этап.
- **No arbitrary scripts.** Алгоритмы только в коде; параметры валидируются Zod-схемой стратегии.
- **Isolated tables.** `trading_bots`, `bot_*` не связаны с реальным ledger, кроме ссылок на `assets` и `users`.
- **Single tick source.** Цены берутся только из `market_quotes`; отдельного источника цен у ботов нет.

## 3. Компоненты

```mermaid
flowchart TB
  UI[Testing UI] --> API[TradingBots API]
  API --> StrategyRepo[bot_strategies / trading_bots]
  Runner[BotRunnerService 60s] --> StrategyRepo
  Runner --> Quotes[market_quotes]
  Runner --> Registry[Strategy registry]
  Registry --> Signal[StrategyDecision]
  Signal --> Paper[Paper execution in runner]
  Paper --> BotLedger[bot_positions / bot_trades]
  BotLedger --> Stats[stats / bot_equity_snapshots]
  Runner --> Events[bot_events]
  Runner --> Samples[bot_quote_samples]
  UI --> Stats
```

- `TradingBotsService` — CRUD, статистика, сброс/архив, аудит.
- `BotRunnerService` — интервальный сервис API; advisory lock, минутный тик, paper execution, snapshots, retention.
- `strategies/` — реестр из пяти алгоритмов и общие индикаторы.
- `market_quotes` — единственный источник цены и 24h change.
- `bot_quote_samples` — минутные точки для индикаторов; общие для всех ботов.

## 4. Модель данных

Все таблицы owner-scoped через `trading_bots.user_id`; дочерние таблицы каскадно удаляются вместе с ботом. `bot_strategies` удаляются только soft archive (`archived_at`).

### `bot_strategies`

| Поле                    | Тип         | Смысл                                   |
| ----------------------- | ----------- | --------------------------------------- |
| `id`                    | uuid        | PK                                      |
| `user_id`               | uuid        | owner                                   |
| `key`                   | text        | ключ алгоритма из registry              |
| `name`                  | text        | имя экземпляра, unique среди неархивных |
| `description`           | text        | описание                                |
| `version`               | int         | версия алгоритма                        |
| `params`                | jsonb       | валидированные параметры                |
| `archived_at`           | timestamptz | soft archive                            |
| `created_at/updated_at` | timestamptz |                                         |

`key` обязан существовать в registry на момент создания и запуска. Параметры проверяются Zod-схемой; неизвестный ключ или невалидные параметры дают `VALIDATION_ERROR`.

### `trading_bots`

| Поле                                 | Тип           | Смысл                                         |
| ------------------------------------ | ------------- | --------------------------------------------- |
| `id`                                 | uuid          | PK                                            |
| `user_id`                            | uuid          | owner                                         |
| `strategy_id`                        | uuid          | → `bot_strategies`                            |
| `name`                               | text          | unique среди неархивных                       |
| `description`                        | text          |                                               |
| `status`                             | text          | `draft`, `running`, `stopped`                 |
| `budget_usd`                         | numeric(24,8) | стартовый бюджет, неизменяемый после создания |
| `cash_usd`                           | numeric(24,8) | свободный бумажный кэш                        |
| `max_positions`                      | int           | максимум одновременно открытых позиций        |
| `position_size_pct`                  | numeric(5,2)  | % бюджета на одну покупку                     |
| `fee_bps`                            | int           | симулированная комиссия (25 = 25 bps)         |
| `slippage_bps`                       | int           | симулированное проскальзывание (10 = 10 bps)  |
| `max_daily_loss_pct`                 | numeric(5,2)  | дневной лимит реализованного убытка           |
| `cooldown_minutes`                   | int           | пауза между покупками по токену               |
| `peak_equity_usd`                    | numeric(24,8) | пик equity для max drawdown                   |
| `max_drawdown_pct`                   | numeric(5,2)  | максимальная просадка, обновляется runner     |
| `started_at/stopped_at/last_tick_at` | timestamptz   |                                               |
| `archived_at`                        | timestamptz   | soft delete                                   |
| `created_at/updated_at`              | timestamptz   |                                               |

Бюджет — от $100 и кратен $100 (шаг $100). `position_size_pct` — доля **бюджета** на одну покупку, а не доля свободного кэша; DCA/grid могут делать несколько покупок, пока хватает кэша и не достигнут `maxAdds` стратегии. Один экземпляр стратегии может использоваться несколькими ботами; изменение её параметров влияет на всех этих ботов.

### `bot_tokens`

`bot_id`, `asset_id`, `enabled`, `created_at`. `(bot_id, asset_id)` unique. Токены выбираются только из активной Базы токенов (`watchlist`); дубликаты отклоняются. Один токен может быть у нескольких ботов; paper-портфели независимы.

### `bot_positions`

`bot_id`, `asset_id`, `amount numeric(36,18)`, `avg_cost_usd`, `cost_basis_usd`, `opened_at`, `updated_at`. `(bot_id, asset_id)` unique. Учёт по средней цене (average cost), не FIFO. `cost_basis_usd` включает комиссию покупки.

### `bot_trades`

`bot_id`, `asset_id`, `side` (`buy`/`sell`), `amount`, `price_usd`, `usd_value`, `fee_usd`, `slippage_usd`, `realized_pnl_usd`, `reason`, `signal jsonb`, `executed_at`. `price_usd` — фактическая fill-цена с slippage. Для sell `realized_pnl_usd = net proceeds − cost_basis_usd`.

### `bot_equity_snapshots`

`bot_id`, `captured_at`, `cash_usd`, `positions_value_usd`, `equity_usd`, `realized_pnl_usd`, `unrealized_pnl_usd`. Снимок при каждой сделке и не реже одного раза в 5 минут. Retention — 1 год.

### `bot_events`

`bot_id`, `type` (`created`, `started`, `stopped`, `buy`, `sell`, `error`, `reset`, `archived`), `message`, `payload jsonb`, `created_at`. Retention — 90 дней.

### `bot_quote_samples`

`asset_id`, `price_usd`, `change_24h_pct`, `captured_at`. Одна точка на токен за тик (не чаще 55 секунд), общая для всех ботов. Retention — `BOT_SAMPLE_RETENTION_DAYS` (30 дней по умолчанию). Индексы: `(asset_id, captured_at)` и `(captured_at)` для очистки.

## 5. Стратегии

### 5.1. Интерфейс

```ts
interface StrategyContext {
  now: Date;
  params: Record<string, unknown>;
  priceUsd: string;
  change24hPct: string | null;
  history: Array<{ priceUsd: string; capturedAt: Date }>;
  position: { amount: string; avgCostUsd: string; costBasisUsd: string } | null;
  buyCount: number; // покупок после последней продажи по этому токену
}

interface StrategyDecision {
  action: 'buy' | 'sell' | 'hold';
  reason: string;
}

interface StrategyDefinition {
  key: string;
  version: number;
  name: string;
  description: string;
  defaultParams: Record<string, unknown>;
  parseParams(value: Record<string, unknown>): Record<string, unknown>;
  evaluate(ctx: StrategyContext): StrategyDecision;
}
```

Новая стратегия: файл в `apps/api/src/modules/trading-bots/strategies/`, Zod-схема параметров, регистрация в `strategyDefinitions`, unit-тесты и deploy. UI автоматически показывает новый шаблон.

### 5.2. Встроенные стратегии

| key                 | Название            | Логика входа                               | Логика выхода                                          | Параметры по умолчанию                                  |
| ------------------- | ------------------- | ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------- |
| `momentum_breakout` | Импульсный пробой   | fast SMA > slow SMA и 24h change ≥ порога  | тейк-профит, стоп-лосс, fast SMA ниже slow SMA         | fast 5, slow 20, minChange24h 1%, TP 5%, SL 3%          |
| `mean_reversion`    | Возврат к среднему  | цена ниже SMA на `entryDropPct`            | возврат к SMA, TP, SL                                  | lookback 20, entryDrop 3%, exitAbove 0.5%, TP 5%, SL 5% |
| `grid_range`        | Сетка в диапазоне   | цена ниже rolling high на шаг сетки        | шаг вверх от средней, SL; докупка на следующей ступени | anchor 20, gridStep 1.5%, maxAdds 4, TP 1.5%, SL 6%     |
| `trend_pullback`    | Откат в тренде      | fast > slow и откат к fast SMA             | TP, SL, пробой тренда                                  | fast 8, slow 30, pullback 1%, TP 5%, SL 3%              |
| `dca_dip`           | Докупка на просадке | цена ниже rolling high/средней на `dipPct` | TP, SL; докупка до `maxAdds`                           | anchor 20, dip 3%, maxAdds 3, TP 5%, SL 8%              |

Все стратегии long-only и работают по одному токену независимо. Общий risk layer в runner: max positions, position size, cash, cooldown, daily loss limit, freshness quote (≤5 минут). В `grid_range` и `dca_dip` параметр `maxAdds` ограничивает общее число покупок в цикле, включая первую.

### 5.3. Как добавить новую стратегию

1. Создать `apps/api/src/modules/trading-bots/strategies/<key>.ts`.
2. Описать Zod-схему параметров с безопасными default-значениями и `evaluate(ctx): StrategyDecision`.
3. Добавить стратегию в `strategyDefinitions` в `strategies/index.ts`.
4. Добавить unit-тесты на buy/sell/hold и граничные параметры.
5. Прогнать `format`, `typecheck`, `lint`, `test`, `build`.
6. Задеплоить API. UI автоматически покажет новый шаблон в разделе `Стратегии`.
7. Создать экземпляр стратегии и бота. Существующие боты не меняются.

`key` — стабильный контракт. `version` фиксируется при создании экземпляра, но runner исполняет текущий код registry; обратно несовместимое изменение поведения лучше выпускать новым `key` или отдельной миграцией экземпляров. Любое изменение смысла параметров описывается в ADR/`docs/decisions.md`.

### 5.4. Paper execution

- **Buy:** `usd = min(budget * positionSizePct / 100, cash)`; `fillPrice = quote * (1 + slippageBps/10000)`; `amount = usd / fillPrice`; `fee = usd * feeBps/10000`; `debit = usd + fee`; cost basis увеличивается на `debit`. Позиция открывается только если `openPositions < maxPositions`; докупка существующей позиции не увеличивает счётчик позиций.
- **Sell:** продаётся вся позиция; `fillPrice = quote * (1 - slippageBps/10000)`; `gross = amount * fillPrice`; `fee = gross * feeBps/10000`; `net = gross - fee`; `realized = net - costBasis`; кэш увеличивается на `net`.
- **Cooldown / пауза после покупки:** блокирует только покупки по токену в течение `cooldownMinutes` после последней покупки; продажи и принудительное закрытие не блокируются.
- **Daily loss:** если реализованный убыток за локальный день ≥ `budget * maxDailyLossPct / 100`, новые покупки блокируются до следующих суток; продажи/стопы продолжают работать.
- **Quote freshness:** котировка старше 5 минут или цена ≤ 0 — токен пропускается на этом тике.
- **No quote:** токен пропускается; событие `error` не создаётся, чтобы не засорять журнал.
- **Fee/slippage** записываются в сделку; `slippage_usd` — разница между ценой без slippage и фактической fill-ценой.

### 5.5. Статистика

- `realizedPnlUsd` — сумма `realized_pnl_usd` по sell-сделкам.
- `unrealizedPnlUsd` — сумма `(currentPrice * amount − costBasis)` по открытым позициям; без котировки позиция даёт `null`, в сумму входит 0.
- `equityUsd = cashUsd + positionsValueUsd`.
- `totalPnlUsd = equityUsd − budgetUsd`.
- `grossProfitUsd`/`grossLossUsd` — только по sell-сделкам.
- `profitFactor = grossProfit / grossLoss`; `null`, если убытков не было.
- `winRate = wins / (wins + losses) * 100`; сделки с нулевым P&L не считаются ни победой, ни убытком.
- `maxDrawdownPct` — максимальная просадка; runner обновляет `peak_equity_usd`/`max_drawdown_pct` при каждом snapshot, поэтому статистика не зависит от лимита выборки.
- Equity chart в UI запрашивает последние 500 снимков (около 1,7 суток при 5-минутном интервале); all-time P&L и max drawdown при этом сохраняются.
- `tradesCount` включает buy и sell.

### 5.6. Отказ от бота

- **Остановить** — бот перестаёт тикать, открытые позиции и история сохраняются; можно запустить снова.
- **Закрыть позиции** — принудительно продаёт все открытые paper-позиции по последним известным котировкам с учётом комиссии и проскальзывания, фиксирует realized P&L, пишет сделки/события и останавливает бота. История сохраняется.
- **Сбросить** — удаляет paper-позиции, сделки и equity-снимки, возвращает кэш к бюджету. Это «начать заново», а не выход из позиций.
- **Архивировать** — скрывает бота; сервер не разрешает архив, пока есть открытые позиции. Сначала закройте их.
- Бумажные сделки при любом варианте не влияют на реальный ledger.
- Остановка бота и принудительное закрытие позиций создают запись в `notifications`; счётчик непрочитанных виден в главном меню, страница `/notifications` помечает их прочитанными.

## 6. Runner и надёжность

- `BotRunnerService` стартует через 5 секунд после boot API и затем каждые `BOT_RUNNER_INTERVAL_SECONDS` (60). Для индикаторов загружаются последние 300 минутных samples (покрывает максимальные окна стратегий).
- `BOT_RUNNER_ENABLED=true` по умолчанию; `NODE_ENV=test` отключает интервал.
- Тик защищён session-level Postgres advisory lock `nexter:bot-runner` на отдельном соединении из пула; вторая реплика/второй процесс пропускает тик. Unlock выполняется в `finally`; при ошибке соединение возвращается в пул после попытки unlock.
- Внутрипроцессный guard `running` предотвращает наложение тиков.
- Ошибка одного бота не останавливает остальных; пишется `bot_events.error`.
- `runOnce()` — публичный метод для тестов/ручного запуска; интервал вызывает его же.
- Retention: samples — `BOT_SAMPLE_RETENTION_DAYS` (30), events — 90 дней, equity — 365 дней. Очистка выполняется на каждом тике.
- При нескольких API-репликах advisory lock предотвращает дубли; per-bot lock не нужен, пока тик один.

## 7. API

Базовый путь: `/api/v1/trading-bots`. Все мутации требуют CSRF и аудируются.

| Метод  | Путь                        | Описание                                                   |
| ------ | --------------------------- | ---------------------------------------------------------- |
| GET    | `/strategies`               | шаблоны registry + созданные экземпляры                    |
| POST   | `/strategies`               | создать экземпляр (`key`, `name`, `description`, `params`) |
| PATCH  | `/strategies/:id`           | изменить имя/описание/параметры/архив                      |
| GET    | `/bots?includeArchived=`    | список ботов + статистика                                  |
| POST   | `/bots`                     | создать бота                                               |
| GET    | `/bots/:id`                 | детали: бот, стратегия, токены, позиции                    |
| PATCH  | `/bots/:id`                 | настройки; только не-running                               |
| POST   | `/bots/:id/start`           | запуск                                                     |
| POST   | `/bots/:id/stop`            | остановка (позиции сохраняются)                            |
| POST   | `/bots/:id/close-positions` | закрыть все позиции по текущим котировкам и остановить     |
| POST   | `/bots/:id/reset`           | сброс paper-состояния к бюджету (история удаляется)        |
| DELETE | `/bots/:id`                 | soft archive (только без открытых позиций)                 |
| GET    | `/bots/:id/trades?limit=`   | сделки                                                     |
| GET    | `/bots/:id/events?limit=`   | журнал                                                     |
| GET    | `/bots/:id/equity?limit=`   | equity curve                                               |

Ошибки: `VALIDATION_ERROR`, `CONFLICT`, `NOT_FOUND`. Уникальность имени бота/стратегии — `CONFLICT`. Running-бот нельзя редактировать; стратегию с running-ботами нельзя архивировать. Архивированную/недоступную стратегию нельзя запустить.

Аудит: `bot.strategy_created`, `bot.strategy_updated`, `bot.created`, `bot.updated`, `bot.started`, `bot.stopped`, `bot.positions_closed`, `bot.reset`, `bot.archived`. Бумажные сделки и события живут в `bot_trades`/`bot_events`, а не в `audit_log`.

## 8. UI

- Top-level пункт **Тестирование** (`/testing`).
- Табы **Роботы** и **Стратегии**.
- Роботы — full-width карточки: имя, статус, стратегия, описание, бюджет, equity, P&L, profit factor, win rate, число сделок, открытые позиции; fan крутится у running-ботов.
- Создание/редактирование: имя, описание, стратегия, токены из Базы токенов, бюджет $1000 с шагом $100, max positions, position size %, fee/slippage bps, daily loss %, cooldown.
- Drawer бота: equity chart, открытые позиции с текущей ценой/P&L, сделки, журнал событий, start/stop/reset/archive.
- Стратегии: шаблоны registry и созданные экземпляры; создание из шаблона, редактирование параметров JSON, архив.
- Fan в шапке раздела и на карточках; live-refresh индикатор учитывает ключи `trading-bot*`.

## 9. Безопасность и границы

- Нет приватных ключей, seed, подписи, WalletConnect и реальных свопов.
- Paper-сделки не создают `transactions`, `postings`, `lots`, `trade_groups`; реальный ledger и налоги не меняются.
- Все запросы owner-scoped; чужие боты/стратегии недоступны.
- Токены бота должны быть активными записями Базы токенов.
- Стратегии — только код; никакого исполнения пользовательских скриптов.
- Реальная автоторговля невозможна через WalletConnect/Tangem без ручного подтверждения каждой подписи. Для live нужен отдельный подписант/session key/AA, отдельный security review и ADR; сервер не должен хранить приватные ключи.

## 10. Ограничения и будущее

- Минутный тик — не HFT; стоп-лосс срабатывает с задержкой до 60 секунд.
- Paper fill не учитывает глубину пула; slippage фиксированный.
- Токены без котировки/свежести пропускаются.
- Нет исторического бэктеста; equity curve начинается с запуска.
- Нет уведомлений вне приложения; журнал событий внутри drawer.
- Будущий live-режим: отдельный `ExecutionVenue` adapter, allowlist, симуляция, лимиты, kill switch, аудит и подписант на стороне владельца. До этого боты остаются paper.

## 11. Проверка

- Unit: `apps/api/src/modules/trading-bots/strategies/strategies.spec.ts` — реестр, параметры, buy/sell/hold для пяти стратегий.
- E2E: `apps/api/test/trading-bots.e2e.spec.ts` — создание стратегии/бота, валидация бюджета, buy/sell по котировкам, статистика, reset, archive.
- Перед production: format, typecheck, lint, test, build; backup + restore check; миграция `0032`; проверка `/ready` и грантов `nexter_app`.

## 12. Production release (2026-11-12)

- Encrypted backup: `nexter-2026-11-12-ui24.dump.enc` (plaintext SHA-256 `ce8bd1a4…abe37`, encrypted SHA-256 `a17895a9…f64ac`), restore-check exact match on 28 metrics in `nexter_restore_check_ui24`; temporary DB dropped.
- PR #88 merged as `f4e806d`; deployment `d2e037be-d146-48d3-829a-61860c2512d2`; migration `0032` applied (33 migrations).
- Verification: `/ready` 200, `assets/index-CJwbitFy.js`, bot tables present, `nexter_app` CRUD on child tables, DELETE revoked on `bot_strategies`/`trading_bots`, authenticated `/testing` API requests return 200.
- `BOT_RUNNER_ENABLED` remains true; no bots created yet, so the runner has no trades to execute.
