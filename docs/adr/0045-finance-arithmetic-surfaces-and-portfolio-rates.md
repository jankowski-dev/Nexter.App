# ADR 0045 — Finance arithmetic, metric surfaces, portfolio rates, and swap balances

## Status

Accepted for UI-54 on 2026-11-15. No migration.

## Context

The owner requested a batch of usability and visual fixes across Finance, Dashboard, Statistics, Portfolio, the wallet buy drawer, and the auth/lock shell:

- finance amount fields should accept arithmetic expressions such as `18,55-6-89-56` and normalize on blur;
- the quick-lock button should not look outlined and its icon should not touch the label;
- the dashboard crypto card should not repeat the header price-freshness counter;
- the crypto/finance dashboard and the Finance/Statistics metric cards should use the same highlighted surfaces as the portfolio stat cards;
- the sidebar should use the 12-ray logo and the `Nexter System / Analytics and Automation` brand;
- the login screen should match the supplied minimal auth concept: no brand/title text, no labels above fields, no forgot-password link, no seed-phrase note;
- portfolio token cards should show the current rate and 24h change, with a smaller active-order count;
- the invested metric should show this token's share of all active invested capital;
- the stablecoin dropdown in the buy drawer should show wallet balances and look custom;
- the realized P&L monthly chart should be modern;
- missing dark-theme surfaces should be fixed.

## Decision

- **Safe arithmetic input.** `evaluateExpression` tokenizes a small arithmetic grammar (`+ - * / ()`, comma or dot decimals) and evaluates it with `decimal.js`; it does not use `eval`. `ExpressionInput` normalizes on blur/Enter and shows an inline validation message for malformed input. `normalizeAmountInput` is used in finance save handlers so a save without blurring is still normalized. Applied to transaction, transfer, account-opening, credit, FX and destination-amount fields.
- **Metric surfaces.** Shared `.tone-surface-*` classes provide emerald/sky/amber/violet/rose gradients with dark-theme variants. They are used by portfolio stat cards, the dashboard crypto/finance blocks, Finance KPI cards, and Statistics metric cards. Missing dark-theme bridges were added for tinted backgrounds, borders, descriptions and values.
- **Sidebar brand.** The sidebar uses the 12-ray `NexterLogo` and the `Nexter System` / `Analytics and Automation` wordmark. The auth page no longer repeats the brand text.
- **Auth cleanup.** The login screen is the minimal concept: logo, two dark fields with placeholders only, and the primary action. The auth layout no longer shows the `NEXTER / личные финансы` block, the seed-phrase note, or the forgot-password link.
- **Portfolio rates and share.** `PortfolioTokenSummary` gains nullable `priceUsd`/`change24hPct`, enriched from `PricingService.latestForAssets`. The consolidated card shows the rate (colored by 24h change) and the change next to it; the active-order count moves to a small text near the rate. The invested metric shows the absolute invested value and this token's share of total active invested capital as a green progress bar and percentage.
- **Swap balances.** `GET /swap/balances?chain=&wallet=` returns USDC/USDT balances read through `EvmRpcService` for the authenticated owner. Values are `null` when the RPC is unavailable. The buy/sell drawer uses a custom `StablecoinSelect` that shows symbol, name and wallet balance in both the closed and open states. The endpoint performs read-only calls and adds no signing or execution permission.
- **P&L chart.** `BarChart` is rebuilt as a responsive SVG with zero line, grid, compact axis labels, gradient bars, hover/focus highlight and a tooltip. It keeps the `points` API used by Statistics.
- **No server execution changes.** No ledger, swap signing, private-key, or migration changes.

## Consequences

- A six-digit quick-lock PIN remains a privacy screen; this batch only changes its button styling and surrounding brand/auth shell.
- Finance arithmetic uses display-time normalization; the API still receives decimal strings. Invalid expressions block the save with the existing form error.
- Rate/share data depends on the pricing service; tokens without a quote show `—` and a zero-width share bar.
- Wallet balances are read-only and may be unavailable without `BSC_RPC_URL`/`ETHEREUM_RPC_URL`; the selector then shows `—` instead of blocking the trade.
- Dark mode is improved for the touched surfaces, but arbitrary future utility colors still need the same bridge discipline.

## Verification

- `apps/web/src/lib/expression.test.ts` covers the finance example, precedence, parentheses, unary values, invalid input and division by zero.
- Existing API tests and the full web test suite pass; the swap token registry contract and balances endpoint keep the existing allowlist and auth gates.
- Manually checked login, lock, dashboard, Finance, Statistics and Portfolio in light and dark widths.
