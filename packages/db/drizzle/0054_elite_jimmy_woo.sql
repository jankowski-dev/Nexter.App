CREATE TABLE "portfolio_equity_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bucket_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cash_usd" numeric(24, 8) NOT NULL,
	"positions_value_usd" numeric(24, 8) NOT NULL,
	"equity_usd" numeric(24, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viber_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viber_notifications_status_check" CHECK ("viber_notifications"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "viber_notifications_attempts_check" CHECK ("viber_notifications"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "notify_trades_closed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "viber_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "viber_trade_closed_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "viber_bot_stopped_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "viber_frequency" text DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "viber_digest_time" text DEFAULT '20:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_equity_points" ADD CONSTRAINT "portfolio_equity_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viber_notifications" ADD CONSTRAINT "viber_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_equity_points_user_bucket_unique" ON "portfolio_equity_points" USING btree ("user_id","bucket_at");--> statement-breakpoint
CREATE INDEX "portfolio_equity_points_user_bucket_idx" ON "portfolio_equity_points" USING btree ("user_id","bucket_at");--> statement-breakpoint
CREATE INDEX "viber_notifications_user_status_idx" ON "viber_notifications" USING btree ("user_id","status","created_at");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_viber_frequency" CHECK ("settings"."viber_frequency" in ('instant', 'hourly', 'daily'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_viber_digest_time" CHECK ("settings"."viber_digest_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON viber_notifications TO nexter_app;
    REVOKE DELETE ON viber_notifications FROM nexter_app;
    GRANT SELECT, INSERT, UPDATE ON portfolio_equity_points TO nexter_app;
    REVOKE DELETE ON portfolio_equity_points FROM nexter_app;
  END IF;
END $$;
