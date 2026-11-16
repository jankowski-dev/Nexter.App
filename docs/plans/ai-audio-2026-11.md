# AI module, audio notes and transcription — implementation plan

Status: proposed 2026-11-16. No code or migrations yet.

## Goals

1. A first-class AI module that can be used by future product features.
2. Owner-only AI settings: provider, API key, model, reasoning level, temperature, token limit, enable flag.
3. Audio notes: send a voice file to the Viber bot, transcribe it, summarize/structure it with AI, and create a clean note.
4. Keep audio private by default: local transcription, transient audio storage, explicit external-AI boundary.
5. Reuse the existing notes, workers, audit and notification infrastructure.

## Non-goals

- No autonomous trading decisions in this phase.
- No AI chat UI.
- No audio playback/editing in the first version.
- No automatic posting of AI output anywhere except the owner's notes.

## Recommended architecture

```text
Viber voice message
        │
        ▼
Nexter.Bot (Python, Railway)
  - verifies sender == VIBER_USER_ID
  - downloads media
  - local transcription (faster-whisper)
  - sends transcript + metadata to API
        │  POST /api/v1/bot/audio-notes (BOT_API_TOKEN)
        ▼
Nexter API
  - stores audio job row
  - AI module: summary + structure (DeepSeek)
  - notes service: create note
  - returns note id / job status
        │
        ▼
Nexter.Bot polls job status and replies in Viber:
  "Заметка создана: <title>"
```

Why transcription in the bot service:

- audio never leaves the owner's Railway/Viber boundary;
- no large file upload to the main API;
- no extra Railway service to pay for;
- the bot already has Python and receives the file;
- faster-whisper (`small` or `base`, int8) is free and accurate enough for Russian/English notes.

If CPU/memory on the bot service is insufficient, move transcription to a dedicated `transcriber` Railway service with the same contract. The API contract does not change.

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
- First provider: `deepseek` using the OpenAI-compatible endpoint `https://api.deepseek.com/v1/chat/completions`.
- Models: `deepseek-chat` (fast), `deepseek-reasoner` (reasoning). Reasoning level maps to model choice and optional `temperature`/`max_tokens`; DeepSeek does not expose an OpenAI `reasoning_effort` parameter, so the UI should call it “Режим: быстрый / рассуждение”.
- `AiService.summarizeNote(transcript)` returns structured JSON:
  ```json
  {
    "title": "Короткий заголовок",
    "summary": "2–4 предложения",
    "body": "Markdown с разделами: Итог, Ключевые пункты, Задачи, Детали",
    "tags": ["..."],
    "language": "ru"
  }
  ```
- All AI calls use a timeout, max output tokens, one retry on 429/5xx, and a per-purpose audit event without prompt content.
- Future features call `AiService.run({ purpose, input, schema })`; no feature imports DeepSeek directly.

### 2. AI settings (`Настройки → ИИ`)

New table `ai_settings` (one row per user, migration `0041`):

| column                | type          | notes                                 |
| --------------------- | ------------- | ------------------------------------- |
| user_id               | uuid PK/FK    | cascade                               |
| enabled               | boolean       | default false                         |
| provider              | text          | `deepseek`                            |
| model                 | text          | `deepseek-chat` / `deepseek-reasoner` |
| reasoning             | text          | `fast` / `reasoning`                  |
| temperature           | numeric(3,2)  | 0–2                                   |
| max_tokens            | integer       | 256–8192                              |
| api_key_encrypted     | text nullable | AES-256-GCM via `AUTH_ENCRYPTION_KEY` |
| created_at/updated_at | timestamptz   |                                       |

API:

- `GET /api/v1/settings/ai` — provider/model/reasoning/temperature/maxTokens/enabled + `hasApiKey`, never the key.
- `PUT /api/v1/settings/ai` — update all fields; optional `apiKey`; empty string keeps the current key; explicit clear flag removes it.
- `POST /api/v1/settings/ai/test` — sends a tiny “Ответь одним словом: ok” request and returns latency/model/error.
- `DELETE /api/v1/settings/ai/key` — remove the key.

