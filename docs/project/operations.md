# Операции и эксплуатация

## 1. Окружения и деплой

- Production: Railway project `generous-radiance`, API + worker + Postgres. API URL: `https://nexterapi-production.up.railway.app`.
- API собирается из `Dockerfile`; pre-deploy запускает `node packages/db/dist/migrate.js` с `MIGRATION_DATABASE_URL`.
- API раздаёт SPA из `apps/api/public`; Railway watch patterns API: `apps/api/**`, `apps/web/**`, `packages/**`.
- Worker собирается отдельно; watch patterns уже, worker не пересобирается на frontend-only изменения.
- Production API использует роль `nexter_app` (SELECT/INSERT/UPDATE, ограниченный DELETE). Worker использует owner-роль, потому что pg-boss делает DDL.
- `ENABLE_DOCS=true` включает `/api/docs` только в development/test.

## 2. Переменные окружения

Основные (см. `apps/api/src/shared/config/env.ts`):

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | подключение API к БД |
| `MIGRATION_DATABASE_URL` | pre-deploy миграции (owner/DDL) |
| `SETUP_TOKEN` | первичная настройка owner |
| `AUTH_ENCRYPTION_KEY` | шифрование TOTP/recovery/сессий |
| `APP_URL` | origin для cookie/CSRF/CORS |
| `SESSION_TTL_DAYS` | срок сессии |
| `ENABLE_DOCS` | Swagger |
| `SWAP_ENABLED` | включить swap-модуль |
| `SWAP_EXECUTION_ENABLED` | разрешить execution (BSC) |
| `SWAP_ETHEREUM_EXECUTION_ENABLED` | разрешить execution Ethereum |
| `SWAP_KILL_SWITCH` | аварийный стоп |
| `SWAP_STEP_UP_THRESHOLD_USD` | порог step-up TOTP |
| `SWAP_WALLET_ALLOWLIST` | разрешённые wallet addresses |
| `SWAP_ROUTER_ALLOWLIST` / `SWAP_EXECUTOR_ALLOWLIST` | allowlist контрактов |
| `MARKET_QUOTES_ENABLED` | фоновые котировки |
| `MARKET_QUOTE_INTERVAL_SECONDS` | DEX refresh (60) |
| `MARKET_QUOTE_COINGECKO_INTERVAL_SECONDS` | CoinGecko refresh (600) |
| `COINGECKO_API_KEY` | optional demo/pro key |
| `BSC_RPC_URL` / `ETHEREUM_RPC_URL` | RPC |
| `WALLETCONNECT_PROJECT_ID` | WalletConnect |
| `RECONCILIATION_ENABLED` | on-chain indexer |
| `PORTFOLIO_SNAPSHOTS_ENABLED` | daily snapshots |
| `BACKUP_ENCRYPTION_KEY` | только для backup/restore, не в API |

Секреты хранятся в Railway Variables и локальном `.env`, не в репозитории.

## 3. Миграции

```bash
npx pnpm@10.20.0 db:generate   # после изменения schema
npx pnpm@10.20.0 db:migrate    # локально
```

- Миграции аддитивные; destructive изменения требуют ADR, бэкапа и явного approval.
- Перед production-миграцией:
  1. сделать encrypted backup;
  2. проверить restore на временной БД;
  3. применить миграцию pre-deploy;
  4. проверить `/ready`, схему, гранты `nexter_app`;
  5. записать миграцию/бандл в `docs/decisions.md`.
- Production restore-проверка: `pg_restore` в `nexter_restore_check_*`, сравнить counts/sums, затем `dropdb`.

## 4. Бэкапы

```bash
DATABASE_URL=... BACKUP_ENCRYPTION_KEY=... BACKUP_OUTPUT_DIR=./backups \
  node packages/db/scripts/backup.mjs
```

- Формат: `NEXTER1 | IV | tag | ciphertext` (AES-256-GCM).
- Ключ вне репозитория (`~/.nexter/backup-key` локально; Railway secret в production).
- RPO 1 час, RTO 4 часа. Одноразовый дамп не заменяет расписание/PITR.
- Restore: stop writes → decrypt → `pg_restore` → verify counts/sums → switch traffic.
- Не хранить plaintext-дампы дольше проверки.

## 5. Мониторинг

- `/health` — процесс жив.
- `/ready` — БД доступна.
- Railway logs: pino JSON; искать `status=5xx`, `auth.rate_limited`, `SWAP_*`, `IMPORT_*`, `Market quote upsert failed`.
- Sentry: 5xx/неожиданные ошибки (секреты редактируются).
- `external_api_calls`: 429/5xx KyberSwap/CoinGecko.
- `swap_events`: state machine обменов.
- `audit_log`: бизнес-мутации.
- `/settings/data-quality`: negative balances, unverified assets, missing gas.

## 6. Feature flags и аварийные переключатели

- `SWAP_KILL_SWITCH=true` — остановить execution.
- `SWAP_EXECUTION_ENABLED=false` — запретить BSC execution.
- `SWAP_ETHEREUM_EXECUTION_ENABLED=false` — запретить Ethereum.
- `MARKET_QUOTES_ENABLED=false` — остановить refresher (котировки останутся последними).
- `RECONCILIATION_ENABLED=false` — остановить indexer.
- `PORTFOLIO_SNAPSHOTS_ENABLED=false` — остановить snapshots.

## 7. Rollback

- Frontend-only: redeploy previous image; миграции обычно аддитивные, могут остаться.
- API/worker: redeploy previous image; проверить `/ready` и ключевые страницы.
- БД: предпочтителен forward fix; restore только для destructive-миграции/инцидента.
- При rollback свопа: сначала drain active/unaccounted orders, затем менять image; иначе старый image не сможет корректно трекать Ethereum orders.

## 8. Регулярные проверки

- ежедневно: `/ready`, 5xx, auth anomalies, backup exists/plausible, no negative balances/unverified spike, confirmed swaps with null accounting.
- еженедельно: audit anomalies, quote freshness, provider 429 rate.
- ежеквартально: restore drill; review secrets/roles.

## 9. Известные эксплуатационные ограничения

- Worker использует owner role (pg-boss DDL).
- PITR/ежедневный cron бэкап — residual; настроить до go-live.
- In-memory rate limit/quote guard не масштабируется на несколько API-реплик; при масштабировании нужен Redis/Postgres advisory lock.
- Reconciliation не исправляет ledger автоматически.
- Native TRON/Solana — manual-only, не входят в swap/indexer.
