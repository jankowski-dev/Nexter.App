# MVP-1 UAT Checklist

Use this checklist on staging, or on production in read-only mode unless the owner explicitly approves test mutations. Do not paste credentials, TOTP codes, recovery codes, cookies, or full exports into this file or into chat.

## Preconditions

- API `/health` and `/ready` return `200`.
- Owner account exists; TOTP is enrolled; recovery codes are stored offline.
- The latest Notion import is committed (431 orders) for production-like checks.
- Browser zoom 100%; test desktop and a narrow mobile viewport (360×800).

## Auth and sessions

| ID  | Check                           | Expected                                                                               |
| --- | ------------------------------- | -------------------------------------------------------------------------------------- |
| A1  | Open `/login`                   | Light Russian UI, no console errors, no wallet/seed wording beyond the safety note.    |
| A2  | Login with wrong password       | Error, no session, `auth.login_failed` audit entry.                                    |
| A3  | Login with correct password     | 2FA challenge; no access to dashboard before TOTP.                                     |
| A4  | Enter valid TOTP                | Session rotates; dashboard opens.                                                      |
| A5  | Enter a used/invalid TOTP       | Rejected; throttling after repeated attempts.                                          |
| A6  | Use a recovery code             | Login succeeds; the code is consumed and cannot be reused.                             |
| A7  | `/settings/security`            | Sessions listed; current session marked; revoke another session.                       |
| A8  | Change password                 | Other sessions revoked; current session rotates; re-login with the new password works. |
| A9  | Logout                          | Session revoked; protected routes redirect to `/login`.                                |
| A10 | Press browser back after logout | No protected data is shown.                                                            |

## Import

| ID  | Check                                 | Expected                                                                                                   |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| I1  | Upload the Notion export on `/import` | Preview completes; 431 orders, 412 closed, 19 active; control sums match.                                  |
| I2  | Preview again                         | Idempotent; no duplicate ledger rows.                                                                      |
| I3  | Commit                                | Ledger and trade groups created; audit entry `import.notion_committed`.                                    |
| I4  | Rollback (staging only)               | Imported rows removed; audit entry `import.notion_rolled_back`; dashboard returns to the pre-import state. |

## Dashboard

| ID  | Check                    | Expected                                                                                           |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| D1  | `/dashboard`             | KPI cards, equity curve, allocation, monthly P&L, active positions, recent trades, quality banner. |
| D2  | Equity curve label       | Says historical holdings are valued at current prices; no implied historical market valuation.     |
| D3  | 30D / 90D / 1Y / All     | Chart and P&L ranges change without page errors.                                                   |
| D4  | Totals                   | `equity − netDeposits = totalPnl`; cash + positions = equity.                                      |
| D5  | Partial endpoint failure | A warning banner appears and retry works; the rest of the dashboard stays usable.                  |
| D6  | Data-quality banner      | Clicking through opens `/settings/data-quality` with matching counts.                              |

## Portfolio

| ID  | Check                       | Expected                                                          |
| --- | --------------------------- | ----------------------------------------------------------------- |
| P1  | `/portfolio` positions      | Amount, price, average cost, value, cost basis, P&L, share.       |
| P2  | `/portfolio` accounts       | Wallet/system accounts and chain labels.                          |
| P3  | Open an asset               | Lots, trade groups, transactions, thesis/tags, price history.     |
| P4  | Set a positive price        | Position value and P&L update; zero/negative prices are rejected. |
| P5  | Cash asset (USDT)           | Asset detail shows a $1 cash position rather than “not found”.    |
| P6  | Asset with >50 trade groups | All groups are shown, not only the first page.                    |

## Trades and manual entry

| ID  | Check                          | Expected                                                                   |
| --- | ------------------------------ | -------------------------------------------------------------------------- |
| T1  | `/trades` filters              | Asset, status, source, P&L sign, date range, search all filter the list.   |
| T2  | Columns                        | ID, closed date, holding days, quality badge, source.                      |
| T3  | Open a trade                   | Legs, lots, consumptions, audit, notes.                                    |
| T4  | Save a note                    | Note persists and `trade_group.notes_updated` is audited.                  |
| T5  | Partial sell from trade detail | Remaining amount and realized P&L update; FIFO consumption is visible.     |
| T6  | Sell a closed group            | Button disabled; API rejects with `VALIDATION_ERROR`.                      |
| T7  | Double-submit a sell           | Stable idempotency key prevents a duplicate; retry returns the same state. |
| M1  | Manual buy                     | Creates a group, lot, and postings; audited.                               |
| M2  | Manual partial sell            | FIFO consumption; realized P&L; audited.                                   |
| M3  | Manual transfer                | No P&L; gas accounted; wallet-only selectors.                              |
| M4  | Manual income                  | Creates a lot; income appears on the dashboard.                            |
| M5  | Manual adjustment              | Requires a reason; audited.                                                |
| M6  | Manual withdrawal/deposit      | Correct cash balance; negative balances flagged.                           |
| M7  | Invalid decimal / zero         | Submit disabled in the UI; API rejects with `VALIDATION_ERROR`.            |
| M8  | Double-submit a manual entry   | Retry with the same dialog does not duplicate the transaction.             |

