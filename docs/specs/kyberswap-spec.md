# KyberSwap Spec

## Scope

- BSC first, Ethereum second.
- Non-custodial Tangem signing via WalletConnect.
- KyberSwap Aggregator API v1.
- No server private keys, no unattended trading.

## Flow

1. Quote via `GET /{chain}/api/v1/routes`.
2. Build via `POST /{chain}/api/v1/route/build`.
3. Validate router, calldata, recipient, amounts, minOut, deadline.
4. Simulate.
5. Approve exact amount if needed.
6. Sign on Tangem.
7. Submit tx hash.
8. Worker tracks receipt and confirmations.
9. Record trade, gas, and FIFO P&L.

## State machine

`DRAFT → QUOTED → BUILT → APPROVAL_REQUIRED → READY → AWAITING_SIGNATURE → SUBMITTED → PENDING → CONFIRMED | FAILED | REPLACED | DROPPED | EXPIRED | CANCELLED`.

## Validation gates

Chain/token/wallet allowlist, quote TTL 10–15s, route ID/checksum, router allowlist, `to`/`value`/selector/amountIn/recipient checks, minOut, price impact ≤2%, gas cap, simulation success, balance/allowance, deadline ≤5 min, token safety, chainId.

## Security

Exact approvals, spender display, USDT reset, Permit2 later. Private RPC/MEV protection where available. Step-up TOTP above $500. Kill switch. Full-address confirmation. No seed phrase requests.

## Tokens

BSC: USDC, XNY, BASED, APR, POP, LINK, BNB.
Ethereum: USDC, LINK, BASED, APR, ETH.
Contracts must be verified before registry entry.

## Accounting

Confirmed swap creates a `trade` transaction with postings for tokenIn, tokenOut, and gas; consumes FIFO lots for tokenIn; creates a lot for tokenOut with cost basis = tokenIn USD + gas; links `swap_orders.transaction_id`.

## Testing

Unit validation/state machine, recorded API fixtures, Anvil forks BSC/Ethereum, Playwright with mocked wallet, manual Tangem acceptance, chaos tests for 429/timeout/stale quote/revert/replaced/dropped/RPC outage, calldata tampering tests.
