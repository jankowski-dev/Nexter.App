# AI Trading — рекомендательный short-swing модуль (v0.2)

Статус: Phase 1–3 реализованы; Phase 4+ пересмотрены 2026-11-19. Автономный запуск роботов отменён.
Связанные документы:

- `docs/adr/0072-recommendation-only-short-swing.md` — актуальное архитектурное решение.
- `docs/adr/0071-ai-trading-control-center.md` — foundation: data/analyst/backtest, sandbox, audit.
- `docs/plans/ai-trading-schema-contracts-2026-11.md` — схема и контракты (обновляется под v0.2).

## 1. Продукт

Это **система поддержки решений**, а не автотрейдер.

Она:

- собирает рыночные данные;
- считает признаки и режим рынка;
- массово перебирает стратегии и параметры;
- проверяет варианты на purged walk-forward и финальном holdout;
- показывает прозрачную статистику;
- выдаёт рекомендацию с параметрами, горизонтом, TTL и условиями инвалидации;
- связывает рекомендацию с paper-роботом, которого владелец создаёт и запускает вручную;
- подсказывает, когда запущенного робота стоит остановить или пересмотреть.

Она **не**:

- создаёт и не запускает роботов автоматически;
- не принимает решения об изменении бюджета или параметров за владельца;
- не торгует реальными деньгами;
- не хранит ключи, seed-фразы и не подписывает транзакции.

## 2. Термины

- **Profile** — бюджет, лимиты, AI-вселенная, модель, расписание поиска.
- **Search Run** — один массовый поиск по токену, таймфрейму, горизонту и бюджету вариантов.
- **Candidate** — стратегия + параметры + токен + таймфрейм, прошедшая поиск и проверки.
- **Recommendation** — карточка кандидата с параметрами, TTL, аллокацией и условиями инвалидации.
- **WorkerBot** — paper-бот, созданный владельцем из рекомендации; одна стратегия + до 5 токенов + один timeframe.
- **Invalidation** — правило или событие, по которому система рекомендует остановить/пересмотреть робота.
- **Service** — детерминированный обработчик: Data, Analyst, Search/Backtest, Risk, Reporter.

## 3. Архитектура

```text
Рынок / GeckoTerminal / CoinGecko
        │
        ▼
┌──────────────────┐
│   Data Service   │  OHLCV, coverage, gaps, stale, source/quality
│  market_candles  │  1d / 4h / 1h / 15m
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Analyst Service  │  признаки + режим + AI-кандидаты
│   (DeepSeek)     │  только стратегии из реестра
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Search/Backtest  │  5 000 вариантов, purged walk-forward,
│     Service      │  8 фолдов, финальный holdout, статистика
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Risk Service   │  лимиты, аллокация, корреляция, издержки
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Recommendation  │  карточка + TTL + invalidation rules
└────────┬─────────┘
         │
         ▼
   владелец: «Создать робота» / «Отклонить»
         │
         ▼
┌──────────────────┐
│   Paper Bot      │  draft → owner start → signals/trades/equity
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Invalidation     │  рекомендации «остановить/пересмотреть»,
│    Monitor       │  без авто-стопа
└──────────────────┘
```

Правила:

- Сервисы не вызывают друг друга напрямую: обмен через БД/артефакты.
- Search Run идемпотентен по конфигу; повторный запуск не дублирует результаты.
- Все действия владельца и системы пишутся в audit log.
- Автоматика может выполнять только исследование/анализ/бэктест; исполнение — владелец.

## 4. UI

`ИИ-торговля`:

1. **Обзор** — бюджет, свободный капитал, активные рекомендации, ИИ-роботы, алерты, расходы ИИ.
2. **Рекомендации** — карточки/таблица, TTL, инвалидация, `Создать робота`, `Отклонить`.
3. **Поиск** — запуск массового поиска, прогресс, статистика, топ-варианты, экспорт.
4. **Мои ИИ-роботы** — paper-боты, созданные из рекомендаций; связь, здоровье, стоп/пересмотр.
5. **Данные** — покрытие, gaps, stale, source/quality, обновление.
6. **Настройки** — профиль, лимиты, бюджет поиска, модель, расписание.

`Крипта → Роботы` остаётся местом ручного создания/запуска paper-ботов. `Лаборатория` заменяется на `Поиск`.

## 5. Настройки профиля

- бюджет, cash buffer;
- AI-вселенная: отдельный список токенов;
- основные таймфреймы: `1h`, `4h`, `1d`; `15m` — только для уточнения входа;
- лимиты: max active AI bots, max allocation на робота, max token exposure, max invested;
- risk per trade, daily loss, max DD;
- max AI spend/day;
- persisted backtests/day (200) и search budget (до 5 000 вариантов на поиск, до 20 поисков/день);
- модель ИИ и timeout;
- расписание поиска/обзора (без авто-запуска роботов).

Auto-approve переключатели удалены: автономных действий больше нет.

## 6. Data Service

