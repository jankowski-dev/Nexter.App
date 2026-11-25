# Trading robots — paper trading

> Статус: 2026-11-25. Роботы — бумажная торговля встроенными стратегиями. Реальный ledger, кошельки и свопы не затрагиваются. Бэктест роботов удалён (ADR 0090); исторические прогоны теперь выполняются в `Песочнице`.

## 1. Что умеет система

- Создавать, запускать, останавливать и архивировать бумажных роботов.
- Вести изолированный paper-ledger: бюджет, кэш, позиции, сделки, equity.
- Применять встроенные стратегии с Zod-валидацией параметров.
- Показывать сигналы по каждому токену, журналы сделок/событий и телеметрию.
- Закрывать все позиции робота вручную и сбрасывать paper-состояние.
- Отправлять уведомления об остановке, принудительном закрытии и авто-остановке.

## 2. Границы

- Только виртуальные деньги; никаких реальных ордеров, подписей и переводов.
- Токены робота выбираются из активной группы `Избранное` Базы токенов.
- Бюджет — от $100 и кратен $100; бюджет неизменяем после создания.
- Running-робот не редактируется: сначала остановить.
- `bot_*` таблицы изолированы от `transactions`, `postings`, `lots`, `trade_groups`.
- Бэктест-движок, PDF-отчёт бэктеста, API `/backtests` и настройки `backtestDefault*` удалены. Таблица `bot_backtest_runs` остаётся исторической и не используется.

## 3. Компоненты

| Компонент                     | Ответственность                                               |
| ----------------------------- | ------------------------------------------------------------- |
| `TradingBotsController`       | CRUD, запуск/остановка, позиции, журналы, сигналы, телеметрия |
| `TradingBotsService`          | Бюджет, позиции, сделки, статистика, аудит                    |
| `BotRunnerService`            | Тик раз в 60 секунд под advisory lock, котировки, исполнение  |
| `BotTelemetryService`         | Read-only JSON schema-v1 для внешнего анализа                 |
| `TradingNotificationsService` | In-app уведомления о событиях робота                          |
| `SettingsService`             | Runtime-настройки роботов (тик, лимиты, дефолты)              |

Фоновые задачи выполняются внутри API под advisory lock; отдельного worker-процесса нет.

## 4. Модель данных

Основные таблицы: `trading_bots`, `bot_tokens`, `bot_positions`, `bot_trades`, `bot_equity_snapshots`, `bot_events`, `bot_quote_samples`, `bot_signals`.

- `trading_bots` хранит `strategy_key`, `strategy_params`, бюджет, статус, `origin`, `ai_profile_id`, `ai_candidate_id`, `evaluation_timeframe`, `strategy_source`, иконку и описание. Поля `ai_*`/`origin` остаются для исторических записей; новые роботы создаются с `origin='manual'`.
- `bot_tokens` — выбранные токены; удаление токена из Базы токенов не удаляет открытую позицию робота.
- `bot_positions`/`bot_trades` — average-cost paper-позиции и закрытые сделки.
- `bot_equity_snapshots` — точки equity для графика.
- `bot_events` — журнал событий робота.
- `bot_signals` — последнее решение по каждому токену и `strategy_state` для stateful-стратегий.
- `bot_backtest_runs` — историческая таблица старых бэктестов, код её больше не читает и не пишет.

## 5. Стратегии

Стратегии — код-реестр в `apps/api/src/modules/trading-bots/strategies`; отдельных пользовательских экземпляров и CRUD нет. Параметры хранятся в каждом роботе и валидируются Zod. Read-only справочник с описанием, гайдом, рисками и параметрами доступен в `Настройки → Стратегии`.

Registry включает трендовые, возвратные, сеточные, пробойные и stateful-стратегии: `momentum_breakout`, `mean_reversion`, `grid_range`, `trend_pullback`, `dca_dip`, `trailing_stop`, `crash_protected_grid`, `failed_breakout`, `static_limit`, `donchian_breakout`, `bollinger_reversion`, `squeeze_breakout`, `daily_average`, `adaptive_regime`. Полный список с параметрами всегда показывает API `GET /trading-bots/strategies`; страница Settings использует его же.

`static_limit` работает с абсолютными `buyPriceUsd`/`stopPriceUsd`/`takeProfitPriceUsd`, требует ровно один токен и после выхода ждёт восстановления цены выше лимита. `adaptive_regime` использует дневные SMA/ATR и состояния DORMANT/UPTREND/PULLBACK/COOLDOWN.

## 6. Paper execution

