# AI module, audio notes and transcription — implementation plan

Status: proposed, reviewed 2026-11-16. No code or migrations yet.

## Goals

1. A first-class AI module that future features can use without importing DeepSeek directly.
2. Owner-only AI settings: provider, encrypted API key, model, reasoning/thinking mode, temperature, token limit, fallback, enable flag.
3. Audio notes: send a voice file to the Viber bot, transcribe it, summarize/structure it with AI, and create a clean note.
4. Keep audio private by default: local transcription, transient audio storage, explicit external-AI boundary.
5. Reuse notes, audit, notifications and `external_api_calls`; do not pretend there is a working general job queue.

## Critical validation before implementation

### Viber file delivery is unproven

Viber’s documented user→bot callback types do not guarantee voice/file delivery to a bot. The current bot only handles text. A file callback, if it arrives at all, has `media`, `file_name` and `file_size`; there is no audio type or MIME field. Media URLs expire (roughly one hour).

**Spike 1 (go/no-go):** send real Viber voice notes and audio files to the bot and log the raw callback. If they do not arrive, pivot the intake to an authenticated web upload (or another channel such as Telegram) before building the audio pipeline. Do not start migrations until this is settled.

### Whisper on Railway is unmeasured

`faster-whisper` must be tested on the actual bot service: CPU, memory, cold start and model download. Railway’s filesystem is ephemeral, so cache the model on a volume or bake it into the image. Start with `base`/int8 and fall back to `tiny` or a separate transcriber if needed.

### DeepSeek model names and controls must be read live

DeepSeek’s current models and thinking controls change. The model list must be configuration, not hardcoded guesses. Verify the current API model IDs and whether `thinking` / `reasoning_effort` / JSON mode are available at implementation time. Start with the current fast model; make the reasoning model opt-in.

## Recommended architecture

```text
Viber voice/file message (if supported)
        │
        ▼
Nexter.Bot (Python, Railway)
  - verifies sender == VIBER_USER_ID
  - returns HTTP 200 quickly, processes in a background thread/queue
  - downloads media over HTTPS from the expected host
  - detects audio by file_name + downloaded Content-Type
  - local faster-whisper transcription
  - POST transcript + message_token to API
        │  POST /api/v1/bot/audio-notes (BOT_API_TOKEN)
        ▼
Nexter API
  - idempotency by viber message token
  - AI module: summary + structure (DeepSeek), or raw fallback
  - creates the note in one transaction with the audio job update
  - returns note id/title
        │
        ▼
Nexter.Bot replies in Viber: "Заметка создана: <title>"
```

Processing is **synchronous in the API** for the first version: the bot posts a transcript, the API summarizes, creates the note and returns. If AI is slow, add an API interval processor using `FOR UPDATE SKIP LOCKED` + advisory lock (the pattern used by the bot runner), not pg-boss. The existing worker has no job handlers; claiming otherwise is wrong.

Transcription in the bot service avoids sending audio to the main API and avoids a new service. If Railway resources are insufficient, move it to a dedicated `transcriber` service with the same transcript-only contract.

## Components

### 1. AI module (`apps/api/src/modules/ai`)

- `AiModule` with `AiSettingsService`, `AiProviderRegistry`, `AiService`.
- Provider interface:
  ```ts
  interface AiProvider {
    key: string;
    testConnection(input: AiRequest): Promise<AiTestResult>;
    complete(input: AiRequest): Promise<AiResponse>;
  }
  ```
- First provider: `deepseek`, OpenAI-compatible endpoint, fixed base URL.
- Model IDs are a configurable allowlist. Reasoning mode maps to the model/thinking control that exists at implementation time, not a hardcoded assumption.
- Use JSON mode where supported (`response_format: { type: 'json_object' }`), include the word “json” and a schema example in the prompt, then validate with Zod.
- `AiService.summarizeNote(transcript)` returns:
  ```json
  {
    "title": "Короткий заголовок",
    "summary": "2–4 предложения",
    "body": "Markdown: Итог, Ключевые пункты, Задачи, Детали",
    "tags": ["..."],
    "language": "ru"
  }
  ```
- Timeout, max tokens, one retry on 429/5xx, per-purpose rate limit.
- Record provider/model/status/latency/token usage in `external_api_calls` and audit metadata; never log prompt or response text.
- Future features call `AiService.run({ purpose, input, schema })`.

### 2. AI settings (`Настройки → ИИ`)

New table `ai_settings` (one row per user, migration `0041`):

