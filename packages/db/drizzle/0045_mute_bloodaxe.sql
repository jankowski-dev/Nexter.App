CREATE TABLE "market_history" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_history_fetched_idx" ON "market_history" USING btree ("fetched_at");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON market_history TO nexter_app;
    REVOKE DELETE ON market_history FROM nexter_app;
  END IF;
END $$;
