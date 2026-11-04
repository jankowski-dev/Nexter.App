ALTER TABLE "swap_orders" ADD COLUMN "executed_amount_in" numeric(36, 18);--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "executed_amount_out" numeric(36, 18);