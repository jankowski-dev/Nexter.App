# ADR 0033 — Feedback batch: contracts, recurrence series, attachments, native holdings

## Status

Accepted for UI-20 on 2026-11-12. Migrations `0030` and `0031` are additive.

## Context

The owner asked for a broad polish batch: token icons in statistics, no manual price/lot blocks in the asset card, BSC and Ethereum contract addresses per token card, series-wide recurring-task edits and deletes, file attachments in notes, a compact vault, token-base sorting buttons with only 24-hour changes, a larger trade P/L block, a sell cap, a page-transition loader, and accurate native TRON/Solana holdings.

The owner chose one token card with two reference contract addresses, series-wide content/deletion with per-occurrence completion, and native TRON/Solana holdings rather than BSC bridged tokens. The existing XNY/POP/BASED/APR positions stay in the ledger.

## Decision

- **Watchlist contract metadata.** `watchlist` gains nullable `bsc_contract_address` and `ethereum_contract_address`. They are reference metadata, validated as `0x` + 40 hex characters; accounting and position identity remain per asset/chain. The token drawer shows both addresses with BscScan/Etherscan links.
- **Recurring task scope.** `PATCH /tasks/:id` accepts `applyToSeries` (default true when the task belongs to a series). Title, description, priority, tags, related asset, due-date shift, and archive/delete apply to every occurrence in the series. `status`/`completedAt` remains per occurrence and must be sent with `applyToSeries: false` (the row checkbox and calendar move do this). Recurrence itself stays fixed after creation.
- **Note attachments.** The existing `note_images` storage is reused for images and common files: PDF, TXT, DOC/DOCX, XLS/XLSX, RAR, ZIP, PNG/JPEG/WebP. Five attachments per note, 1.5 MB each, stored as data URLs. Images still open in the viewer; other files show a download card. The compact note row shows a paperclip and count.
- **Token base display.** Only the 24-hour change and market cap are shown in the token base. Sorting is a button group (default, market cap, 24h) with a direction toggle. Seven-day/30-day/1-year values remain in positions and the main list.
- **Trade drawer.** A sell shows an estimated P/L block next to the proceeds block, coloured green/red, with the proportional invested cost basis. The old small P/L in the trade summary is replaced by the total invested amount. The sell amount is capped at the trade group's remaining amount client-side; the server already enforces it.
- **Native holdings.** Migration `0031` seeds `tron` and `solana` chains plus native `TRX` (6 decimals) and `SOL` (9 decimals) assets. Bootstrap adds `TRON wallet` and `Solana wallet` accounts. They are manual-only: no swap/reconciliation support, but CoinGecko prices and normal portfolio valuation work.
- **Page loader.** A route-transition overlay lightens the page and shows a spinner for at least one second while TanStack Router is pending.
- **Provider request volume.** Swap preview amounts are debounced by 500 ms, preview polling is 15 s, and the API caches identical previews for five seconds. This reduces KyberSwap `/routes` bursts without changing quote validation.

## Consequences

- `0030` and `0031` are additive and require the usual verified backup. `0031` inserts data only if the chains/assets are absent.
- A recurring task's archive action now archives the whole series; restoring from the archive restores all rows in that series.
- Native TRON/SOL are not tradeable in the app and are not covered by the on-chain indexer. They depend on manual adjustments and CoinGecko prices.
- File attachments are stored in Postgres and increase database size; the 1.5 MB and five-file limits bound this.
- The preview cache is per API process and only affects non-persisting `/swap/preview` responses.
