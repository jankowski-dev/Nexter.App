# Decision Log

Format: date — decision — reason.

## 2026-11-02

- **Single-user application.** One owner, closed registration, `user_id` in future tables. Simpler auth and data model.
- **USD as base accounting currency.** BYN is deferred and will be a reporting/display currency.
- **Non-custodial swaps only.** Private keys stay in Tangem; the server never signs.
- **BSC first, Ethereum second.** Lower fees and faster iteration on BSC.
- **Modular monolith.** NestJS + React SPA + Postgres + worker; no microservices.
- **Postgres + Drizzle.** SQL control, typed schema, forward-only migrations.
- **pg-boss instead of Redis.** Fewer services, transactional jobs on Postgres.
- **Ledger + postings + FIFO lots.** Required for auditable accounting, transfers, fees, and partial exits.
- **FIFO is global per asset for MVP.** Simpler than per-account lots; can be extended later.
- **Stablecoins are cash equivalents.** No FIFO lots for USDT/USDC; depeg flag stays.
- **Gas is added to cost basis by default.** Configurable in settings; never double-count execution cost.
- **Notion is the historical source for MVP-1.** On-chain reconciliation is deferred to MVP-3.
- **No wallet access in MVP-1.** The owner explicitly deferred wallet connection.
- **Step-up TOTP threshold $500.** Extra protection for larger swaps; configurable.
- **Cloudflare Access optional.** App auth remains mandatory.
- **RPO 1 hour / RTO 4 hours.** PITR + encrypted dumps to R2.
- **Sentry SaaS with scrubbing.** No PII or wallet addresses in events.

## 2026-11-03

- **NestJS 11, not 12.** NestJS 12 is ESM-first and adds friction for the CJS-oriented Nest toolchain. NestJS 11 is stable and matches the implementation contract.
- **TypeScript 5.9.** Required by the NestJS 11 toolchain; strict mode remains enabled.
- **Worker is ESM.** pg-boss 12 is ESM-only. The worker package uses `"type": "module"` and NodeNext resolution.
- **SPA served by Nest via `@fastify/static` 10.1.8 and an explicit SPA fallback.** `@nestjs/serve-static` was removed because its peer range conflicted with the Fastify adapter; deep links are rewritten to `index.html` with an `onRequest` hook.
- **Fastify pinned to 5.12.8 via pnpm override.** The NestJS adapter’s transitive Fastify version had high-severity advisories; the runtime version is verified in the smoke test.
- **Shared contracts are dual CJS/ESM.** `@nexter/contracts` is built with tsup and consumed by both API and web, including runtime response validation.
- **Typecheck and test build workspace packages first.** A clean checkout must not depend on gitignored `dist/` artifacts.
- **Migration validated with PGlite.** Docker/Postgres was unavailable locally; the SQL schema was executed in an in-memory Postgres-compatible engine without `pgcrypto`.
