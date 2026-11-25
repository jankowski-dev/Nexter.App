# ADR 0089 — Favorites as the sandbox token source

Status: accepted, 2026-11-25.

## Context

The sandbox token drawer currently accepts any provider key, and its separate
universe can diverge from the owner's token base. The owner already maintains
chain/contract metadata in the default watchlist group and wants new sandbox
tokens to come from that curated list only.

## Decision

1. Rename the default watchlist group to `Избранное` in the UI and in the
   existing default row (data migration `0055`, conflict-safe).
2. Add `GET /sandbox/tokens/candidates`: default-group, non-archived assets with
   a supported BSC/Ethereum chain and a contract address are eligible; missing
   contracts, unsupported chains and cash equivalents are returned with
   `eligible=false` and a Russian reason.
3. `POST /sandbox/tokens` resolves the candidate server-side and rejects
   arbitrary keys with `SANDBOX_TOKEN_NOT_IN_FAVORITES` or an ineligible
   candidate with `SANDBOX_TOKEN_NOT_ELIGIBLE`. It uses the candidate's
   symbol/name/chain/contract rather than trusting client metadata.
4. Existing `sandbox_tokens` rows, including the Stage 3 universe, are not
   removed or edited. Only new additions are constrained.

## Consequences

- Positive: one source of truth for chain/contract metadata; no free-form typo
  keys; the owner sees exactly why a token cannot be added.
- Negative: a token must first be added to `Избранное` with a contract before it
  can be used in new sandbox runs; DEX-only tokens without a contract are
  intentionally blocked.
- Rollback: deploy the previous image; the data rename remains harmless and the
  new endpoints are inert without the UI.
