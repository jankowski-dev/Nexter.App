# ADR 0011 — Light theme

## Status

Accepted 2026-11-05.

## Context

The owner reported that the dark theme and saturated accents caused eye strain. The product rule previously required a dark UI, but the owner explicitly requested a light theme.

## Decision

Use a light theme across the web app:

- `zinc-50` page canvas, white cards/sidebar/header/modals, `zinc-200` borders;
- dark readable text (`zinc-900`/`zinc-600`/`zinc-500`);
- soft emerald/sky/amber/red accents for actions and statuses;
- WCAG AA contrast and visible emerald focus states;
- light WalletConnect/AppKit QR modal.

The functional flows, Russian copy, and USD base currency are unchanged.

## Consequences

- Rule 13 in `AGENTS.md`/the mega-prompt and the UX spec now say light theme.
- Phase 5's historical dark-theme acceptance is superseded for the current UI.
