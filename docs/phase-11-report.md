# Phase 11 — Other modules

Status: implemented locally on 2026-11-09. Independent security review: PASS WITH CHANGES; all Medium findings fixed. Pending CI and merge.

## Scope

- End-to-end encrypted password vault.
- Tasks.
- Notes.
- Navigation and mobile layout for the new modules.

## Password vault

- Browser-only encryption: PBKDF2-SHA-256 (600,000 iterations) derives a master key; a random AES-256-GCM data key is wrapped by the master key; each item is encrypted with the data key.
- Server stores only the salt, iteration count, wrapped key, wrapping IV, item ciphertext, and item IV.
- The master password, derived master key, data key, and plaintext never reach the API.
- The vault locks on reload/navigation and has a manual lock action.
- No recovery: losing the master password loses the vault. The setup screen states this explicitly.
- Vault items are archived, not hard-deleted.
- Audit entries record vault/item ids and archive state only; ciphertext and plaintext are not audited.
- API: `GET /vault?includeArchived=`, `POST /vault/initialize`, `POST /vault/items`, `PATCH /vault/items/:id`.
- UI: `/vault` with setup, unlock, locked state, item cards, reveal/copy, generate password, edit, and archive.

## Tasks

- Fields: title, description, status (`open`/`done`/`cancelled`), priority 0–3, tags, due date, completion time, optional related asset, archive timestamp, recurrence (`daily`/`weekly`/`monthly`) and `seriesId`.
- Images: up to 5 per task in `task_images`, compressed in the browser, PNG/JPEG/WebP, max 1.5 MB after decoding.
- API: `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `POST/DELETE /tasks/:id/images`.
- UI: `/tasks` opens on the calendar; completed tasks stay visible and are green, active tasks are blue, overdue tasks are red. The compact list omits descriptions and row edit actions. Clicking a task opens a one-third-width view drawer with delete/complete/edit; creating/editing uses the same drawer with autosave and image upload. `Актуальные`/`Архивные` replaces the archive checkbox; delete is a confirmed soft archive. `GET /tasks` accepts `archivedOnly`.
- Completing sets `completedAt`; reopening clears it. Recurrence rows are generated occurrences, not an RRULE.

## Notes

- Fields: title, body, tags, pinned flag, optional related asset/trade group, archive timestamp.
- Images: up to 5 per note in `note_images`, compressed in the browser, PNG/JPEG/WebP, max 1.5 MB after decoding.
- API: `GET /notes` with `archivedOnly`, `offset`, `limit` (default 30) and `hasMore`; `POST /notes`, `PATCH /notes/:id`, `POST/DELETE /notes/:id/images`.
- UI: `/notes` is a journal. Cards show a notebook icon, title, dates, status, and right-side pin/delete/edit icons. Clicking opens a one-third-width side drawer in read mode; edit mode uses a lightweight Markdown editor with a slightly narrower text area and autosave every 10 seconds and on close. The save indicator sits in the footer left, opposite the actions. `Готово` saves and returns to read mode without closing. Photos have a full-screen viewer with arrows/Escape. Delete is a confirmed soft archive; `Актуальные`/`Архивные` filters and `Загрузить ещё` paginate 30 notes.
- Markdown rendering is a safe React subset (headings, lists, quotes, bold/italic/code, http/https links); no HTML is stored or injected.

## Crypto/habits overhaul (UI-12)

- Main dashboard combines crypto KPIs (month net P&L, positive/negative unrealized, equity), finance KPIs (average daily income/expense, month income/expense), today's tasks including overdue, and habit streaks. The finance page dashboard is unchanged.
- Reported page is renamed `Статистика`; detailed crypto statistics remain there.
- Portfolio tabs: positions, `Основной список` (default watchlist group with buy buttons), trades.
- Token-first buy/sell drawer: live `POST /swap/preview` every 10s, CoinGecko vs Kyber rate difference, one-click build/approval/sign, post-buy trade summary and automatic sell mode. Manual trade entry is separate.
- Single-trade close only, full or partial. Partial close uses FIFO within the selected trade group and keeps the remaining position.
- Trade tabs: active (default), profitable, losing, closed. Mass selection and mass close are removed.
- Manual operations dialog: exchange, deposit, withdrawal, income, adjustment. Manual exchange records a normal swap transaction and appears in the journal.
- On-chain exchange uses a dedicated automatic drawer.
- Live polling: positions/trades/dashboard every 10–15s; small prices use `formatPrice`.
- BNB/ETH header switch is a labeled segmented control with a clear active state.
- Background asset-logo backfill fills missing `assets.logo_url` from CoinGecko.
- `habits` table, API, dashboard form and streak cards; migration `0027`.

## Database

Migrations `0019_remarkable_songbird.sql` (vault/tasks/notes), `0020` (token base), `0021` (task recurrence), `0022` (task tags/images), `0023`–`0025` (personal finance), `0026` (note images), and `0027` (habits) are additive. `0019` adds:

- `vault_configs` (unique per user).
- `vault_items` (owner-scoped ciphertext).
- `tasks`.
- `notes`.

`0027` adds `habits` (`name`, `started_on`, `archived_at`) with a partial unique index on active names per user and a conditional DML grant for `nexter_app`.

All tables are additive; no existing table or ledger row is changed.

## Tests

- API `phase11.e2e.spec.ts`: vault setup, item archive/restore listing, ciphertext/IV pairing and base64-length validation, tasks lifecycle, notes search/update/archive, related-link validation, audit actions, and no ciphertext in audit.
- E2E `phase11.spec.ts`: vault setup, item creation, server-side plaintext absence, reload lock, wrong password, unlock, manual lock, navigation lock, lock-with-dialog clearing, generate-password, archive/restore, task create/complete, note create/search.
- Full API and E2E suites are run before merge.

## Security notes

- The vault threat model assumes the server or database may be read by an attacker; ciphertext alone does not reveal plaintext without the master password.
- PBKDF2 work factor is fixed at 600,000 for new vaults; existing configs carry their own iteration count.
- The server still sees access patterns and item counts/timestamps.
- Tasks and notes are not end-to-end encrypted; they rely on application auth and database controls.
- No third-party crypto, analytics, or network calls are added.

## Residuals

- Master-password rotation/re-wrap is deferred; no server key-replacement endpoint is exposed in this slice.
- No vault import/export, sharing, or recovery.
- Vault list is capped at 500 items (active by default; `includeArchived=true` uses the same cap).
- Vault item search is not implemented in this slice.
- List caps (500 vault items, 200 tasks by default) are not surfaced as a truncation indicator in the UI; notes paginate 30 at a time with `Загрузить ещё`.
- Vault ciphertext is authenticated but not bound to item id/user id with AAD; a party controlling the database could swap ciphertexts between items.