- OHLCV из GeckoTerminal/CoinGecko, `market_candles`;
- `source`, `quality` (`ok`/`synthetic`), coverage, gaps, duplicate/stale checks;
- минимальная ликвидность и объём;
- 1h история для поиска — до 180 дней (пагинация провайдера);
- 4h/1d — для режима и подтверждения;
- 15m — опционально, только для ликвидных токенов;
- 5m не входит в short-swing MVP.

## 7. Analyst Service

- детерминированные признаки: returns, volatility, drawdown, SMA/EMA, trend, volume/liquidity, regime, correlations;
- AI получает признаки и каталог стратегий;
- ответ — строгий JSON: regime, confidence, summary, 1–3 кандидата, warnings;
- стратегии и параметры валидируются реестром;
- fallback при недоступности ИИ;
- AI confidence не считается вероятностью прибыли.

## 8. Search/Backtest Service

Один Search Run:

```text
180 дней
├──────────── 150 дней поиска ────────────┤ 30 дней holdout
fold 1: train 60 → purge 2 → OOS 10
fold 2:        train 60 → purge 2 → OOS 10
...
fold 8:                         train 60 → purge 2 → OOS 10
```

- до 5 000 вариантов параметров;
- 8 фолдов; train 60 дней, purge 2, OOS 10, шаг 10;
- финальный 30-дневный holdout не участвует в выборе;
- для каждого варианта считаются агрегированные OOS-метрики и стабильность;
- фильтры: min trades, средний/медианный OOS > 0, худший фолд не ниже порога, DD, финальный holdout;
- поиск асинхронный: прогресс, ETA, отмена;
- 5 000 оценок — это search evaluations, не 5 000 сохранённых backtest artifacts.

Статистика:

- total/valid/rejected variants;
- best/avg/median/worst;
- % прибыльных вариантов/фолдов;
- OOS best/median/worst;
- train→OOS degradation;
- stability across folds;
- final holdout;
- top-N таблица;
- histogram returns/drawdowns;
- причины отклонения;
- сравнение с buy-and-hold и default params;
- конфиг поиска и data quality.

## 9. Recommendation

Рекомендация содержит:

- token, timeframe, strategyKey, params;
- entry/stop/take (если применимо);
- expected horizon 1–10 дней;
- suggested allocation;
- OOS/stability/holdout metrics;
- data quality;
- TTL (`expiresAt`);
- invalidation rules;
- searchRunId/candidateId;
- status: `proposed` / `accepted` / `rejected` / `expired` / `closed`.

`Создать робота` открывает prefilled draft. Робот не стартует автоматически. После старта сохраняется связь `recommendationId`/`candidateId`.

## 10. Invalidation

Монитор проверяет ИИ-роботов и выдаёт рекомендации, не останавливая их сам.

Красный — остановить:

- стоп/тейк;
- max DD / daily loss;
- stale/missing data;
- ошибка бота;
- стратегия нарушила свои правила.

Жёлтый — пересмотреть:

- истёк горизонт/TTL;
- сменился режим;
- деградация vs OOS;
- рост корреляции;
- рекомендация истекла, а бот работает.

UI робота показывает рекомендацию, горизонт, health и причины. Действия: `Остановить`, `Продлить наблюдение`, `Открыть поиск`.

## 11. Лимиты

| Лимит                |                Значение |
| -------------------- | ----------------------: |
| Active AI bots       |                      10 |
| Allocation на робота |                     25% |
| Token exposure       |                     20% |
| Max invested         |                     80% |
| Risk per trade       |                      1% |
| Daily loss           |   3% профиль / 5% робот |
| Max DD               | 10% профиль / 15% робот |
| AI spend             |                 $5/день |
| Persisted backtests  |                200/день |
| Search evaluations   |             5 000/поиск |
| Searches             |                 20/день |
| Stale candles        |            2× timeframe |
| Stale quotes         |                 5 минут |
| Loss cooldown        |                   1 час |
| Correlation          |                     0.8 |
| Reoptimization       | не чаще 1 раза в 7 дней |

## 12. Этапы

**Phase 1** — Control Center, profile, AI universe, service configs (done).
**Phase 2** — Data Service, `market_candles`, coverage UI (done).
**Phase 3** — Analyst, Backtest, Lab UI (done).
**Phase 4** — Search/Recommendation Engine, 5k variants, purged walk-forward, statistics; no auto bots.
**Phase 5** — Recommendation UI, manual bot creation, linkage.
**Phase 6** — Invalidation monitor, reports, monitoring.
**Phase 7** — Short-swing data expansion (1h up to 180 days), 15m optional.
**Phase 8** — Hardening; future real execution adapter remains a separate security project.

## 13. Безопасность

- Только sandbox/paper: реальные данные, виртуальные деньги.
- Нет кошельков, ключей, seed-фраз, подписи и реальных ордеров.
- Владелец вручную создаёт и запускает робота.
- Все действия — audit log.
- Real-mode — только через внешний signer/HSM/AA, approvals и TOTP, отдельным проектом.

**Phase 9** — Adaptive multi-stage search: fast screening of large proposal sets (necessary conditions + probabilistic markers), successive halving, local refinement around top candidates, and a held-out final evaluation. See `docs/plans/ai-adaptive-search-2026-11.md`.
