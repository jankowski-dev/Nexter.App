ALTER TABLE "transactions" ADD COLUMN "fees_usd" numeric(24, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
INSERT INTO "assets" ("chain_id", "symbol", "name", "decimals", "coingecko_id", "is_stablecoin", "is_cash_equivalent", "is_verified")
SELECT c."id", v."symbol", v."name", v."decimals", v."coingecko_id", v."is_stablecoin", v."is_cash_equivalent", v."is_verified"
FROM (VALUES
  ('bsc', 'USDT', 'Tether USD', 18, 'tether', true, true, true),
  ('ethereum', 'USDT', 'Tether USD', 6, 'tether', true, true, true)
) AS v("chain_code", "symbol", "name", "decimals", "coingecko_id", "is_stablecoin", "is_cash_equivalent", "is_verified")
JOIN "chains" c ON c."code" = v."chain_code"
ON CONFLICT ("chain_id", "symbol") DO NOTHING;