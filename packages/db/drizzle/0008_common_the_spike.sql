CREATE TABLE "watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"thesis" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trade_groups" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_user_asset_unique" ON "watchlist" USING btree ("user_id","asset_id");--> statement-breakpoint
CREATE INDEX "watchlist_user_priority_idx" ON "watchlist" USING btree ("user_id","priority");--> statement-breakpoint
CREATE INDEX "watchlist_user_archived_idx" ON "watchlist" USING btree ("user_id","archived_at");