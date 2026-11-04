CREATE TABLE "external_api_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"status" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain" text NOT NULL,
	"wallet_address" text,
	"token_in" text NOT NULL,
	"token_out" text NOT NULL,
	"token_in_symbol" text NOT NULL,
	"token_out_symbol" text NOT NULL,
	"amount_in" numeric(36, 18) NOT NULL,
	"amount_out" numeric(36, 18) NOT NULL,
	"min_out" numeric(36, 18) NOT NULL,
	"slippage_bps" integer NOT NULL,
	"price_impact_bps" integer,
	"route_id" text,
	"route_summary" jsonb NOT NULL,
	"router_address" text,
	"calldata" text,
	"transaction_value" numeric(78, 0),
	"gas_estimate" numeric(24, 0),
	"gas_usd" numeric(24, 8),
	"status" text DEFAULT 'QUOTED' NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quote_expires_at" timestamp with time zone NOT NULL,
	"built_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_api_calls" ADD CONSTRAINT "external_api_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_events" ADD CONSTRAINT "swap_events_order_id_swap_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."swap_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_orders" ADD CONSTRAINT "swap_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_api_calls_created_idx" ON "external_api_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "swap_events_order_created_idx" ON "swap_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "swap_orders_user_created_idx" ON "swap_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "swap_orders_status_idx" ON "swap_orders" USING btree ("status");