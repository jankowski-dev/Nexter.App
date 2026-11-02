# ADR 0003 — Non-custodial swaps

## Status

Accepted.

## Context

The owner trades manually from a Tangem cold wallet via DEX. The product should reduce manual steps but must not introduce server-side custody.

## Decision

- Swaps are non-custodial.
- The server builds and validates transactions.
- The user signs on Tangem via WalletConnect.
- The server never stores seed phrases or private keys.
- The server tracks the transaction and records it in the accounting ledger.
- Unattended trading, hot wallets, and session keys are out of scope.

## Consequences

- The user must confirm every swap on the hardware wallet.
- The server must validate calldata, router, recipient, amounts, slippage, and simulation before presenting the transaction.
- A compromised server cannot move funds by itself, but it could try to build a malicious transaction; validation, simulation, and on-device confirmation are mandatory.
