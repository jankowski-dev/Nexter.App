CREATE TABLE "pending_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"amount_usd" numeric(24, 2) NOT NULL,
	"trigger_price_usd" numeric(36, 18) NOT NULL,
	"stop_loss_pct" numeric(5, 2),
	"take_profit_pct" numeric(5, 2),
	"status" text DEFAULT 'pending' NOT NULL,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "stop_loss_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "swap_orders" ADD COLUMN "take_profit_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "trade_groups" ADD COLUMN "stop_loss_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "trade_groups" ADD COLUMN "take_profit_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "trade_groups" ADD COLUMN "last_protection_event_key" text;--> statement-breakpoint
ALTER TABLE "pending_orders" ADD CONSTRAINT "pending_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_orders" ADD CONSTRAINT "pending_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_orders_user_status_idx" ON "pending_orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "pending_orders_asset_idx" ON "pending_orders" USING btree ("asset_id");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON pending_orders TO nexter_app;
    REVOKE DELETE ON pending_orders FROM nexter_app;
  END IF;
END $$;
