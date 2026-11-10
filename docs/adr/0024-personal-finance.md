# ADR 0024 — Personal finance module

## Status

Accepted for the personal-finance module (2026-11-10).

## Context

The owner keeps a personal finance system in Notion: expense, income, and transfer databases linked to accounts and a derived statistics database. The data covers 27.05.2026–09.11.2026 and contains 212 expense rows, 41 income rows, 43 transfers, seven accounts, and three currencies (BYN, USD, EUR). It is manual bookkeeping only: no swaps, no tax logic, and no budgets or goals.

The existing Nexter ledger is a crypto accounting ledger with lots, FIFO, trade groups, and USD-based P&L. Mixing personal cash flow into it would distort portfolio P&L and make the accounting model harder to reason about.

## Decision

- **Separate module.** Personal finance lives in a separate `finance` API module and a separate `Финансы` section in the UI. It never writes to `transactions`, `postings`, `lots`, or `trade_groups`, and it does not appear in the crypto dashboard or P&L.
- **Base currency is BYN.** The module reports in BYN. USD and EUR accounts keep their native balance and an explicit `fx_rate` to BYN. The rest of Nexter remains USD-based.
- **Import-time FX.** Conversions use the account's rate at import time (BYN 1, USD 2.965, EUR 3.29). Each transaction stores its own `fx_rate` and `base_amount`, so later rate changes do not rewrite history. Rounding uses half-even to two decimals to match the Notion rollups.
- **Opening balances.** The five Notion rows with category `Корректировка` (13.60 BYN card, 65 BYN cash, 910 USD dollars, 7 315 BYN investment, −2 646 BYN credit) become account opening balances, not income or expense. They are excluded from monthly cash-flow reports.
- **Credit is a liability.** The credit account stores a negative balance (opening −2 646 plus repayments). Net worth is assets minus the absolute credit balance. Computed current net worth is 12 129.05 BYN (assets 13 067.58, liabilities 938.53).
- **Credit drawdown.** The accounts page has a `Получить кредит` action. It creates a new credit account or uses an existing one, records the principal and date, and optionally credits the money to a non-credit account. With a destination, the action creates a `credit` transfer (cash increases, debt increases, net worth unchanged). Without a destination, it increases the credit account's opening debt balance. Neither path creates income or expense. No schema change is required.
- **Schema.** Migration `0023` adds `finance_accounts`, `finance_categories`, `finance_transactions`, `finance_transfers`, `finance_imports`, and `finance_import_rows`; migrations `0024` and `0025` add positive-amount, positive-rate, and BYN-rate checks. Amounts use `numeric(20,2)`, rates `numeric(18,8)`, dates are date-only, and every row is owner-scoped. Migration `0023` conditionally grants DML on the finance tables to the `nexter_app` role when that role exists.
- **No destructive deletes.** Accounts, categories, transactions, and transfers are archived with `archived_at`. In the journal the action is labelled `Отменить` with confirmation, and the `Отменённые` tab shows cancelled rows with a `Вернуть` action; cancelled rows are excluded from income/expense and net worth. The only hard deletes are an explicit finance-import rollback, scoped to rows created by that import, and an explicit image-style attachment removal if added later.
- **Import pipeline.** `POST /finance/import/preview` validates a normalized JSON export, stages rows, and reports counts, duplicates, warnings, and errors. `POST /finance/import/:id/commit` applies it idempotently by source id. `POST /finance/import/:id/rollback` rolls back only the newest committed finance import. The original Notion export remains the archive.
- **Data mapping.** Expense and income rows store date, account, category, amount, title, and description. Transfer rows store source/destination accounts and both amounts; `Обмен валют`, `Пополнение карты`, and `Кредит` map to fixed transfer kinds. The two uncategorized 500/560 BYN cash-to-card transfers are mapped to `Пополнение карты` by owner decision. The two identical 100 BYN income rows on 17.08.2026 are kept as two real operations.
- **No budgets or goals.** The Notion source has no budget or goal database. The module mirrors only accounts, categories, operations, transfers, and monthly statistics. Budgets can be a later feature.
- **No tax logic.** Reports are cash-flow and net-worth views; the module does not calculate taxes.
- **Audit and privacy.** Every mutation is audited with ids and key amounts, not descriptions. The normalized import file is kept outside the repository; personal finance rows are not committed to git.

## Consequences

- The crypto ledger and personal finance remain independent; neither can silently change the other's totals.
- Imported history reproduces Notion's current balances and net worth, but historical BYN conversions are fixed at import-time rates. If historical rates are added later, reports can be recalculated deliberately, not silently.
- The module is multi-currency in storage but single-base in reporting. Adding another base currency requires a settings decision and a reporting migration.
- Import rollback is intentionally narrow. Once manual activity is added after an import, rollback should be refused or performed with explicit cleanup rather than deleting live data.
- Accounts and categories are soft-archived; existing transactions keep their references.
