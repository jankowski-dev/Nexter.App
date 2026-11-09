ALTER TABLE "tasks" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "occurrence_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_user_series_idx" ON "tasks" USING btree ("user_id","series_id");