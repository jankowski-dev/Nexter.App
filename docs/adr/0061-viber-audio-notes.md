# ADR 0061 — Viber audio notes with local transcription

## Status

Accepted for UI-65 on 2026-11-16. Migration `0041` is additive. The fixed audio size limits below were superseded by ADR 0065 (configurable 1–20 MB, default 8 MB).

## Context

The owner sends voice-recorder files to the Viber bot and wants them transcribed, summarized/structured by AI and saved as notes with the original audio attached. A live spike on 2026-11-16 confirmed that Viber delivers `message.type = "file"`, `media = true` for a `.m4a` voice-recorder file (375 KB, HTTP 200 download), even though a separate voice-message type is not available. This makes the Viber file path viable.

## Decision

- The bot verifies `sender.id == VIBER_USER_ID`, accepts audio extensions `m4a/mp4/mp3/ogg/opus/wav/webm`, downloads the media over HTTPS, and rejects files over 2.4 MB.
- Transcription is local in the bot service with `faster-whisper` (`base`, int8, Russian by default, VAD). The model is cached under `WHISPER_CACHE_DIR`; a Railway volume is recommended.
- The webhook returns HTTP 200 quickly and processes the audio in a daemon thread. The bot sends progress/result messages to Viber.
- The bot posts transcript, MIME, name, size, duration and audio as a base64 data URL to `POST /api/v1/bot/audio-notes` with `BOT_API_TOKEN`.
- `audio_notes` (migration `0041`) stores the job status, transcript, AI summary/title, note id and safe error, unique by `viber_message_id` for idempotency.
- The API uses the AI module when enabled and a key is present. If AI fails or is not configured, `fallback_to_raw` (default true) creates a raw transcript note; otherwise the job fails with a Russian error.
- The note and its `note_audio` attachment are inserted in one transaction. The audio is stored as a data URL in `note_audio`, following the existing `note_images` pattern. `notes.attachmentCount` counts images plus audio; note responses include `audio`.
- The notes drawer renders an `<audio controls>` player and a download link for each audio attachment.
- Limits: bot audio 2.4 MB, API data URL 3.5 MB, transcript 50k, note body 20k, title 200, tags 20×40.
- No audio is sent to DeepSeek; only transcript text is. Audio is stored because the owner explicitly wants the original attached to the note.

## Consequences

- The audio note is available even without AI (raw fallback).
- A bot restart after the webhook 200 can lose one in-flight file; the idempotency key prevents duplicates, not loss.
- `audio_notes`/`note_audio` have SELECT/INSERT/UPDATE and explicit DELETE revoke for `nexter_app`.
- Rollback: drop `audio_notes`/`note_audio` and remove the bot audio handler; notes without audio remain valid.
- Future playback beyond the data URL (R2 storage, signed URLs) can replace `note_audio.data_url` without changing the bot contract.

## Verification

- API e2e posts a bot audio payload, asserts a done job, a note with the raw transcript, one `note_audio` row, idempotent replay and 401 without the token.
- Bot spike log confirmed file type/media/download; local Python tests cover the reminder scheduler; transcription is verified manually on the Railway service.