Security:

- owner-only, CSRF-protected;
- key encrypted at rest, never returned, never logged;
- audit records action, provider/model, `keyChanged: true/false`, no key;
- base URL is fixed for DeepSeek; a custom URL is out of scope to avoid SSRF;
- rate limit AI calls per user/purpose.

### 3. Audio jobs (`audio_notes` table, migration `0042`)

| column                | type             | notes                                                       |
| --------------------- | ---------------- | ----------------------------------------------------------- |
| id                    | uuid PK          |                                                             |
| user_id               | uuid FK cascade  |                                                             |
| viber_message_id      | text unique      | idempotency                                                 |
| status                | text             | `received`, `transcribing`, `summarizing`, `done`, `failed` |
| audio_mime            | text             | ogg/mp4/m4a/mp3/wav                                         |
| audio_size            | integer          | limit 25 MB                                                 |
| duration_seconds      | integer nullable | limit 15 min                                                |
| transcript            | text nullable    |                                                             |
| summary               | text nullable    | Markdown                                                    |
| note_id               | uuid nullable    | FK notes on delete set null                                 |
| error                 | text nullable    | safe message                                                |
| created_at/updated_at | timestamptz      |                                                             |

The audio file itself is **not stored** in the first version: the bot transcribes locally and sends only the transcript. If playback is wanted later, add object storage (R2) and an `audio_url` column.

### 4. Viber bot changes (`jankowski-dev/Nexter.Bot`)

- Handle `message.type == "file"` and `message.type == "video"` with audio MIME types.
- Verify the sender is `VIBER_USER_ID`; ignore everyone else.
- Download `message.media` with `X-Viber-Auth-Token`.
- Validate size/MIME; reject unsupported files with a short Viber message.
- Transcribe with `faster-whisper`:
  - model `small` int8 by default, configurable `WHISPER_MODEL=tiny|base|small`;
  - `language=ru` by default, auto-detect if `WHISPER_LANGUAGE=auto`;
  - VAD filter on; max 15 minutes.
- Send `POST /api/v1/bot/audio-notes` with transcript, duration, message id and MIME, using `NEXTER_BOT_TOKEN`.
- Poll `GET /api/v1/bot/audio-notes/:id` (or use the synchronous response) and reply with the note title or error.
- Add `/test/audio` with `TEST_SECRET` to transcribe a server-local fixture and exercise the API without Viber.
- Keep the current text reminder scheduler unchanged.

### 5. API bot endpoints

- `POST /api/v1/bot/audio-notes` (BOT_API_TOKEN):
  - body `{ viberMessageId, transcript, durationSeconds, audioMime }`;
  - idempotent by `viberMessageId`;
  - if AI disabled/key missing: status `failed` with a clear error, or fallback to raw transcript based on a setting `aiFallbackToRaw` (recommended true);
  - enqueue/execute summarization and note creation;
  - return `{ id, status, noteId?, title? }`.
- `GET /api/v1/bot/audio-notes/:id` — status for bot polling.
- No public audio upload endpoint in the first version.

### 6. Note creation

- Extend `notes` with `source` (`manual`/`viber_audio`/`ai`) and `metadata` JSONB (migration `0043`) **or** reuse `note_images`-style metadata in a new `note_sources` table. Recommended: two nullable columns on `notes`, simple and auditable.
- Title from AI; body from AI Markdown; tags from AI (deduplicated, max 10).
- If AI fallback: title `Аудиозаметка <date time>`, body = transcript.
- Storage: transcript is kept in `audio_notes`; note body contains the structured summary. A small footer may include `Источник: Viber, 16.11.2026 10:42` and duration.
- In-app notification `note_created` with href to the note.
- Audit: `note.created` with source metadata and `ai.audio_note_summarized` with model/tokens/latency, no transcript content.