| column                | type          | notes                                                                |
| --------------------- | ------------- | -------------------------------------------------------------------- |
| user_id               | uuid PK/FK    | cascade                                                              |
| enabled               | boolean       | default false                                                        |
| provider              | text          | `deepseek`                                                           |
| model                 | text          | configurable allowlist                                               |
| reasoning             | text          | `fast` / `thinking` (source of truth is model + provider capability) |
| temperature           | numeric(3,2)  | 0–2, CHECK                                                           |
| max_tokens            | integer       | 256–8192, CHECK                                                      |
| fallback_to_raw       | boolean       | default true                                                         |
| api_key_encrypted     | text nullable | AES-256-GCM via exported `CryptoService`                             |
| created_at/updated_at | timestamptz   |                                                                      |

Use the existing `CryptoService.encryptSecret/decryptSecret`; **export it from AuthModule or move it to a shared crypto module** instead of creating a second instance. Add `api_key`/`api_key_encrypted` to pino redaction paths.

API (owner-only, CSRF):

- `GET /api/v1/settings/ai` — settings + `hasApiKey`, never the key;
- `PUT /api/v1/settings/ai` — provider/model/reasoning/temperature/maxTokens/fallback/enabled; optional `apiKey`; empty keeps current; explicit `clearApiKey` removes it;
- `POST /api/v1/settings/ai/test` — tiny request, returns latency/model/error;
- `DELETE /api/v1/settings/ai/key` — remove key.

Contracts, error-code whitelist (`all-exceptions.filter.ts`), Russian error messages, web API functions and router/settings card must be added through the normal plumbing. Add `BOT_API_TOKEN`/AI variables to `.env.example` and docs.

### 3. Audio jobs (`audio_notes` table, migration `0042`)

| column                | type             | notes                                       |
| --------------------- | ---------------- | ------------------------------------------- |
| id                    | uuid PK          |                                             |
| user_id               | uuid FK cascade  |                                             |
| viber_message_id      | text unique      | idempotency (`message_token`)               |
| status                | text             | `received`, `summarizing`, `done`, `failed` |
| audio_mime            | text             |                                             |
| audio_size            | integer          | from callback/body                          |
| duration_seconds      | integer nullable |                                             |
| transcript            | text nullable    |                                             |
| summary               | text nullable    | Markdown                                    |
| note_id               | uuid nullable    | FK notes on delete set null                 |
| error                 | text nullable    | safe message                                |
| created_at/updated_at | timestamptz      |                                             |

Indexes: `(status, created_at)`, `(user_id, created_at)`. Do not include `transcribing` unless the bot posts an intermediate state. Add a retention/prune task only if `nexter_app` gets DELETE; otherwise document manual cleanup.

Audio is not stored in v1: the bot sends only the transcript. If playback is wanted, add R2 and `audio_url`.

### 4. Viber bot changes (`jankowski-dev/Nexter.Bot`)

- **Spike first** to confirm file/voice callbacks.
- Handle `message.type == "file"` only; reject `video`. Detect audio by `file_name` extension and downloaded `Content-Type`.
- Verify `sender.id == VIBER_USER_ID` before downloading or transcribing.
- Return HTTP 200 quickly; process in a background thread/queue so Viber does not retry.
- Download media only over HTTPS from expected hosts; size limit 25 MB; duration limit 15 min.
- Transcribe with `faster-whisper` (`base` int8 default, `WHISPER_MODEL`, `WHISPER_LANGUAGE`, VAD on), cache the model on a volume.
- Send only transcript + `message_token` + duration + MIME to `POST /api/v1/bot/audio-notes`; raise the API timeout for this call.
- Add `/test/audio` under `TEST_SECRET` with a committed fixture.
- Update README/env table and keep text reminders unchanged.
- Accept that a bot restart after 200 can lose one audio message; idempotency prevents duplicates, not loss. Add a durable local pending table only if this becomes important.

### 5. API bot endpoints

`POST /api/v1/bot/audio-notes` (BOT_API_TOKEN):

- body `{ viberMessageId, transcript, durationSeconds, audioMime, audioSize }`;
- idempotent by `viberMessageId`; repeated delivery returns the existing job/note;
- synchronous processing for v1: summarize → create note → update job;
- if AI disabled/key missing: raw transcript fallback when `fallback_to_raw`, otherwise fail with “ИИ не настроен”;
- return `{ id, status, noteId?, title? }`.

`GET /api/v1/bot/audio-notes/:id` — status for retries/diagnostics. No public audio upload endpoint in v1.

### 6. Note creation

- **No notes schema change in v1.** Keep the source link in `audio_notes.note_id`; optionally add a one-line footer `Источник: Viber, <date>` and emit `audio_note.created` audit.
- `NotesService` is not exported; export it or create a small note-creation facade.
- Title max 200 chars; tags max 20, 40 chars each; body max 20,000 chars. Truncate/split the raw transcript fallback and keep the full transcript in `audio_notes`.
- Create the note and update `audio_notes.note_id` in one transaction; check existing `note_id` before insert to avoid duplicates on retry.
- Notification `note_created` for v1 links to `/notes` (the notes page has no deep-link handler yet). Add `?note=` support later if wanted.
- Markdown is limited to headings/lists/quote/bold/italic/code/links; constrain the AI prompt accordingly.
- Treat the transcript as untrusted data: delimit it, instruct the model to ignore instructions inside it, validate/truncate output.