- Цена берётся из `market_quotes`; котировка старше `botQuoteMaxAgeSeconds` пропускается.
- Покупка/продажа исполняется по текущей цене с комиссией и slippage из настроек робота.
- Позиции усредняются по средней цене; продажа уменьшает количество и считает realized P&L.
- Стоп-лосс/тейк-профит проверяются по параметрам стратегии; stateful-стратегии сохраняют состояние в `bot_signals.strategy_state`.
- Принудительное закрытие всех позиций останавливает робота и пишет аудит/уведомление.
- Повторный запуск после остановки продолжает с текущего paper-состояния; `reset` возвращает бюджет и очищает paper-историю.

## 7. Runner и надёжность

- Один тик раз в 60 секунд; `pg_try_advisory_lock('nexter:bot-runner')` не даёт запустить два тика.
- Тик пропускается, если робот не running, котировка отсутствует/старая или дневной лимит убытка достигнут.
- Сделки и события пишутся в одной транзакции; ошибка тика сохраняется в `bot_events` и уведомлениях.
- `GET /trading-bots/bots/:id/telemetry` отдаёт read-only JSON schema-v1 (конфиг, токены, позиции, сделки, события, equity, котировки) для внешнего анализа.
- Health/invalidation мониторинга ИИ-роботов больше нет; телеметрия остаётся.

## 8. API

| Метод  | Путь                                                 | Назначение                              |
| ------ | ---------------------------------------------------- | --------------------------------------- |
| GET    | `/trading-bots/strategies`                           | read-only registry стратегий            |
| GET    | `/trading-bots/bots`                                 | список роботов (включая архив по флагу) |
| POST   | `/trading-bots/bots`                                 | создать черновик робота                 |
| GET    | `/trading-bots/bots/:id`                             | детали робота                           |
| PATCH  | `/trading-bots/bots/:id`                             | настройки (только не-running)           |
| POST   | `/trading-bots/bots/:id/start`                       | запуск                                  |
| POST   | `/trading-bots/bots/:id/stop`                        | остановка                               |
| POST   | `/trading-bots/bots/:id/close-positions`             | закрыть все позиции                     |
| POST   | `/trading-bots/bots/:id/reset`                       | сброс paper-состояния                   |
| DELETE | `/trading-bots/bots/:id`                             | архив + очистка телеметрии              |
| GET    | `/trading-bots/bots/:id/trades?limit=&offset=`       | сделки                                  |
| GET    | `/trading-bots/bots/:id/events?limit=&offset=`       | события                                 |
| GET    | `/trading-bots/bots/:id/equity?limit=&offset=&days=` | equity curve                            |
| GET    | `/trading-bots/bots/:id/signals`                     | последние сигналы по токенам            |
| GET    | `/trading-bots/bots/:id/trade-summaries`             | P&L по токенам                          |
| GET    | `/trading-bots/bots/:id/telemetry`                   | JSON schema-v1                          |

Аудит: `bot.created`, `bot.updated`, `bot.started`, `bot.stopped`, `bot.positions_closed`, `bot.reset`, `bot.deleted`. Бумажные сделки и события живут в `bot_trades`/`bot_events`, не в `audit_log`.

## 9. UI

- `Крипта` — шесть вкладок: `Обзор`, `Токены`, `Ордера`, `Операции`, `Роботы`, `Статистика`.
- `Роботы`: сортировка по P&L/капиталу/профит-фактору, создание/редактирование, карточки, детальный drawer с сигналами, журналами, equity и `Телеметрией`.
- Кнопки `Тестировать` и drawer бэктеста удалены.
- `Настройки → Роботы` содержит тик, возраст котировки и дефолты нового робота; бэктест-дефолтов больше нет.
- `Настройки → Стратегии` — read-only справочник.

## 10. Безопасность и ограничения

- Нет реальных ордеров, ключей, seed-фраз и подписей.
- Все запросы owner-only; мутации требуют CSRF и аудируются.
- `nexter_app` не имеет DELETE на `trading_bots`; удаление — archive + purge дочерних строк под bot-runner lock.
- Бюджет и лимиты проверяются на сервере, не только в UI.
- Бэктест удалён; для исторической проверки стратегий используйте `Песочницу → Прогон`.

## 11. Проверка

```bash
npx pnpm@10.20.0 --filter @nexter/api test -- trading-bots
npx pnpm@10.20.0 --filter @nexter/web test -- testing
npx pnpm@10.20.0 typecheck
```

DB-backed e2e (`apps/api/test/trading-bots.e2e.spec.ts`) выполняется в CI с `NEXTER_TEST_DB=1`.