## Processing and failure handling

- Idempotency: unique `viber_message_id`; repeated delivery returns the same job.
- Retries: AI 429/5xx retried once with backoff; transcription errors returned to the bot; job remains `failed` with a safe message.
- Timeouts: transcription 180 s, AI 60 s.
- Limits: audio 25 MB / 15 min; transcript 50k chars; summary max 2000 tokens.
- If AI is disabled or the key is missing: raw transcript becomes the note (if fallback enabled), otherwise the job fails with “ИИ не настроен”.
- If the bot restarts mid-job, the idempotency key prevents duplicate notes.

## Privacy and security

- Default: local Whisper; audio is not uploaded to a third party.
- DeepSeek receives only the transcript text, never audio or credentials.
- Warn in settings that enabling AI sends note text to DeepSeek.
- API key encrypted at rest; masked in all responses; never in audit/logs.
- Viber webhook signature verification stays mandatory.
- Only the owner’s Viber user id can create audio notes.
- Audio is discarded after transcription; jobs can be pruned after 30 days.
- No AI prompt/response content in logs; only purpose/model/token/latency/status.

## Settings UI

`Настройки → ИИ` card with a `sparkles`/AI icon:

- enable toggle;
- provider (DeepSeek, fixed for now);
- model select (`deepseek-chat`, `deepseek-reasoner`);
- reasoning mode (`Быстрый`, `Рассуждение`);
- temperature slider/input;
- max output tokens;
- API key input (password, placeholder “Ключ сохранён”, “Заменить ключ”, “Удалить ключ”);
- `Проверить подключение` with latency/result;
- fallback toggle “Если ИИ недоступен — сохранить сырой текст”;
- privacy note.

Add the settings card to the hub with a distinct icon.

## Phases and estimates

| Phase | Scope                                                                                                    | Estimate |
| ----- | -------------------------------------------------------------------------------------------------------- | -------- |
| 0     | ADR + `ai_settings` migration + encrypted settings API + provider client + settings UI + test connection | 1–2 days |
| 1     | `audio_notes` table + bot audio intake + faster-whisper in bot + transcript-only note creation           | 1–2 days |
| 2     | AI summarizer + structured note + fallback + notifications + audit                                       | 1 day    |
| 3     | retries/idempotency/limits/status UI + tests + runbook                                                   | 1 day    |
| 4     | optional audio playback via R2 + transcript editing                                                      | later    |

Each phase is a separate PR with CI E2E. Migrations require an ADR, a verified backup and a documented rollback.

## Testing

- Unit: AI provider request/response mapping, timeout, 429 retry, encrypted key round-trip, masking.
- API e2e: settings save/read/test with a mocked provider; audio job idempotency; AI-disabled fallback; note creation.
- Python: Viber file webhook signature, MIME/size rejection, transcription wrapper, API client retry, `/test/audio`.
- E2E: settings page key entry masked; bot audio flow mocked at the API boundary.
- Manual: send a 10–30 s Russian voice note to the Viber bot and verify the structured note.

## Open decisions

1. Transcription engine: recommended `faster-whisper small` in the bot service; alternative `base` for speed, or a separate transcriber service.
2. Default DeepSeek model: `deepseek-chat` for note summaries; `deepseek-reasoner` is slower and more expensive and should be opt-in.
3. Audio retention: recommended discard after transcription; no playback in v1.
4. AI fallback: recommended keep the raw transcript if AI is unavailable.
5. Whether AI usage/cost telemetry gets a dedicated table (recommended phase 3).

## Risks

- Railway bot CPU/memory may be tight for Whisper; mitigate with `base`/int8 or a separate transcriber.
- DeepSeek API changes/limits; provider abstraction isolates it.
- Voice quality/noise; VAD + Russian language + max duration mitigate.
- Cost creep; per-purpose token caps, usage audit and owner-only access.
- Privacy expectations; local transcription and explicit AI opt-in.
