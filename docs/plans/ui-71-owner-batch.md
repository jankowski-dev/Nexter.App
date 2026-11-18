# UI-71 — owner batch 2026-11-17

Status: UI/prompt/chart work deployed in UI-71. Owner approved settings, taxonomy, allowlist B and dry-run + semi-auto automation; implemented in UI-72.

## Items

1. Settings audit and candidate list — proposal ready (`ui-71-proposals.md` §2).
2. Settings taxonomy: merge/split categories — proposal ready (`ui-71-proposals.md` §3).
3. AI audio prompt: extract and structure only, no opinions/deep analysis — done.
4. Automatic buy / stop-loss / take-profit — proposal ready (`ui-71-proposals.md` §5).
5. Compact close-order header block with more visible figures — done.
6. Swap allowlist sourced from the default `Основная` watchlist group — proposal ready (`ui-71-proposals.md` §4).
7. Larger data on the token page/cards — done.
8. Notes and tasks font size matches the note editor — done.
9. Active trade blocks: move price/P&L metrics away from long token names — done.
10. Header refresh indicator: logo rays flash green — done.
11. Dashboard order and unified cards — done.
12. Chart reliability: persisted daily history, serialized fetches, lazy loading — done.
13. Shared token modal — done.
14. `Купить` placement — done.
15. Shorter token blocks — done.
16. Shorter operations blocks — done.

## Approval gates

- Items 1–2: wait for owner approval of the settings list and taxonomy.
- Item 4: wait for owner approval of the automation model.
- Item 6: wait for owner approval of allowlist semantics and safety rules.

## Constraints

- No private keys/seed phrases on the server.
- Money as decimal strings / Postgres numeric.
- Allowlist changes must not bypass verification or execution safety.
- Schema changes require an ADR, migration and backup.
