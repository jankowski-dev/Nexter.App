CREATE TABLE "market_quotes" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"price_usd" numeric(36, 18) NOT NULL,
	"change_24h_pct" numeric(12, 4),
	"source" text NOT NULL,
	"liquidity_usd" numeric(24, 2),
	"fetched_at" timestamp with time zone NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_quotes" ADD CONSTRAINT "market_quotes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_quotes_fetched_idx" ON "market_quotes" USING btree ("fetched_at");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON market_quotes TO nexter_app;
    REVOKE DELETE ON market_quotes FROM nexter_app;
  END IF;
END $$;
