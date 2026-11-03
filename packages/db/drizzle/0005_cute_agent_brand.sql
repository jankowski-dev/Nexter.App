CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"chain_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"contract_address" text,
	"decimals" integer DEFAULT 18 NOT NULL,
	"coingecko_id" text,
	"is_stablecoin" boolean DEFAULT false NOT NULL,
	"is_cash_equivalent" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"disposal_transaction_id" uuid NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"cost_basis_usd" numeric(24, 8) NOT NULL,
	"proceeds_usd" numeric(24, 8) NOT NULL,
	"realized_pnl_usd" numeric(24, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"trade_group_id" uuid,
	"acquisition_transaction_id" uuid NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"remaining_amount" numeric(36, 18) NOT NULL,
	"cost_basis_usd" numeric(24, 8) NOT NULL,
	"remaining_cost_basis_usd" numeric(24, 8) NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"usd_value" numeric(24, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"price_usd" numeric(24, 8) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_group_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"reference_price_usd" numeric(24, 8),
	"execution_cost_usd" numeric(24, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"subtype" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"trade_group_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_disposal_transaction_id_transactions_id_fk" FOREIGN KEY ("disposal_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_trade_group_id_trade_groups_id_fk" FOREIGN KEY ("trade_group_id") REFERENCES "public"."trade_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_acquisition_transaction_id_transactions_id_fk" FOREIGN KEY ("acquisition_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_details" ADD CONSTRAINT "trade_details_trade_group_id_trade_groups_id_fk" FOREIGN KEY ("trade_group_id") REFERENCES "public"."trade_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_details" ADD CONSTRAINT "trade_details_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_groups" ADD CONSTRAINT "trade_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_groups" ADD CONSTRAINT "trade_groups_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_trade_group_id_trade_groups_id_fk" FOREIGN KEY ("trade_group_id") REFERENCES "public"."trade_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_name_unique" ON "accounts" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_chain_symbol_unique" ON "assets" USING btree ("chain_id","symbol");--> statement-breakpoint
CREATE INDEX "assets_chain_id_idx" ON "assets" USING btree ("chain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chains_code_unique" ON "chains" USING btree ("code");--> statement-breakpoint
CREATE INDEX "lot_consumptions_lot_idx" ON "lot_consumptions" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "lot_consumptions_transaction_idx" ON "lot_consumptions" USING btree ("disposal_transaction_id");--> statement-breakpoint
CREATE INDEX "lots_user_asset_idx" ON "lots" USING btree ("user_id","asset_id");--> statement-breakpoint
CREATE INDEX "lots_remaining_idx" ON "lots" USING btree ("remaining_amount");--> statement-breakpoint
CREATE INDEX "lots_group_idx" ON "lots" USING btree ("trade_group_id");--> statement-breakpoint
CREATE INDEX "postings_transaction_idx" ON "postings" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "postings_account_asset_idx" ON "postings" USING btree ("account_id","asset_id");--> statement-breakpoint
CREATE INDEX "prices_asset_observed_idx" ON "prices" USING btree ("asset_id","observed_at");--> statement-breakpoint
CREATE INDEX "trade_details_group_idx" ON "trade_details" USING btree ("trade_group_id");--> statement-breakpoint
CREATE INDEX "trade_details_transaction_idx" ON "trade_details" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "trade_groups_user_id_idx" ON "trade_groups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trade_groups_asset_id_idx" ON "trade_groups" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "transactions_user_time_idx" ON "transactions" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_trade_group_idx" ON "transactions" USING btree ("trade_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_source_unique" ON "transactions" USING btree ("user_id","source","source_id") WHERE "transactions"."source_id" is not null;--> statement-breakpoint
INSERT INTO "chains" ("code", "name") VALUES ('bsc', 'BNB Smart Chain'), ('ethereum', 'Ethereum') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "assets" ("chain_id", "symbol", "name", "decimals", "coingecko_id", "is_stablecoin", "is_cash_equivalent", "is_verified")
SELECT c."id", v."symbol", v."name", v."decimals", v."coingecko_id", v."is_stablecoin", v."is_cash_equivalent", v."is_verified"
FROM (VALUES
  ('bsc', 'USDC', 'USD Coin', 18, 'usd-coin', true, true, true),
  ('bsc', 'XNY', 'XNY', 18, NULL, false, false, false),
  ('bsc', 'BASED', 'Based', 18, NULL, false, false, false),
  ('bsc', 'APR', 'APR', 18, NULL, false, false, false),
  ('bsc', 'POP', 'POP', 18, NULL, false, false, false),
  ('bsc', 'LINK', 'Chainlink', 18, 'chainlink', false, false, true),
  ('bsc', 'BNB', 'BNB', 18, 'binancecoin', false, false, true),
  ('ethereum', 'USDC', 'USD Coin', 6, 'usd-coin', true, true, true),
  ('ethereum', 'LINK', 'Chainlink', 18, 'chainlink', false, false, true),
  ('ethereum', 'BASED', 'Based', 18, NULL, false, false, false),
  ('ethereum', 'APR', 'APR', 18, NULL, false, false, false),
  ('ethereum', 'ETH', 'Ether', 18, 'ethereum', false, false, true)
) AS v("chain_code", "symbol", "name", "decimals", "coingecko_id", "is_stablecoin", "is_cash_equivalent", "is_verified")
JOIN "chains" c ON c."code" = v."chain_code"
ON CONFLICT ("chain_id", "symbol") DO NOTHING;