## Processing, failure and limits

- Idempotency: unique `viber_message_id`; failed jobs need an explicit retry/reset path.
- Retries: AI 429/5xx once with backoff; provider errors mapped to safe Russian messages.
- Timeouts: transcription 180 s; AI 60 s; bot API call 120 s.
- Limits: audio 25 MB / 15 min; transcript 50k chars stored, 20k used for note body; summary max 2000 tokens.
- If AI is disabled/missing key: raw transcript note or failure based on `fallback_to_raw`.
- If the bot restarts mid-job, idempotency prevents duplicate notes.

## Privacy and security

- Default: local Whisper; audio is not uploaded to a third party.
- DeepSeek receives only transcript text, never audio or credentials.
- Warn in settings that enabling AI sends note text to DeepSeek.
- API key encrypted at rest; masked; never in audit/logs; rotating `AUTH_ENCRYPTION_KEY` invalidates it like TOTP secrets.
- Viber webhook signature verification stays mandatory; only the owner’s Viber user id can create notes.
- Audio discarded after transcription; jobs pruned by policy if DELETE is granted.
- No prompt/response content in logs; only purpose/model/tokens/latency/status.
- Prompt injection mitigations as above; no model-provided actions are executed.

## Settings UI

`Настройки → ИИ` card with an AI/sparkles icon:

- enable toggle;
- provider (DeepSeek);
- model select from the configured allowlist;
- reasoning/thinking mode;
- temperature, max output tokens;
- API key password field with “Ключ сохранён / Заменить / Удалить”;
- `Проверить подключение` with latency;
- fallback “Если ИИ недоступен — сохранить сырой текст”;
- privacy note.

Add the card to the settings hub with a distinct icon. The `NavIconName` union needs an `ai` member.

## Phases

| Phase | Scope                                                                                              | Estimate |
| ----- | -------------------------------------------------------------------------------------------------- | -------- |
| 0     | Spike: Viber file delivery, DeepSeek models/JSON/thinking, Whisper on Railway; ADR with go/no-go   | 0.5 day  |
| 1     | `ai_settings` migration + encrypted settings API + provider client + settings UI + test connection | 1–2 days |
| 2     | `audio_notes` table + bot background audio intake + transcription + transcript-only note creation  | 1–2 days |
| 3     | AI summarizer + structured note + fallback + notification + audit + prompt-injection guards        | 1 day    |
| 4     | retries/idempotency/limits/status tests + bot CI/runbook + retention                               | 1 day    |
| 5     | optional audio playback via R2 + transcript editing + note deep links                              | later    |

Each phase is a separate PR. Migrations require an ADR, verified backup and rollback. Bot changes are a separate repo/Railway deploy and are not covered by app CI.

## Testing

- Unit: provider mapping, timeout, 429 retry, JSON validation, encrypted key round-trip/masking, note-limit truncation.
- API e2e: settings save/read/test with mocked provider; audio job idempotency; AI-disabled fallback; note creation transaction; 404 for foreign job.
- Python: Viber signature, sender check, MIME/size rejection, transcription wrapper, API retry, `/test/audio`.
- E2E: settings key entry masked; telemetry/settings cards; audio flow mocked at the API boundary.
- Manual: send a 10–30 s Russian voice note and verify the structured note; measure transcription time/memory.

## Open decisions

1. Viber delivery spike result: if audio/file callbacks are unavailable, choose authenticated web upload or Telegram.
2. Transcription engine: recommended faster-whisper `base` int8 in the bot; alternatives `small`, `tiny`, separate transcriber.
3. DeepSeek default model/thinking mode: use the current fast model; reasoning opt-in.
4. Audio retention: discard after transcription; no playback in v1.
5. AI fallback: keep raw transcript when AI is unavailable (recommended true).
6. Whether to add note source columns later; v1 uses `audio_notes.note_id` + footer/audit.
7. Usage/cost telemetry: use `external_api_calls` first; dedicated table later if needed.

## Risks

- Viber may not deliver voice/files; spike before building.
- Railway bot CPU/memory may be tight for Whisper; model cache and fallback plan.
- DeepSeek API/model changes; configurable model list and provider abstraction.
- Voice quality/noise; VAD, language setting, duration limit.
- Cost creep; token caps, usage audit, owner-only access.
- Privacy expectations; local transcription and explicit AI opt-in.
