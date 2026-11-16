# ADR 0060 — AI module and encrypted DeepSeek settings

## Status

Accepted for UI-65 on 2026-11-16. Migration `0041` is additive.

## Context

The owner wants a serious AI module for future features, starting with DeepSeek. The API key must be stored server-side and never exposed to the browser. The module must be a reusable boundary, not a direct DeepSeek call from each feature.

## Decision

Add `apps/api/src/modules/ai`:

- `AiSettingsService` with per-owner settings in `ai_settings` (migration `0041`):
  `enabled`, `provider`, `model`, `reasoning`, `temperature`, `max_tokens`, `fallback_to_raw`, encrypted `api_key_encrypted`, timestamps.
- The key is encrypted with the existing `CryptoService` AES-256-GCM key (`AUTH_ENCRYPTION_KEY`); `CryptoService` is exported from `AuthModule`. Responses expose only `hasApiKey`.
- `DeepSeekProvider` is an OpenAI-compatible client at `https://api.deepseek.com` with a configurable `DEEPSEEK_BASE_URL` for tests. It handles 401/403, 429, timeouts, empty responses and provider errors with dedicated codes.
- `AiService` exposes `testConnection` and `summarizeNote`, with a system prompt that treats the transcript as untrusted data and returns strict JSON: `title`, `summary`, `body`, `tags`, `language`. Output is validated with Zod and truncated to note limits.
- Endpoints: `GET/PUT /settings/ai`, `POST /settings/ai/test`, `DELETE /settings/ai/key`.
- Audit records `ai.settings_updated` (with `keyChanged`, never the key) and `ai.note_summarized`/`ai.note_summary_failed` (model, latency, token usage, no prompt/response text).
- UI: `Настройки → ИИ` with enable toggle, model/reasoning, temperature, max tokens, fallback, masked key input, replace/remove, test connection and privacy note.

## Consequences

- The settings row is owner-scoped and lazy-created on first save.
- Provider/API changes remain isolated behind the provider boundary.
- The model list is configurable because DeepSeek model names and thinking controls change; the UI includes current and legacy options and the exact default can be updated without touching callers.
- No prompt or response content is logged or audited.
- `nexter_app` gets SELECT/INSERT/UPDATE and explicit DELETE revoke on `ai_settings`.
- Rollback: drop `ai_settings` and redeploy the previous image; no existing table is modified.

## Verification

- API e2e saves settings, confirms `hasApiKey`, verifies the raw key is absent from the response and clears the key.
- Web typecheck/lint/build.
