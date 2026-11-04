ALTER TABLE "swap_orders" ADD COLUMN "amount_in_usd" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "token_approvals" ADD COLUMN "calldata" text;--> statement-breakpoint
CREATE UNIQUE INDEX "swap_orders_tx_hash_unique" ON "swap_orders" USING btree ("tx_hash") WHERE "swap_orders"."tx_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "token_approvals_tx_hash_unique" ON "token_approvals" USING btree ("tx_hash") WHERE "token_approvals"."tx_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "token_approvals_active_unique" ON "token_approvals" USING btree ("order_id","token_address","spender_address") WHERE "token_approvals"."status" in ('BUILT', 'SUBMITTED', 'CONFIRMED');