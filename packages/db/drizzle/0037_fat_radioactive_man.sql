ALTER TABLE "bot_backtest_runs" ADD COLUMN "use_stop_loss" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_backtest_runs" ADD COLUMN "use_take_profit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_backtest_runs" ADD COLUMN "reinvest_profit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT DELETE ON bot_backtest_runs TO nexter_app;
  END IF;
END $$;
