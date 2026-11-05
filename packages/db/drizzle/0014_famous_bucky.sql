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
