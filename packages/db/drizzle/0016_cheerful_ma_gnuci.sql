CREATE TABLE "swap_order_close_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"trade_group_id" uuid,
	"asset_id" uuid NOT NULL,
	"expected_amount" numeric(36, 18) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "swap_order_close_groups" ADD CONSTRAINT "swap_order_close_groups_order_id_swap_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."swap_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_order_close_groups" ADD CONSTRAINT "swap_order_close_groups_trade_group_id_trade_groups_id_fk" FOREIGN KEY ("trade_group_id") REFERENCES "public"."trade_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_order_close_groups" ADD CONSTRAINT "swap_order_close_groups_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "swap_order_close_groups_order_idx" ON "swap_order_close_groups" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "swap_order_close_groups_order_group_unique" ON "swap_order_close_groups" USING btree ("order_id","trade_group_id");