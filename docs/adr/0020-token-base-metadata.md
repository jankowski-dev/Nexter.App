# ADR 0020 — Token base metadata

## Status

Accepted for UI-7 stage 4 (2026-11-09).

## Context

The watchlist already stores groups, a thesis, tags, priority, an icon, and live price data. The owner wants it to work as a token base: a dense card grid and a token drawer with the contract address, icon, name, description, Twitter, website, and investors.

The token base is research metadata, not accounting data. It must not affect the ledger, balances, or swap allowlist.

## Decision

- **Rename.** The module stays at `/watchlist` and keeps the existing API prefix, but the UI label becomes `База токенов`. The route is unchanged so bookmarks and the navigation structure remain stable.
- **Storage.** Migration `0020` adds three nullable/defaulted columns to `watchlist`: `twitter_url text`, `website_url text`, and `investors text[] not null default '{}'`. The existing `thesis` field is presented as the token description. No `assets`, ledger, or swap rows are changed.
- **Validation.** Twitter and website URLs are trimmed, capped at 500 characters, and must use `http` or `https`. `javascript:`, `data:`, and other schemes are rejected. Investors are trimmed strings of 1–80 characters, at most 30 per token. Tags keep their existing limits.
- **API.** `POST /watchlist`, `PATCH /watchlist/:id`, and `POST /watchlist/from-contract` accept `twitterUrl`, `websiteUrl`, and `investors`. `WatchlistEntry` returns them. Updates keep existing values when a field is omitted; `null` clears a URL and an empty array clears investors. Mutations remain owner-scoped and audited.
- **UI.** Cards render three per row on wide screens and two on medium screens. The whole card is a button that opens a side drawer with the contract, description, external links, investors, tags, group, priority, and a link to the full asset card. Edit, archive, and restore live in the drawer. External links open with `rel="noreferrer noopener"`.
- **Safety.** The new fields are display-only. They do not add tokens to the swap allowlist and do not create transactions. Client-side URL validation mirrors the server, but the server is authoritative.

## Consequences

- The token base keeps the existing groups, prices, icons, and search behavior.
- Research metadata is stored per watchlist entry, so the same asset can be described differently if it is ever re-added to another user context. The app remains single-owner.
- Migration `0020` is additive and safe to roll back by dropping the three columns; no data backfill is needed.
- No third-party requests are added: external links are only opened by an explicit user click.
