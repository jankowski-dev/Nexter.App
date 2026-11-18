CREATE TABLE "ai_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"run_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "ai_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"job_id" uuid,
	"type" text NOT NULL,
	"version" text DEFAULT 'v1' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"timeframe" text NOT NULL,
	"strategy_key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_score" numeric(8, 4),
	"ai_confidence" numeric(6, 4),
	"ai_rationale" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policy_score" numeric(8, 4),
	"status" text DEFAULT 'proposed' NOT NULL,
	"worker_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"service" text NOT NULL,
	"stage" text NOT NULL,
	"asset_id" uuid,
	"timeframe" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"artifact_id" uuid,
	"error" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_profile_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"timeframes" text[] DEFAULT '{1h,1d}'::text[] NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"max_allocation_pct" numeric(6, 2),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT 'AI Trading' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"budget_usd" numeric(24, 8) DEFAULT '10000' NOT NULL,
	"cash_usd" numeric(24, 8) DEFAULT '10000' NOT NULL,
	"reserved_usd" numeric(24, 8) DEFAULT '0' NOT NULL,
	"max_workers" integer DEFAULT 10 NOT NULL,
	"max_worker_allocation_pct" integer DEFAULT 25 NOT NULL,
	"max_token_exposure_pct" integer DEFAULT 20 NOT NULL,
	"max_invested_pct" integer DEFAULT 80 NOT NULL,
	"risk_per_trade_pct" numeric(6, 2) DEFAULT '1' NOT NULL,
	"daily_loss_limit_pct" numeric(6, 2) DEFAULT '3' NOT NULL,
	"max_drawdown_pct" numeric(6, 2) DEFAULT '10' NOT NULL,
	"max_ai_spend_usd" numeric(18, 2) DEFAULT '5' NOT NULL,
	"max_backtests_per_day" integer DEFAULT 200 NOT NULL,
	"worker_max_tokens" integer DEFAULT 5 NOT NULL,
	"auto_approve_worker_create" boolean DEFAULT true NOT NULL,
	"auto_approve_params" boolean DEFAULT true NOT NULL,
	"auto_approve_budget" boolean DEFAULT true NOT NULL,
	"auto_approve_pause_close" boolean DEFAULT true NOT NULL,
	"auto_approve_reoptimize" boolean DEFAULT true NOT NULL,
	"model_settings" jsonb DEFAULT '{"model":"deepseek-flash","temperature":0.2,"maxTokens":2000,"timeoutSeconds":60}'::jsonb NOT NULL,
	"schedule" jsonb DEFAULT '{"weeklyReview":true,"weeklyDay":0,"weeklyHour":3,"events":true}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"type" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_service_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"service" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"concurrency" integer DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"run_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"purpose" text DEFAULT 'analysis' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_candles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"timeframe" text NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"open" numeric(36, 18) NOT NULL,
	"high" numeric(36, 18) NOT NULL,
	"low" numeric(36, 18) NOT NULL,
	"close" numeric(36, 18) NOT NULL,
	"volume_usd" numeric(30, 8),
	"source" text NOT NULL,
	"quality" text DEFAULT 'ok' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trading_bots" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_bots" ADD COLUMN "ai_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "trading_bots" ADD COLUMN "ai_candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "trading_bots" ADD COLUMN "evaluation_timeframe" text;--> statement-breakpoint
ALTER TABLE "trading_bots" ADD COLUMN "allocation_usd" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "trading_bots" ADD COLUMN "isolated_budget" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_bots" ADD COLUMN "strategy_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_approvals" ADD CONSTRAINT "ai_approvals_profile_id_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_profile_id_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_candidates" ADD CONSTRAINT "ai_candidates_profile_id_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_candidates" ADD CONSTRAINT "ai_candidates_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_profile_id_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_run_id_ai_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_pipeline_runs" ADD CONSTRAINT "ai_pipeline_runs_profile_id_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_profile_tokens" ADD CONSTRAINT "ai_profile_tokens_profile_id_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_profile_tokens" ADD CONSTRAINT "ai_profile_tokens_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_profiles" ADD CONSTRAINT "ai_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_profile_id_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_service_configs" ADD CONSTRAINT "ai_service_configs_profile_id_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_profile_id_ai_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_candles" ADD CONSTRAINT "market_candles_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_approvals_profile_status_idx" ON "ai_approvals" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "ai_artifacts_run_type_idx" ON "ai_artifacts" USING btree ("run_id","type");--> statement-breakpoint
CREATE INDEX "ai_artifacts_hash_idx" ON "ai_artifacts" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "ai_candidates_profile_status_idx" ON "ai_candidates" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "ai_candidates_asset_timeframe_idx" ON "ai_candidates" USING btree ("asset_id","timeframe");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_idempotency_key_unique" ON "ai_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_jobs_queue_idx" ON "ai_jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "ai_jobs_run_idx" ON "ai_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_profile_status_idx" ON "ai_jobs" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "ai_pipeline_runs_profile_created_idx" ON "ai_pipeline_runs" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_profile_tokens_profile_asset_unique" ON "ai_profile_tokens" USING btree ("profile_id","asset_id");--> statement-breakpoint
CREATE INDEX "ai_profile_tokens_profile_idx" ON "ai_profile_tokens" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_profiles_user_name_unique" ON "ai_profiles" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "ai_profiles_user_idx" ON "ai_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_reports_profile_created_idx" ON "ai_reports" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_service_configs_profile_service_unique" ON "ai_service_configs" USING btree ("profile_id","service");--> statement-breakpoint
CREATE INDEX "ai_usage_profile_created_idx" ON "ai_usage" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_candles_asset_timeframe_open_unique" ON "market_candles" USING btree ("asset_id","timeframe","open_time");--> statement-breakpoint
CREATE INDEX "market_candles_asset_timeframe_open_idx" ON "market_candles" USING btree ("asset_id","timeframe","open_time");--> statement-breakpoint
ALTER TABLE "trading_bots" ADD CONSTRAINT "trading_bots_ai_profile_id_ai_profiles_id_fk" FOREIGN KEY ("ai_profile_id") REFERENCES "public"."ai_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trading_bots_ai_profile_idx" ON "trading_bots" USING btree ("ai_profile_id");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON ai_profiles, ai_profile_tokens, ai_service_configs, ai_pipeline_runs, ai_jobs, ai_artifacts, ai_candidates, ai_approvals, ai_reports, ai_usage, market_candles TO nexter_app;
    REVOKE DELETE ON ai_profiles, ai_profile_tokens, ai_service_configs, ai_pipeline_runs, ai_jobs, ai_artifacts, ai_candidates, ai_approvals, ai_reports, ai_usage, market_candles FROM nexter_app;
  END IF;
END $$;
