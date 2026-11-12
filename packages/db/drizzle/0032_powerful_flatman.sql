CREATE TABLE "bot_equity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"cash_usd" numeric(24, 8) NOT NULL,
	"positions_value_usd" numeric(24, 8) NOT NULL,
	"equity_usd" numeric(24, 8) NOT NULL,
	"realized_pnl_usd" numeric(24, 8) NOT NULL,
	"unrealized_pnl_usd" numeric(24, 8) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"avg_cost_usd" numeric(24, 8) NOT NULL,
	"cost_basis_usd" numeric(24, 8) NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_quote_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"price_usd" numeric(36, 18) NOT NULL,
	"change_24h_pct" numeric(12, 4),
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"side" text NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"price_usd" numeric(36, 18) NOT NULL,
	"usd_value" numeric(24, 8) NOT NULL,
	"fee_usd" numeric(24, 8) NOT NULL,
	"slippage_usd" numeric(24, 8) NOT NULL,
	"realized_pnl_usd" numeric(24, 8) DEFAULT '0' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"signal" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"budget_usd" numeric(24, 8) NOT NULL,
	"cash_usd" numeric(24, 8) NOT NULL,
	"max_positions" integer DEFAULT 5 NOT NULL,
	"position_size_pct" numeric(5, 2) DEFAULT '20' NOT NULL,
	"fee_bps" integer DEFAULT 25 NOT NULL,
	"slippage_bps" integer DEFAULT 10 NOT NULL,
	"max_daily_loss_pct" numeric(5, 2) DEFAULT '10' NOT NULL,
	"cooldown_minutes" integer DEFAULT 15 NOT NULL,
	"peak_equity_usd" numeric(24, 8) DEFAULT '0' NOT NULL,
	"max_drawdown_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"last_tick_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_equity_snapshots" ADD CONSTRAINT "bot_equity_snapshots_bot_id_trading_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."trading_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_events" ADD CONSTRAINT "bot_events_bot_id_trading_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."trading_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_bot_id_trading_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."trading_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD CONSTRAINT "bot_positions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_quote_samples" ADD CONSTRAINT "bot_quote_samples_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_strategies" ADD CONSTRAINT "bot_strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_tokens" ADD CONSTRAINT "bot_tokens_bot_id_trading_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."trading_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_tokens" ADD CONSTRAINT "bot_tokens_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_trades" ADD CONSTRAINT "bot_trades_bot_id_trading_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."trading_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_trades" ADD CONSTRAINT "bot_trades_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_bots" ADD CONSTRAINT "trading_bots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_bots" ADD CONSTRAINT "trading_bots_strategy_id_bot_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."bot_strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_equity_bot_time_idx" ON "bot_equity_snapshots" USING btree ("bot_id","captured_at");--> statement-breakpoint
CREATE INDEX "bot_equity_time_idx" ON "bot_equity_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "bot_events_bot_time_idx" ON "bot_events" USING btree ("bot_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_events_time_idx" ON "bot_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_positions_bot_asset_unique" ON "bot_positions" USING btree ("bot_id","asset_id");--> statement-breakpoint
CREATE INDEX "bot_positions_bot_idx" ON "bot_positions" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "bot_quote_samples_asset_time_idx" ON "bot_quote_samples" USING btree ("asset_id","captured_at");--> statement-breakpoint
CREATE INDEX "bot_quote_samples_time_idx" ON "bot_quote_samples" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_strategies_user_name_unique" ON "bot_strategies" USING btree ("user_id","name") WHERE "bot_strategies"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "bot_strategies_user_idx" ON "bot_strategies" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_tokens_bot_asset_unique" ON "bot_tokens" USING btree ("bot_id","asset_id");--> statement-breakpoint
CREATE INDEX "bot_tokens_asset_idx" ON "bot_tokens" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "bot_trades_bot_time_idx" ON "bot_trades" USING btree ("bot_id","executed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_bots_user_name_unique" ON "trading_bots" USING btree ("user_id","name") WHERE "trading_bots"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "trading_bots_user_idx" ON "trading_bots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trading_bots_status_idx" ON "trading_bots" USING btree ("status");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON bot_strategies TO nexter_app;
    GRANT SELECT, INSERT, UPDATE ON trading_bots TO nexter_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bot_tokens TO nexter_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bot_positions TO nexter_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bot_trades TO nexter_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bot_equity_snapshots TO nexter_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bot_events TO nexter_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bot_quote_samples TO nexter_app;
  END IF;
END $$;
