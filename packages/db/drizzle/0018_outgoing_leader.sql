CREATE TABLE "watchlist_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "watchlist_groups" ADD CONSTRAINT "watchlist_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_groups_user_name_unique" ON "watchlist_groups" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "watchlist_groups_user_sort_idx" ON "watchlist_groups" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_groups_user_default_unique" ON "watchlist_groups" USING btree ("user_id") WHERE "watchlist_groups"."is_default" = true;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_group_id_watchlist_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."watchlist_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watchlist_user_group_idx" ON "watchlist" USING btree ("user_id","group_id");--> statement-breakpoint
INSERT INTO "watchlist_groups" ("user_id", "name", "is_default", "sort_order")
SELECT "id", 'Основная', true, 0 FROM "users"
ON CONFLICT ("user_id", "name") DO NOTHING;--> statement-breakpoint
UPDATE "watchlist"
SET "group_id" = (
  SELECT "id" FROM "watchlist_groups"
  WHERE "watchlist_groups"."user_id" = "watchlist"."user_id" AND "watchlist_groups"."is_default" = true
  LIMIT 1
)
WHERE "group_id" IS NULL;