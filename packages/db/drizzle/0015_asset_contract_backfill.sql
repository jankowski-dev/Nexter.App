UPDATE "assets" AS a
SET "contract_address" = v."contract_address", "decimals" = v."decimals", "updated_at" = now()
FROM (VALUES
  ('bsc', 'USDC', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', 18),
  ('bsc', 'XNY', '0xe3225e11cab122f1a126a28997788e5230838ab9', 18),
  ('bsc', 'BASED', '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d', 18),
  ('bsc', 'APR', '0x299ad4299da5b2b93fba4c96967b040c7f611099', 18),
  ('bsc', 'POP', '0xa3cfb853339b77f385b994799b015cb04b208fe6', 18),
  ('bsc', 'LINK', '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd', 18),
  ('bsc', 'USDT', '0x55d398326f99059ff775485246999027b3197955', 18),
  ('ethereum', 'USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6),
  ('ethereum', 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', 18),
  ('ethereum', 'BASED', '0x4f2b33840227ddd0e28da8d4185d6fa07adfed87', 18),
  ('ethereum', 'APR', '0x5a9610919f5e81183823a2be4bd1beb2b4da2a20', 18),
  ('ethereum', 'USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7', 6)
) AS v("chain_code", "symbol", "contract_address", "decimals")
JOIN "chains" c ON c."code" = v."chain_code"
WHERE a."chain_id" = c."id" AND a."symbol" = v."symbol";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE watched_addresses, indexed_transfers, reconciliation_runs, reconciliation_items TO nexter_app';
    EXECUTE 'REVOKE DELETE ON TABLE watched_addresses, indexed_transfers, reconciliation_runs, reconciliation_items FROM nexter_app';
    EXECUTE 'REVOKE UPDATE ON TABLE indexed_transfers, reconciliation_items FROM nexter_app';
  END IF;
END
$$;
