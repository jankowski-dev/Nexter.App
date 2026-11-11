ALTER TABLE "market_quotes" ADD COLUMN "change_7d_pct" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "market_quotes" ADD COLUMN "change_30d_pct" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "market_quotes" ADD COLUMN "change_1y_pct" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "market_quotes" ADD COLUMN "market_cap_usd" numeric(24, 2);