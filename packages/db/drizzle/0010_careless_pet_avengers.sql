CREATE TABLE "token_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"wallet_address" text NOT NULL,
	"token_address" text NOT NULL,
	"spender_address" text NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"status" text DEFAULT 'BUILT' NOT NULL,
	"tx_hash" text,
	"block_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "step_up_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "tx_hash" text;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "nonce" integer;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "deadline" integer;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "confirmations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "block_number" integer;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "network_fee_wei" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "network_fee_usd" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "accounting_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "trade_group_id" uuid;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "token_approvals" ADD CONSTRAINT "token_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_approvals" ADD CONSTRAINT "token_approvals_order_id_swap_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."swap_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "token_approvals_user_created_idx" ON "token_approvals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "token_approvals_order_idx" ON "token_approvals" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "swap_orders" ADD CONSTRAINT "swap_orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD CONSTRAINT "swap_orders_accounting_transaction_id_transactions_id_fk" FOREIGN KEY ("accounting_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD CONSTRAINT "swap_orders_trade_group_id_trade_groups_id_fk" FOREIGN KEY ("trade_group_id") REFERENCES "public"."trade_groups"("id") ON DELETE set null ON UPDATE no action;