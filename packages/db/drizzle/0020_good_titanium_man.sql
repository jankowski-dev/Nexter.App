ALTER TABLE "watchlist" ADD COLUMN "twitter_url" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "investors" text[] DEFAULT '{}'::text[] NOT NULL;