## Watchlist

| ID  | Check                     | Expected                                                               |
| --- | ------------------------- | ---------------------------------------------------------------------- |
| W1  | `/watchlist`              | Backfilled entries show thesis, tags, priority, price.                 |
| W2  | Add an asset              | Appears immediately; duplicate is `409`.                               |
| W3  | Edit thesis/tags/priority | Persists; audited.                                                     |
| W4  | Archive                   | Hidden by default; visible with “Архив”.                               |
| W5  | Restore                   | Returns to the active list.                                            |
| W6  | 24h change                | Shows `—` when no price at least 24h old exists; never invents `0.00`. |

## Settings, audit, export, data quality

| ID  | Check                    | Expected                                                                            |
| --- | ------------------------ | ----------------------------------------------------------------------------------- |
| S1  | `/settings`              | USD/FIFO fixed; timezone and gas-in-cost-basis editable; audit entry on save.       |
| S2  | Invalid timezone         | `400` and a Russian validation message.                                             |
| S3  | `/settings/audit`        | Cursor pagination, action/entity filters, no duplicate rows.                        |
| S4  | `/settings/accounts`     | Accounts listed; read-only notice.                                                  |
| S5  | `/settings/data-quality` | Unknown chains/contracts, missing prices/gas, unverified assets, negative balances. |
| E1  | Export transactions CSV  | Downloads; headers/quotes valid.                                                    |
| E2  | Export positions JSON    | Downloads; decimal strings preserved.                                               |
| E3  | Export trade groups CSV  | Negative numbers remain numeric; formula-like text is prefixed with `'`.            |
| E4  | Export audit             | `export.generated` entry written.                                                   |

## Security and resilience

| ID  | Check                                           | Expected                                                                    |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| R1  | Request a protected API route without a session | `401`, error envelope, no data.                                             |
| R2  | Mutation without `x-csrf-token`                 | `403`, no mutation.                                                         |
| R3  | Mutation with a foreign `Origin`                | `403`, no mutation.                                                         |
| R4  | API responses                                   | `Cache-Control: no-store`; security headers present; no docs in production. |
| R5  | Error responses                                 | No stack traces, SQL, secrets, or request bodies.                           |
| R6  | Responsive layout                               | No horizontal overflow at 360px; dialogs usable.                            |
| R7  | Offline/partial failure                         | Existing data remains visible with a retry path; no blank crash.            |
| R8  | No trackers                                     | No third-party analytics or external scripts in the network log.            |

## Sign-off

| Role        | Name | Date | Result | Notes |
| ----------- | ---- | ---- | ------ | ----- |
| Owner       |      |      |        |       |
| Engineering |      |      |        |       |

Record failures with the check ID, environment, timestamp, and a screenshot that does not contain secrets. Do not change acceptance tests to make a failing check pass.

## Phase 8 — Swap execution

Run only with explicit owner approval for real funds. Use a small amount.

| ID   | Check                          | Expected                                                                    |
| ---- | ------------------------------ | --------------------------------------------------------------------------- |
| SW1  | Connect Tangem on `/swap`      | Light WalletConnect modal; BSC badge; address matches allowlist.            |
| SW2  | Quote POP/USDC or a small pair | Amounts, minOut, gas, price impact shown.                                   |
| SW3  | Build                          | Calldata validation passes; router/recipient/minOut/deadline shown.         |
| SW4  | Approval required              | Exact approval amount/spender shown; no unlimited approval.                 |
| SW5  | Sign approval in Tangem        | Exact approval on device; receipt confirmed; ready check passes.            |
| SW6  | Sign swap in Tangem            | Router/recipient/amount/minOut displayed; hash recorded.                    |
| SW7  | Tracking                       | `SUBMITTED` → `PENDING` → `CONFIRMED` with 15+ confirmations.               |
| SW8  | Accounting                     | `/swap` history shows “учёт создан”; portfolio and trades reflect the swap. |
| SW9  | Rejection/cancel               | Rejecting wallet prompt returns to READY; no duplicate signing.             |
| SW10 | Kill switch                    | New signing disabled; signed-hash recovery still records the hash.          |
