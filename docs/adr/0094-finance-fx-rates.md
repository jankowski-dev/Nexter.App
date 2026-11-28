# ADR 0094 — Finance FX rates from NBRB

## Status

Accepted for the Finance FX rates batch (2026-11-28).

## Context

The personal-finance module stores account rates manually. A new non-BYN account could not be created without a rate, but the previous form left the field blank and the API silently stored `1` when the request omitted it. The owner also wants CNY and a single place to manage BYN rates for USD, EUR and CNY instead of copying values from NBRB by hand.

Finance amounts stay in BYN. Account, transaction and transfer rows keep their frozen `fx_rate` and `base_amount`; the new rate system is a source for **new** accounts and current reporting, not a historical recalculation.

## Decision

- **Source.** Current rates come from the National Bank of the Republic of Belarus (`https://api.nbrb.by/exrates/rates?periodicity=0`). Nexter stores the BYN price of one unit: `Cur_OfficialRate / Cur_Scale`.
- **Schema.** Migration `0056` adds `finance_fx_rates` with one current row per owner and currency (`USD`, `EUR`, `CNY`), a positive `numeric(18,8)` rate, `source` (`nbrb` or `manual`), the NBRB `rate_date`, `fetched_at`, and timestamps. The unique index is `(user_id, currency)`. The migration grants `SELECT, INSERT, UPDATE` to `nexter_app` and no `DELETE`.
- **API.** Owner-only `GET /finance/rates`, `POST /finance/rates/refresh`, `PATCH /finance/rates/:currency` and `POST /finance/rates/:currency/reset`. Refresh fetches NBRB and skips rows whose `source` is `manual`; reset explicitly returns one currency to NBRB. Every mutation writes an audit row (`finance.rates_refreshed`, `finance.rate_manual_override`, `finance.rate_reset`).
- **Freshness.** A response is `stale` when a currency is missing or a non-manual row is older than 12 hours. The settings page refreshes automatically once when it sees stale data; the Finance page only reads rates. NBRB failures return `NBRB_UNAVAILABLE` and do not erase the last stored values.
- **CNY.** `CNY` joins `BYN`, `USD`, `EUR` in the finance currency contract, account dialogs and reporting. Existing account rows are unchanged.
- **Account UX.** New-account and credit dialogs prefill the rate from the stored rate for the selected currency and show whether it is NBRB or manual. The API still requires an explicit positive rate for non-BYN accounts; it never falls back to `1`.
- **Scope.** The legacy JSON import path keeps its existing behavior. Historical transactions are not recalculated. The feature does not touch crypto accounting, sandbox, Stage 3 or trading.

## Consequences

- Rates are a current snapshot, not a historical series. A future historical-rate feature would need its own table and an explicit reporting migration; existing `fx_rate` snapshots remain the accounting truth.
- Manual overrides survive automatic refreshes until the owner resets them.
- NBRB availability is an external dependency. The settings page keeps the last values visible and reports refresh failures; account creation can still use a manual rate.
- `finance_fx_rates` is additive and safe to leave inert on rollback. Rollback is the previous image; the table can remain.
