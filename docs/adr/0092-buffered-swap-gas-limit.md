# ADR 0092 — Buffered swap gas limit end-to-end

Status: accepted, 2026-11-26.

## Context

A production XNY→USDC swap was signed and mined but reverted with status `0x0`:

- the Kyber build supplied `gas = 561,609`;
- the RPC `eth_estimateGas` was `570,404`;
- the same calldata succeeded at `567,347`;
- the wallet received no `gas` field, so the provider's tight value/estimator won;
- the nested MetaAggregationRouter call failed under EIP-150 63/64 forwarding and surfaced as a generic `Call failed`.

The position stayed open and no tokens moved. Raising a gas **limit** does not increase the actual fee, which remains `gasUsed × gasPrice`.

## Decision

1. Add `bufferedGasLimit()` in the API swap module. It takes the largest valid of the Kyber build gas and the RPC simulation estimate, adds 20%, and clamps to `[150,000, 10,000,000]`.
2. Use the buffered value for:
   - the BNB gas-balance preflight at build and ready;
   - the persisted `swap_orders.gas_estimate` at build;
   - the build and ready `gasLimit` response fields.
3. Add `gasLimit` to `SwapBuildResponse` and `ApprovalBuildResponse`; approval uses the same helper.
4. The web wallet passes the server `gasLimit` as a hex `gas` field in `eth_sendTransaction` for both approval and swap. When absent, the old wallet behavior remains.
5. Do not auto-retry a failed transaction, do not create ledger rows for a reverted tx and do not change the failed order.

## Consequences

- New swap builds carry an explicit, explainable gas limit; the existing `gasEstimate`/`simulation` fields remain for observability.
- Old orders without a `gasLimit` still work; ready recomputes a buffered value before signing.
- No schema migration. The failed transaction remains a real gas cost but is not ledger-accounted.
- Rollback is the previous image; no data migration is involved.
