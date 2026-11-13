CREATE TABLE "bot_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"price_usd" numeric(36, 18),
	"change_24h_pct" numeric(12, 4),
	"action" text DEFAULT 'hold' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"has_position" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trading_bots" ADD COLUMN "strategy_key" text;--> statement-breakpoint
ALTER TABLE "trading_bots" ADD COLUMN "strategy_params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "trading_bots" AS "b"
SET "strategy_key" = "s"."key",
    "strategy_params" = COALESCE("s"."params", '{}'::jsonb)
FROM "bot_strategies" AS "s"
WHERE "s"."id" = "b"."strategy_id";--> statement-breakpoint
UPDATE "trading_bots"
SET "strategy_key" = 'momentum_breakout'
WHERE "strategy_key" IS NULL;--> statement-breakpoint
ALTER TABLE "trading_bots" ALTER COLUMN "strategy_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_signals" ADD CONSTRAINT "bot_signals_bot_id_trading_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."trading_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_signals" ADD CONSTRAINT "bot_signals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_signals_bot_asset_unique" ON "bot_signals" USING btree ("bot_id","asset_id");--> statement-breakpoint
CREATE INDEX "bot_signals_bot_idx" ON "bot_signals" USING btree ("bot_id");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON bot_signals TO nexter_app;
    GRANT UPDATE ON trading_bots TO nexter_app;
  END IF;
END $$;
