# Troubleshooting

## 1. API не стартует / 502

1. Проверить Railway deployment logs.
2. `/health` и `/ready`.
3. `DATABASE_URL`, `SETUP_TOKEN`, `AUTH_ENCRYPTION_KEY`, `APP_URL` заданы.
4. Миграции применились; `nexter_app` имеет нужные гранты.
5. Нет ошибки `Chain ... is not seeded` (BSC/Ethereum обязательны; TRON/Solana optional).

## 2. 401/403/CSRF

- 401: сессия истекла/неверна; войти заново.
- 403 CSRF: отсутствует `x-csrf-token` или cookie `nexter_csrf`; проверить origin/APP_URL.
- 429: rate limit; подождать/проверить `auth.rate_limited` в логах.
- TOTP: проверить время на устройстве; recovery/reset.

## 3. Своп не проходит

| Симптом                                                        | Что проверить                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `SWAP_TOKEN_NOT_ALLOWED`                                       | token в swap allowlist                                            |
| `SWAP_WALLET_NOT_ALLOWED`                                      | wallet address в `SWAP_WALLET_ALLOWLIST`                          |
| `SWAP_EXECUTION_DISABLED` / `SWAP_ETHEREUM_EXECUTION_DISABLED` | env execution flag                                                |
| `SWAP_RATE_LIMITED`                                            | Kyber 429; подождать, проверить `external_api_calls`              |
| `SWAP_PROVIDER_UNAVAILABLE`                                    | Kyber/RPC down                                                    |
| `SWAP_BUILD_FAILED`/`SWAP_SIMULATION_FAILED`                   | маршрут/ликвидность/газ; попробовать другую сумму/пару            |
| `SWAP_PRICE_IMPACT_TOO_HIGH`                                   | сумма слишком большая для пула                                    |
| `SWAP_STEP_UP_REQUIRED`                                        | ввести TOTP                                                       |
| `SWAP_CLOSE_AMOUNT_MISMATCH`                                   | продажа больше остатка группы                                     |
| `SWAP_CLOSE_GROUP_BUSY`                                        | есть активный close order; дождаться/отменить                     |
| «Ожидаю ответ кошелька»                                        | отклонить в кошельке; нажать «Отменить ожидание»                  |
| `submit_failed`                                                | hash подписан; нажать «Повторить отправку», не подписывать заново |

## 4. Котировки/иконки

- Нет цены: токен без CoinGecko/DexScreener или ликвидность < $25k; fallback manual price.
- Устаревшая цена: `fetched_at`; CoinGecko 10 мин, DEX 60с.
- Иконка не грузится: `logoUrl` не CoinGecko host/404; fallback initials.
- Иконка «каждый раз грузится»: проверить `Cache-Control` `/watchlist/icon`; серверный кэш 24ч.
- `market_quotes` не обновляются: `MARKET_QUOTES_ENABLED`, logs `Market quotes refreshed`, provider 429.

## 5. Импорт Notion

- 409 «already committed»: тот же sourceHash уже импортирован.
- `IMPORT_CONFLICT`: изменился ledger после preview/частично consumed lot; re-preview.
- Control warning: для экспорта с ID > 466 исторический baseline не применяется; проверить preview totals (ADR 0032).
- 413/415: content-type `application/x-notion-import+json`, body < 10 MB.
- Rollback 409: есть более поздние транзакции/импорт; нужен compensating reversal/cutover.

## 6. Задачи/заметки

- Повторяющаяся задача: content/delete — вся серия; completion — per occurrence.
- `applyToSeries=false` для статуса/переноса одного дня.
- Вложения не добавляются: MIME/размер/5 шт; data URL cap.
- Заметка не открывает вложения: list возвращает count, detail — data; проверить `GET /notes/:id`.
- Vault: забыт мастер-пароль — восстановления нет.

## 7. Финансы

- Неверный net worth: проверить opening balances, credit liability, отменённые операции.
- Период пустой: даты inclusive и локальная timezone.
- Импорт: preview counts/totals, rollback только последний.

## 7.1. Trading bots

- **Бот запущен, но сделок нет:** нет свежей котировки (`market_quotes` старше 5 минут), недостаточно истории `bot_quote_samples` (SMA/grid/DCA ждут), сработал cooldown, дневной лимит убытка, `maxPositions` или `BOT_RUNNER_ENABLED=false`.
- **All bot tokens must be active entries in the token base:** токен архивирован/удалён из Базы токенов; верните его или измените список токенов бота.
- **`Bot strategy is archived or missing` / `not available in this deployment`:** стратегия архивирована или её key удалён из registry. Остановите бота, создайте новую стратегию/версию.
- **`Stop running bots before archiving their strategy`:** сначала остановите всех ботов на этой стратегии.
- **`A bot with this name already exists` / `A strategy with this name already exists`:** имена unique per user.
- **`Budget must be a multiple of 100 USD`:** бюджет от $100 и кратен $100.
- **Изменить настройки running-бота нельзя:** остановите бота; бюджет после создания не меняется, для нового бюджета создайте нового бота или reset (reset возвращает текущий бюджет).
- **Сброс:** удаляет paper-позиции/сделки/equity snapshots, возвращает cash к бюджету и переводит бота в `stopped`. События сохраняются; отменить reset нельзя.
- **Нет equity chart:** snapshots пишутся при сделках и раз в 5 минут; подождите тик или проверьте `bot_equity_snapshots`.
- **Bot runner не тикает:** проверьте `BOT_RUNNER_ENABLED`, логи API `Bot runner tick failed`, advisory lock (`pg_locks`), что API-реплика жива и `NODE_ENV!=test`.
- **Дубли сделок:** проверьте, что несколько API-реплик используют один Postgres advisory lock; вторая реплика должна пропускать тик.

## 8. Reconciliation

- `RECONCILIATION_ENABLED=false` — indexer выключен.
- RPC free tier `eth_getLogs` limit — уменьшить lookback/max blocks.
- MISMATCH/MISSING — ledger vs chain; не исправлять автоматически.

## 9. Тесты/CI

- Локально DB-тесты skipped без `NEXTER_TEST_DB=1`/Postgres; CI — авторитет.
- E2E требует Chrome/Playwright; CI использует `PLAYWRIGHT_CHANNEL=chrome`.
- Migration drift: `db:generate`, review SQL, snapshot/journal.
- Prettier CRLF warnings на Windows не блокируют CI (committed blobs LF).

## 10. Диагностика

- Settings → Audit (`/settings/audit`), фильтр `swap.`/`import.`/`task.`.
- `swap_events` — state machine.
- `external_api_calls` — Kyber/CoinGecko статусы.
- Railway logs — pino JSON.
- Sentry — 5xx.
- `settings/data-quality` — negative balances/unverified/missing gas.
