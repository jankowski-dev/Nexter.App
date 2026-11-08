# ADR 0015 — Position-close linkage for swaps

## Status

Accepted for UI-1 (2026-11-08).

## Context

UI-1 lets the owner close one, several, or all open trade groups for a token from the portfolio. The existing swap accounting consumes the input asset with global FIFO and creates a new trade group for a non-cash output. That is correct for a generic swap but cannot target a specific position.

The UI needs an auditable link between a swap order and the selected trade groups so accounting consumes only those groups and updates their status correctly.

## Decision

- **Join table.** Migration `0016` adds `swap_order_close_groups` with `order_id`, nullable `trade_group_id`, `asset_id`, `expected_amount`, and `created_at`. The expected amount is the group's remaining amount at quote time.
- **Quote request.** `POST /swap/quote` accepts optional `closeGroupIds` (1–50 unique UUIDs). The quote is rejected unless:
  - every group belongs to the user;
  - all groups share the same non-cash asset, and it matches `tokenIn`;
  - every group is open/partial with a positive remaining amount;
  - `tokenOut` is a cash-equivalent asset;
  - `amountIn` equals the sum of the selected groups' remaining amounts (full close).
- **Order detail.** `GET /swap/orders/:id` and quote/build/ready responses include `closeGroupIds`. The join rows remain the audit source for expected amounts.
- **Build/ready/signing revalidation.** The server reloads the selected groups and fails closed with `SWAP_CLOSE_GROUP_CHANGED` if any remaining amount differs from the quote snapshot. Stale or already-closed groups cannot be signed through this order.
- **Accounting.** The tracker passes `closeGroupIds` to the ledger swap. `FifoService.consume` accepts an optional group filter and consumes FIFO only inside the selected groups. The ledger also verifies the close groups, asset, and amount before posting. A single-close order may still leave the transaction `trade_group_id` null; the order join rows are the canonical link.
- **Manual sells.** `tradeGroupId` on a manual sell now targets that group's lots instead of the global FIFO pool. This aligns the existing trade-detail sell flow with the selected group.
- **Partial close.** The MVP closes the full remaining amount of each selected group. Per-group partial amounts (`closeLegs`) are a later extension.

## Consequences

- Closing one, several, or all groups is auditable and does not consume unrelated lots.
- A group changed after the quote fails at build/ready/signing. If it changes after signing but before accounting, the tracker records a `SWAP_ACCOUNTING_*` failure and the owner must resolve it manually; the on-chain swap cannot be undone by the server.
- The transaction row may not identify a single trade group for a multi-close. Consumers should use the swap order's `closeGroupIds` and `swap_order_close_groups` rows.
- No new signing or key material is introduced. All existing swap security gates remain in force.
