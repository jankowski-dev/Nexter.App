CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"started_on" date NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "habits_user_name_unique" ON "habits" USING btree ("user_id","name") WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "habits_user_archived_idx" ON "habits" USING btree ("user_id","archived_at");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON habits TO nexter_app;
  END IF;
END $$;
