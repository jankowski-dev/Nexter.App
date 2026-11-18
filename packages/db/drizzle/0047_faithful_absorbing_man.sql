CREATE TABLE "automation_rule_state" (
	"rule_id" uuid PRIMARY KEY NOT NULL,
	"high_water_usd" numeric(36, 18),
	"last_action_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"trade_group_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"execution_mode" text DEFAULT 'dry_run' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_order_usd" numeric(24, 2),
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"trigger_key" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"trigger_price_usd" numeric(36, 18),
	"amount" numeric(36, 18),
	"usd_value" numeric(24, 2),
	"trade_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "swap_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_rule_state" ADD CONSTRAINT "automation_rule_state_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_trade_group_id_trade_groups_id_fk" FOREIGN KEY ("trade_group_id") REFERENCES "public"."trade_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_trade_group_id_trade_groups_id_fk" FOREIGN KEY ("trade_group_id") REFERENCES "public"."trade_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rules_user_status_idx" ON "automation_rules" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "automation_rules_asset_idx" ON "automation_rules" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "automation_rules_group_idx" ON "automation_rules" USING btree ("trade_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_rule_trigger_unique" ON "automation_runs" USING btree ("rule_id","trigger_key");--> statement-breakpoint
CREATE INDEX "automation_runs_user_time_idx" ON "automation_runs" USING btree ("user_id","created_at");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON automation_rules, automation_rule_state, automation_runs TO nexter_app;
    REVOKE DELETE ON automation_rules, automation_rule_state, automation_runs FROM nexter_app;
  END IF;
END $$;
