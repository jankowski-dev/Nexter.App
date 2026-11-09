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

- Fields: title, description, status (`open`/`done`/`cancelled`), priority 0–3, due date, completion time, optional related asset, archive timestamp.
- API: `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`.
- UI: `/tasks` with status filters, search, create/edit dialog, complete/reopen, and archive.
- Completing sets `completedAt`; reopening clears it.

## Notes

- Fields: title, body, tags, pinned flag, optional related asset/trade group, archive timestamp.
- API: `GET /notes`, `POST /notes`, `PATCH /notes/:id`.
- UI: `/notes` with search, create/edit dialog, pin, and archive.
- Plain text rendering; no Markdown parser and no HTML injection.

## Database

Migration `0019_remarkable_songbird.sql` adds:

- `vault_configs` (unique per user).
- `vault_items` (owner-scoped ciphertext).
- `tasks`.
- `notes`.

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
- List caps (500 vault items, 200 tasks/notes by default) are not surfaced as a truncation indicator in the UI.
- Vault ciphertext is authenticated but not bound to item id/user id with AAD; a party controlling the database could swap ciphertexts between items.
