CREATE TABLE "sandbox_candles" (
	"token_key" text NOT NULL,
	"timeframe" text NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"open" numeric(30, 18) NOT NULL,
	"high" numeric(30, 18) NOT NULL,
	"low" numeric(30, 18) NOT NULL,
	"close" numeric(30, 18) NOT NULL,
	"volume_usd" numeric(30, 18) DEFAULT '0' NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_candles_pk" PRIMARY KEY("token_key","timeframe","open_time")
);
--> statement-breakpoint
CREATE TABLE "sandbox_equity_points" (
	"run_id" uuid NOT NULL,
	"clock_time" timestamp with time zone NOT NULL,
	"equity_usd" numeric(18, 2) NOT NULL,
	"cash_usd" numeric(18, 2) NOT NULL,
	"positions_value_usd" numeric(18, 2) NOT NULL,
	"drawdown_pct" numeric(9, 4) NOT NULL,
	CONSTRAINT "sandbox_equity_points_pk" PRIMARY KEY("run_id","clock_time")
);
--> statement-breakpoint
CREATE TABLE "sandbox_events" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"clock_time" timestamp with time zone NOT NULL,
	"module" text NOT NULL,
	"event_type" text NOT NULL,
	"severity" text NOT NULL,
	"token_id" text,
	"strategy_id" text,
	"regime" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hash" text NOT NULL,
	"prev_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_events_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "sandbox_intents" (
	"run_id" uuid NOT NULL,
	"intent_id" text NOT NULL,
	"token_id" text NOT NULL,
	"side" text NOT NULL,
	"strategy_key" text NOT NULL,
	"strategy_version" integer NOT NULL,
	"status" text NOT NULL,
	"requested_usd" numeric(18, 2),
	"requested_amount" numeric(38, 8),
	"filled_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"filled_amount" numeric(38, 8) DEFAULT '0' NOT NULL,
	"price_usd" numeric(30, 18),
	"fee_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reason_code" text NOT NULL,
	"strategy_reason_code" text,
	"reason_text" text DEFAULT '' NOT NULL,
	"decision_time" timestamp with time zone NOT NULL,
	"fill_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_intents_pk" PRIMARY KEY("run_id","intent_id")
);
--> statement-breakpoint
CREATE TABLE "sandbox_ledger_entries" (
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"entry_id" text NOT NULL,
	"clock_time" timestamp with time zone NOT NULL,
	"token_id" text NOT NULL,
	"side" text NOT NULL,
	"intent_id" text NOT NULL,
	"amount" numeric(38, 8) NOT NULL,
	"price_usd" numeric(30, 18) NOT NULL,
	"notional_usd" numeric(18, 2) NOT NULL,
	"fee_usd" numeric(18, 2) NOT NULL,
	"cost_basis_released_usd" numeric(18, 2),
	"position_cost_basis_after_usd" numeric(18, 2) NOT NULL,
	"cash_after_usd" numeric(18, 2) NOT NULL,
	"position_amount_after" numeric(38, 8) NOT NULL,
	"position_avg_cost_after" numeric(30, 18),
	"realized_pnl_usd" numeric(18, 2),
	"reason_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_ledger_entries_pk" PRIMARY KEY("run_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "sandbox_positions" (
	"run_id" uuid NOT NULL,
	"token_id" text NOT NULL,
	"strategy_key" text NOT NULL,
	"strategy_version" integer NOT NULL,
	"amount" numeric(38, 8) NOT NULL,
	"avg_cost_usd" numeric(30, 18) NOT NULL,
	"cost_basis_usd" numeric(18, 2) NOT NULL,
	"market_price_usd" numeric(30, 18) NOT NULL,
	"market_value_usd" numeric(18, 2) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"stop_loss_pct" numeric(9, 4),
	"take_profit_pct" numeric(9, 4),
	"fees_paid_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_positions_pk" PRIMARY KEY("run_id","token_id")
);
--> statement-breakpoint
CREATE TABLE "sandbox_reports" (
	"run_id" uuid NOT NULL,
	"report_hash" text NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_reports_pk" PRIMARY KEY("run_id","report_hash")
);
--> statement-breakpoint
CREATE TABLE "sandbox_run_tokens" (
	"run_id" uuid NOT NULL,
	"token_key" text NOT NULL,
	"symbol" text NOT NULL,
	"chain" text NOT NULL,
	"contract_address" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_run_tokens_pk" PRIMARY KEY("run_id","token_key")
);
--> statement-breakpoint
CREATE TABLE "sandbox_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"initial_capital_usd" numeric(18, 2) NOT NULL,
	"cash_usd" numeric(18, 2) NOT NULL,
	"equity_usd" numeric(18, 2) NOT NULL,
	"peak_equity_usd" numeric(18, 2) NOT NULL,
	"day_start_equity_usd" numeric(18, 2) NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"engine_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ledger_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_bar_close" timestamp with time zone,
	"event_seq" integer DEFAULT 0 NOT NULL,
	"event_hash" text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"last_tick_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sandbox_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_key" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"chain" text NOT NULL,
	"contract_address" text,
	"coingecko_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_trades" (
	"run_id" uuid NOT NULL,
	"trade_id" text NOT NULL,
	"token_id" text NOT NULL,
	"strategy_key" text NOT NULL,
	"strategy_version" integer NOT NULL,
	"entry_at" timestamp with time zone NOT NULL,
	"entry_price_usd" numeric(30, 18) NOT NULL,
	"entry_amount" numeric(38, 8) NOT NULL,
	"entry_notional_usd" numeric(18, 2) NOT NULL,
	"entry_fee_usd" numeric(18, 2) NOT NULL,
	"entry_cost_basis_usd" numeric(18, 2) NOT NULL,
	"entry_intent_id" text,
	"exit_at" timestamp with time zone,
	"exit_price_usd" numeric(30, 18),
	"exit_amount" numeric(38, 8) DEFAULT '0' NOT NULL,
	"exit_notional_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"exit_fee_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"exit_reason_code" text,
	"exit_intent_id" text,
	"realized_pnl_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_trades_pk" PRIMARY KEY("run_id","trade_id")
);
--> statement-breakpoint
ALTER TABLE "sandbox_equity_points" ADD CONSTRAINT "sandbox_equity_points_run_id_sandbox_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_events" ADD CONSTRAINT "sandbox_events_run_id_sandbox_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_intents" ADD CONSTRAINT "sandbox_intents_run_id_sandbox_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_ledger_entries" ADD CONSTRAINT "sandbox_ledger_entries_run_id_sandbox_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_positions" ADD CONSTRAINT "sandbox_positions_run_id_sandbox_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_reports" ADD CONSTRAINT "sandbox_reports_run_id_sandbox_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_run_tokens" ADD CONSTRAINT "sandbox_run_tokens_run_id_sandbox_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_runs" ADD CONSTRAINT "sandbox_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_tokens" ADD CONSTRAINT "sandbox_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_trades" ADD CONSTRAINT "sandbox_trades_run_id_sandbox_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_candles_token_time_idx" ON "sandbox_candles" USING btree ("token_key","open_time");--> statement-breakpoint
CREATE INDEX "sandbox_events_run_clock_idx" ON "sandbox_events" USING btree ("run_id","clock_time");--> statement-breakpoint
CREATE INDEX "sandbox_intents_run_decision_idx" ON "sandbox_intents" USING btree ("run_id","decision_time");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_ledger_entries_run_entry_unique" ON "sandbox_ledger_entries" USING btree ("run_id","entry_id");--> statement-breakpoint
CREATE INDEX "sandbox_runs_user_status_archived_idx" ON "sandbox_runs" USING btree ("user_id","status","archived_at");--> statement-breakpoint
CREATE INDEX "sandbox_runs_status_idx" ON "sandbox_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_tokens_user_token_unique" ON "sandbox_tokens" USING btree ("user_id","token_key");--> statement-breakpoint
CREATE INDEX "sandbox_tokens_user_idx" ON "sandbox_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sandbox_trades_run_token_idx" ON "sandbox_trades" USING btree ("run_id","token_id");
-- Sandbox Stage 2 grants. Events are append-only; projection tables are upserted
-- by the runner. No DELETE on any sandbox table. No sequences are used (uuid keys).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON sandbox_tokens, sandbox_candles, sandbox_runs, sandbox_run_tokens, sandbox_positions, sandbox_trades, sandbox_ledger_entries, sandbox_equity_points, sandbox_intents, sandbox_reports TO nexter_app;
    GRANT SELECT, INSERT ON sandbox_events TO nexter_app;
    REVOKE DELETE ON sandbox_tokens, sandbox_candles, sandbox_runs, sandbox_run_tokens, sandbox_events, sandbox_positions, sandbox_trades, sandbox_ledger_entries, sandbox_equity_points, sandbox_intents, sandbox_reports FROM nexter_app;
  END IF;
END $$;
