# ADR 0019 — Password vault, tasks, and notes

## Status

Accepted for Phase 11 (2026-11-09).

## Context

Phase 11 adds the remaining personal modules: a password vault with end-to-end encryption, tasks, and notes. The application is single-owner, serves its own SPA from the API image, and must not introduce third-party analytics or trackers. The vault must never expose plaintext passwords, the master password, or the derived data key to the server.

## Decision

### Password vault

- **Client-side encryption.** The browser derives a master key from the master password with PBKDF2-SHA-256 (600,000 iterations, 16-byte random salt) and uses AES-256-GCM. A random 256-bit data key is generated in the browser and wrapped by the master key. Vault items are encrypted with the data key.
- **Server storage.** `vault_configs` stores the salt, iteration count, wrapped data key, and wrapping IV. `vault_items` stores only `ciphertext` and `iv` plus timestamps. The server never receives the master password, the derived master key, the unwrapped data key, or item plaintext.
- **Key rotation is deferred.** This slice does not expose a server key-replacement endpoint: the server cannot verify that a new wrapped key actually wraps the existing data key, so an accidental or malicious replacement would make every item undecryptable. A future rotation flow must perform the rewrap in the browser and require an explicit precondition/step-up.
- **Locking.** The data key lives only in page memory. Reloading or navigating away locks the vault. The page also has an explicit lock action.
- **No recovery.** The master password is not stored and cannot be reset by the server. Losing it means losing the vault items. This is stated in the UI before setup.
- **No server-side search or plaintext metadata.** Titles, usernames, URLs, passwords, and notes are all inside the encrypted JSON payload. The server returns items in update order; the browser decrypts and displays them.
- **Audit.** Vault mutations are audited by item id and archive state only. Ciphertext and plaintext are never written to the audit log.
- **Transport validation.** The API accepts base64 ciphertext/IV values with size caps and validates that ciphertext and IV are updated together. The server does not attempt to interpret the payload.
- **Item lifecycle.** Items are archived with `archivedAt`, not hard-deleted, consistent with the project's no-destructive-delete rule.

### Tasks and notes

- **Plaintext server-side modules.** Tasks and notes are not secrets in the vault sense. They are owner-scoped Postgres rows with normal API validation and audit.
- **Tasks** have title, description, status (`open`/`done`/`cancelled`), priority, due date, completion time, optional related asset, and archive timestamp. Completing a task sets `completedAt`; reopening clears it.
- **Notes** have title, body, tags, pinned flag, optional related asset/trade group, and archive timestamp. Search covers title, body, and tags. No Markdown rendering is added, so user text is displayed as plain text.
- **No financial effect.** Tasks and notes never create ledger transactions or alter accounting. Related asset/trade-group links are informational only.
- **Audit.** Create/update/archive actions are audited with metadata. Note bodies are not duplicated into the audit log.

### Data and rollout

- Migration `0019` is additive: four new tables (`vault_configs`, `vault_items`, `tasks`, `notes`) and indexes. No existing table or ledger row is changed.
- Routes: `/vault`, `/tasks`, `/notes`; API prefixes `/api/v1/vault`, `/api/v1/tasks`, `/api/v1/notes`.
- Navigation gains three owner-only modules after Reports.

## Consequences

- The server can store and return vault blobs but cannot recover or inspect them.
- A lost master password permanently loses the vault contents; there is no server-side reset.
- Vault unlock cost is dominated by PBKDF2 (about a second on typical hardware).
- Tasks and notes are protected by application auth and database access controls, but are not end-to-end encrypted.
- The vault starts empty and has no import from browser password managers in this slice.
- Security review is required because the vault is a sensitive feature.
