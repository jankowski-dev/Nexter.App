ALTER TABLE "settings" ADD COLUMN "market_quote_interval_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "market_coingecko_interval_seconds" integer DEFAULT 600 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "market_min_liquidity_usd" numeric(24, 2) DEFAULT '25000.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "chart_default_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "chart_history_refresh_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "swap_default_slippage_bps" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "swap_max_slippage_bps" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "swap_max_price_impact_bps" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "swap_max_gas_usd" numeric(24, 2) DEFAULT '5.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "swap_quote_ttl_seconds" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "bot_tick_interval_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "bot_quote_max_age_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "bot_default_budget_usd" numeric(24, 2) DEFAULT '1000.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "bot_default_max_positions" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "bot_default_position_size_pct" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "bot_default_fee_bps" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "bot_default_slippage_bps" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "bot_default_daily_loss_pct" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "bot_default_cooldown_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backtest_default_capital_usd" numeric(24, 2) DEFAULT '1000.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backtest_default_fee_bps" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backtest_default_slippage_bps" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backtest_default_days" integer DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backtest_default_stop_loss" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backtest_default_take_profit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backtest_default_reinvest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "task_reminder_lead_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "task_default_due_time" text DEFAULT '12:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "autosave_interval_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_report_period" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "dashboard_poll_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "portfolio_poll_seconds" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "watchlist_poll_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "reports_poll_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "notifications_poll_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "notify_bot_stopped" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "notify_positions_closed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_mode" text DEFAULT 'dry_run' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_max_order_usd" numeric(24, 2) DEFAULT '250.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_max_daily_usd" numeric(24, 2) DEFAULT '500.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_max_actions_per_day" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_cooldown_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_default_stop_loss_pct" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_default_take_profit_pct" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_default_trailing_pct" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_default_buy_drop_pct" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "automation_default_buy_amount_usd" numeric(24, 2) DEFAULT '100.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_chart_default_days" CHECK ("settings"."chart_default_days" in (30, 90, 180, 365));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_default_report_period" CHECK ("settings"."default_report_period" in ('30d', '90d', '365d', 'ytd', 'all'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_automation_mode" CHECK ("settings"."automation_mode" in ('dry_run', 'proposal'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_task_default_due_time" CHECK ("settings"."task_default_due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');