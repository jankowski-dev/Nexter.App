# ADR 0087 — Viber notification outbox

Status: accepted, 2026-11-25.

## Context

Trade closes (manual/on-chain and paper robots) currently create at most a generic in-app
notification; `Nexter.Bot` only polls task reminders and accepts audio notes. The owner wants a
Viber message with the result of every closed trade and a dedicated ViberBot settings section.
The API must not hold the Viber token; the external bot already owns it.

## Decision

1. Add `viber_notifications`, a durable owner-scoped outbox with `type`, `title`, `body`,
   `payload`, `status` (`pending|sent|failed`), `attempts`, `error`, `sent_at`.
2. The API enqueues a row for trade closes and bot stops when the master in-app toggle is on,
   `viber_notifications_enabled` is on and the event-specific Viber toggle is on.
3. `Nexter.Bot` polls `GET /api/v1/bot/notifications/pending` with `BOT_API_TOKEN`, formats and
   sends the message through its existing Viber queue, then calls
   `POST /api/v1/bot/notifications/:id/ack`.
4. Frequency is a setting: `instant`, `hourly` or `daily`. The bot batches pending events for
   hourly/daily and sends at the first poll of a new local hour/day after `viber_digest_time`.
   The API returns the owner timezone with each pending response.
5. A failed ack increments `attempts`; after three failures the row becomes `failed` and stays
   visible in the Viber settings page. No DELETE grant exists.
6. The owner can enqueue a test message and inspect the last deliveries from
   `Настройки → ViberBot`.

## Security

- `VIBER_TOKEN` and `VIBER_USER_ID` remain only in `Nexter.Bot`.
- The API uses the existing timing-safe `BOT_API_TOKEN` check; bot routes are origin/CSRF exempt.
- The outbox contains only symbol/bot/P&L text, never keys, addresses or secrets.
- Every enqueue/ack/test write is audited (`viber.enqueued`, `viber.acknowledged`,
  `viber.failed`, `viber.test_queued`).

## Consequences

- Positive: delivery survives API/bot restarts and can be observed/retried.
- Positive: the web UI can show pending/sent/failed counts without exposing Viber secrets.
- Negative: an extra table and two bot endpoints; duplicate delivery is possible if the bot
  crashes after sending but before ack (at-least-once semantics).
- Rollback: stop the bot notification job / deploy the previous bot; the table is inert.
