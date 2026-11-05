CREATE TABLE "indexed_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain" text NOT NULL,
	"event_key" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" integer NOT NULL,
	"block_hash" text,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"asset_address" text,
	"amount" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"asset_id" uuid,
	"symbol" text NOT NULL,
	"contract_address" text,
	"ledger_balance" numeric(36, 18) NOT NULL,
	"onchain_balance" numeric(36, 18) NOT NULL,
	"delta" numeric(36, 18) NOT NULL,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"block_number" integer,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watched_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_indexed_block" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watched_addresses" ADD CONSTRAINT "watched_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_transfers_event_key_unique" ON "indexed_transfers" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "indexed_transfers_chain_block_idx" ON "indexed_transfers" USING btree ("chain","block_number");--> statement-breakpoint
CREATE INDEX "indexed_transfers_from_idx" ON "indexed_transfers" USING btree ("chain","from_address");--> statement-breakpoint
CREATE INDEX "indexed_transfers_to_idx" ON "indexed_transfers" USING btree ("chain","to_address");--> statement-breakpoint
CREATE INDEX "reconciliation_items_run_idx" ON "reconciliation_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_user_chain_idx" ON "reconciliation_runs" USING btree ("user_id","chain","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watched_addresses_user_chain_address_unique" ON "watched_addresses" USING btree ("user_id","chain","address");--> statement-breakpoint
CREATE INDEX "watched_addresses_user_chain_idx" ON "watched_addresses" USING btree ("user_id","chain");--> statement-breakpoint
--> statement-breakpoint
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
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE watched_addresses, indexed_transfers, reconciliation_runs, reconciliation_items TO nexter_app';
    EXECUTE 'REVOKE DELETE ON TABLE watched_addresses, indexed_transfers, reconciliation_runs, reconciliation_items FROM nexter_app';
    EXECUTE 'REVOKE UPDATE ON TABLE indexed_transfers, reconciliation_items FROM nexter_app';
  END IF;
END
$$;
