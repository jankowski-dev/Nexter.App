ALTER TABLE "ai_approvals" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_rule_state" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_rules" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ai_approvals" CASCADE;--> statement-breakpoint
DROP TABLE "automation_rule_state" CASCADE;--> statement-breakpoint
DROP TABLE "automation_rules" CASCADE;--> statement-breakpoint
DROP TABLE "automation_runs" CASCADE;--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_automation_mode";--> statement-breakpoint
ALTER TABLE "ai_profiles" DROP COLUMN "auto_approve_worker_create";--> statement-breakpoint
ALTER TABLE "ai_profiles" DROP COLUMN "auto_approve_params";--> statement-breakpoint
ALTER TABLE "ai_profiles" DROP COLUMN "auto_approve_budget";--> statement-breakpoint
ALTER TABLE "ai_profiles" DROP COLUMN "auto_approve_pause_close";--> statement-breakpoint
ALTER TABLE "ai_profiles" DROP COLUMN "auto_approve_reoptimize";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "automation_enabled";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "automation_mode";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "automation_max_order_usd";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "automation_max_daily_usd";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "automation_max_actions_per_day";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "automation_cooldown_minutes";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "automation_default_trailing_pct";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "automation_default_buy_drop_pct";