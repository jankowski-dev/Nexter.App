# ADR 0065 — Configurable audio upload limit

## Status

Accepted. 2026-11-17. Migration `0044` is additive and must be applied before deploying the API build that reads `settings.audio_max_mb`. Supersedes the fixed audio limits in ADR 0061.

## Context

The Viber audio-note path was sized for short voice messages: the bot rejected files over 2.4 MB, the API contract capped `audioDataUrl` at 3.5 million characters, and Fastify used a global 4 MB body limit. The owner now wants to upload audio files larger than 2 MB (default target: 8 MB) and change the limit later without a deploy.

Base64 inflates the binary by roughly 4/3, and the JSON body also carries the data-URL prefix, transcript (up to 50k characters) and metadata. A fixed character cap and a global body limit therefore drift easily. The limit must be per-owner (this is a single-owner app), persisted, audited, editable in the UI, and enforced before the API stores the attachment.

## Decision

### Setting

- Add `settings.audio_max_mb` (integer, `NOT NULL DEFAULT 8`) with a database check constraint `1 <= audio_max_mb <= 20`.
- Contract constants live in `@nexter/contracts`: default `8`, minimum `1`, maximum `20`.
- `PATCH /api/v1/settings` accepts an optional integer `audioMaxMb` in the same range; `GET /api/v1/settings` returns it. The existing `settings.updated` audit row records the change, including `before` and the submitted `after`.
- Reads clamp the stored value defensively. The bot path caches the owner value for 30 seconds; a settings update invalidates the cache immediately. A multi-replica deployment could observe up to 30 seconds of staleness, which is acceptable for an upload limit.

### Effective limits

- Accepted binary size = `clamp(audioMaxMb, 1, 20) * 1024 * 1024`. The hard ceiling is 20 MB regardless of stored data.
- Contract `audioSize` maximum = the 20 MB hard ceiling.
- Contract `audioDataUrl` maximum = `4 * ceil(hardLimitBytes / 3) + 64` characters. The 64-character allowance covers `data:audio/...;base64,`; the actual configured limit is checked after decoding, not by character count.
- Maximum raw request body for this route = configured data-URL cap + 300,000 bytes for the transcript and JSON envelope.

### Enforcement

- Fastify keeps the existing 4 MB global body limit for every route. An `onRoute` hook raises `bodyLimit` only for `POST /api/v1/bot/audio-notes` to the bounded hard maximum (`AUDIO_HARD_MAX_REQUEST_BYTES`, roughly 28.2 MB for 20 MB binary + base64 + envelope).
- A route-level `onRequest` hook rejects an oversized `Content-Length` with `413 AUDIO_TOO_LARGE` before the body is parsed.
- After parsing, `AudioNotesService` checks both the reported `audioSize` and the decoded data-URL byte length against the configured limit. Either being above the limit returns `413 AUDIO_TOO_LARGE` with `{ maxMb, maxBytes }`.
- `AUDIO_TOO_LARGE` is whitelisted in `AllExceptionsFilter` and mapped to a Russian message in the web error map. The Viber bot receives the same contract error envelope.
- No other route accepts unbounded bodies: the global limit remains 4 MB, and the Notion import parser keeps its own explicit 10 MB limit.

### UI

`Настройки → ИИ` gains an `Аудио` card with a number input (`1`–`20`, step `1`), a `Сохранить лимит` action, an unsaved-changes indicator and the last update time. It uses the existing general settings query and `PATCH /settings`, so it follows the page's explicit-save behavior and the existing audit path. Client validation repeats the server range before sending.

### External bot

`jankowski-dev/Nexter.Bot` had its own 2.4 MB download guard. It is updated in commit `79cb874`: `MAX_AUDIO_MB` defaults to `8`, is clamped to `1`–`20`, and is deployed as `20` in production. The bot therefore accepts up to the API hard ceiling and the API setting is the effective limit. The bot's README documents that `MAX_AUDIO_MB` must not be lower than the API setting if the API is raised above 20. No new Railway environment variable is required for the API: the limit lives in the database and is read through `/settings`.

### Migration and rollback

Migration `0044` is additive:

- `ALTER TABLE settings ADD COLUMN audio_max_mb integer DEFAULT 8 NOT NULL;`
- `ALTER TABLE settings ADD CONSTRAINT settings_audio_max_mb_range CHECK (audio_max_mb >= 1 AND audio_max_mb <= 20);`

Existing rows receive `8`; table-level grants for `nexter_app` already cover the new column. Rollback is a redeploy of the previous build; the column may stay (the old code ignores it) or be dropped with the constraint in a forward fix. No ledger, swap, bot or note data is rewritten.

## Consequences

- Audio up to 8 MB works by default; the owner can raise it to 20 MB without a deploy.
- Oversized requests fail with a stable code and details instead of a generic parser error or an opaque attachment failure.
- The API can receive a ~28 MB request only on the bot audio route; all other routes stay at 4 MB.
- An upload is stored as a base64 data URL in `note_audio`, so a 20 MB upload consumes roughly 27 MB in Postgres plus note/attachment overhead. The 20 MB hard ceiling bounds this growth.
- The Viber bot accepts up to the 20 MB hard ceiling; the API setting is the effective limit.

## Verification

- Contract unit tests cover clamping, derived base64/request caps, base64 byte counting and the 20 MB contract ceiling.
- A Fastify unit test verifies that only the audio route receives the raised body limit and that an oversized `Content-Length` returns `413 AUDIO_TOO_LARGE`.
- API e2e (when a disposable Postgres is available) verifies the default `8`, rejects `0`/`21`/non-integers, persists and audits a change, accepts a 900 KB file with a `1 MB` setting, rejects a 1.1 MB file and a falsely reported large `audioSize`.
- No production database or Railway service is touched by this change.
