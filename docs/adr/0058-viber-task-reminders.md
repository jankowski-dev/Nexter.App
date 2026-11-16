# ADR 0058 — Viber task reminder API

## Status

Accepted for UI-62 on 2026-11-16. No migration.

## Context

The owner wants Viber notifications for tasks with a due time, five minutes before the deadline. The existing `jankowski-dev/Nexter.Bot` service is a Flask/APScheduler Viber bot that previously read Notion. The new Nexter API is session/2FA protected, so the bot cannot log in as the owner.

## Decision

- Add an owner-agnostic server-to-server endpoint `GET /api/v1/bot/tasks/upcoming?minutes=5`.
- Protect it with a bearer token from `BOT_API_TOKEN`; timing-safe comparison; 503 when the token is not configured.
- The endpoint returns open, non-archived tasks of the single owner whose `dueAt` is between now and now + minutes, with `id`, `title`, `dueAt`, `priority` and `tags`.
- `minutes` is clamped to 1–60.
- The Viber bot polls every 30 seconds and sends a message for each task not yet reminded in the current process. Sent ids are kept in memory and pruned after 15 minutes.
- Remove Notion integration from the bot. Keep the Viber webhook and add `/test/status`, `/test/notify` and `/test/poll` protected by `TEST_SECRET`.
- No schema change: reminders are derived from existing task rows; deduplication is process-local for the first version.

## Consequences

- The bot needs `NEXTER_API_URL`, `NEXTER_BOT_TOKEN`, `VIBER_TOKEN`, `VIBER_USER_ID`, `TEST_SECRET`.
- The API needs `BOT_API_TOKEN` with the same value as the bot's `NEXTER_BOT_TOKEN`.
- A bot restart inside the five-minute window can resend one reminder. Persistent reminder state would need a schema change and is deferred.
- Task edits/deletes are reflected automatically because the endpoint reads live rows.

## Verification

- API e2e: no/wrong token returns 401, missing configuration returns 503, the 5-minute window returns only the near task, the 60-minute window returns both.
- Python unit tests cover message formatting, deduplication, past-task skipping and API error recording.
