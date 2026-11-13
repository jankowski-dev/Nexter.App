CREATE TABLE "bot_backtest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_key" text NOT NULL,
	"strategy_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"asset_id" uuid NOT NULL,
	"days" integer NOT NULL,
	"source" text NOT NULL,
	"initial_capital_usd" numeric(24, 8) NOT NULL,
	"final_equity_usd" numeric(24, 8) NOT NULL,
	"total_pnl_usd" numeric(24, 8) NOT NULL,
	"total_return_pct" numeric(12, 4) NOT NULL,
	"gross_profit_usd" numeric(24, 8) NOT NULL,
	"gross_loss_usd" numeric(24, 8) NOT NULL,
	"profit_factor" numeric(12, 4),
	"win_rate" numeric(12, 4),
	"trades_count" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"max_drawdown_pct" numeric(12, 4) NOT NULL,
	"buy_hold_return_pct" numeric(12, 4),
	"candles" jsonb NOT NULL,
	"trades" jsonb NOT NULL,
	"equity_curve" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_backtest_runs" ADD CONSTRAINT "bot_backtest_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_backtest_runs" ADD CONSTRAINT "bot_backtest_runs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_backtests_user_strategy_time_idx" ON "bot_backtest_runs" USING btree ("user_id","strategy_key","created_at");--> statement-breakpoint
CREATE INDEX "bot_backtests_asset_time_idx" ON "bot_backtest_runs" USING btree ("asset_id","created_at");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT ON bot_backtest_runs TO nexter_app;
    REVOKE UPDATE, DELETE ON bot_backtest_runs FROM nexter_app;
    REVOKE DELETE ON bot_signals FROM nexter_app;
  END IF;
END $$;
