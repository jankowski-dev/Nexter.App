# Безопасность

## 1. Модель угроз

Приложение — single-owner, self-hosted. Основные риски:

- компрометация owner-аккаунта/сессии;
- кража приватных ключей/seed (в приложении их нет, но владелец может хранить их в vault);
- подмена calldata/адресов при свопе;
- ошибки импорта/ledger, портящие финансовые данные;
- утечка секретов через логи/репозиторий;
- XSS/CSRF/SSRF через пользовательские URL/Markdown/иконки;
- provider rate limits/DoS.

## 2. Ключевые меры

| Область | Меры |
|---|---|
| Auth | Argon2, TOTP, HttpOnly cookie, CSRF, rate limit, session rotation, recovery codes |
| Swap | allowlist кошельков/роутеров/executor/selectors, calldata decode, exact approvals, simulation, minOut, deadline, price impact cap, step-up TOTP, kill switch |
| Private keys | никогда не попадают на сервер; подпись только в кошельке |
| Money | `numeric`/Decimal, без float, проверка decimals/positive |
| Audit | каждая мутация, strict audit для критичных |
| Import | preview/commit/rollback, sourceHash, owner-scoped staging, no secrets in logs |
| Vault | E2E AES-256-GCM, PBKDF2 600k, мастер-пароль не сохраняется |
| Notes | Markdown subset без HTML, ссылки http/https, attachments allowlist + лимиты |
| Icons | SSRF allowlist CoinGecko hosts, timeout, content-type/size check |
| Logs | pino redaction, URLs без query, no bodies/secrets |
| Headers | Helmet, CSP, Permissions-Policy, no-store для API |
| CORS | same-origin SPA/API |

## 3. Swap security gates

Перед подписью сервер обязан проверить:

- chain/token/amount allowlist;
- `walletAddress` в allowlist;
- router/executor/selectors в allowlist;
- calldata decode: tokenIn/out, recipient, amount, minOut, fee, deadline, permit/partial fill;
- баланс и allowance;
- price impact ≤ `SWAP_MAX_PRICE_IMPACT_BPS`;
- gas ≤ `SWAP_MAX_GAS_USD`;
- quote TTL/deadline;
- step-up TOTP при сумме выше threshold;
- `SWAP_EXECUTION_ENABLED` для chain;
- kill switch.

Клиент не может обойти эти проверки: сервер заново проверяет build/ready/submit.

## 4. Vault

- Мастер-пароль не отправляется на сервер и не хранится.
- Data key случаен; обёрнут мастер-ключом.
- Сервер хранит только salt/iterations/wrapped key/IV/ciphertext.
- При потере мастер-пароля восстановления нет.
- Поиск по vault выполняется только в браузере после unlock.
- Не логировать plaintext/ciphertext/пароль; audit пишет только id/имя/размер.

## 5. Заметки и файлы

- Markdown безопасный: ссылки только http/https, HTML не рендерится.
- Вложения: allowlist MIME (images/PDF/TXT/DOC/DOCX/XLS/XLSX/RAR/ZIP), 1.5 MB, 5 шт.
- Data URL проверяется по MIME/размеру; не доверять имени файла.
- Файлы хранятся в Postgres (data URL); большие объёмы увеличат БД.

## 6. API/SSRF

- Icon proxy разрешает только `coin-images.coingecko.com`/`assets.coingecko.com`.
- Внешние URL карточек проверяются http/https; `javascript:`/`data:` отклоняются.
- Notion import body ограничен 10 MB и content-type.
- SQL только через Drizzle/параметры; raw SQL — с параметрами.

## 7. Секреты

- Не коммитить `.env`, токены, приватные ключи, seed, backup key.
- Не печатать значения в логи/скриншоты.
- При подозрении на утечку: rotate keys, revoke sessions, проверить audit/Sentry, restore при необходимости.
- `BACKUP_ENCRYPTION_KEY` хранится отдельно от дампов.

## 8. Ограничения

- WalletConnect/Tangem не даёт автоматической подписи; реальная автоторговля требует отдельного подписанта/AA и отдельного security review.
- Reconciliation read-only; не гарантирует полноту ledger.
- Native TRON/Solana manual-only.
- In-memory rate limit не распределён между репликами.
