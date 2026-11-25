CREATE TABLE "sandbox_replays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"token_keys" jsonb NOT NULL,
	"period_days" integer NOT NULL,
	"from_time" timestamp with time zone NOT NULL,
	"to_time" timestamp with time zone NOT NULL,
	"initial_capital_usd" numeric(18, 2) NOT NULL,
	"seed" integer DEFAULT 7 NOT NULL,
	"settings" jsonb NOT NULL,
	"paper" jsonb NOT NULL,
	"report" jsonb,
	"report_hash" text,
	"event_count" integer,
	"event_hash" text,
	"data_snapshot_id" text,
	"candle_snapshot" bytea,
	"candle_snapshot_hash" text,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_replays_status_check" CHECK ("sandbox_replays"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "sandbox_replays_period_days_check" CHECK ("sandbox_replays"."period_days" in (30, 90, 180)),
	CONSTRAINT "sandbox_replays_capital_positive" CHECK ("sandbox_replays"."initial_capital_usd" > 0),
	CONSTRAINT "sandbox_replays_name_length" CHECK (char_length("sandbox_replays"."name") between 1 and 80),
	CONSTRAINT "sandbox_replays_token_keys_count" CHECK (jsonb_typeof("sandbox_replays"."token_keys") = 'array' and jsonb_array_length("sandbox_replays"."token_keys") between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "sandbox_replays" ADD CONSTRAINT "sandbox_replays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_replays_user_created_idx" ON "sandbox_replays" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sandbox_replays_status_queued_idx" ON "sandbox_replays" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "sandbox_replays_user_archived_idx" ON "sandbox_replays" USING btree ("user_id","archived_at");
--> statement-breakpoint
-- Sandbox historical replay grants. Replays are mutable while queued/running
-- (status, report, snapshot and error are updated), so UPDATE stays granted;
-- DELETE is revoked. No sequences are used (uuid key). Provisioning repeats the
-- same revoke because the role may not exist when this migration runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON sandbox_replays TO nexter_app;
    REVOKE DELETE ON sandbox_replays FROM nexter_app;
  END IF;
END $$;