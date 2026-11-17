ALTER TABLE "tasks" ADD COLUMN "due_has_time" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "tasks"
SET "due_has_time" = true
WHERE "due_at" IS NOT NULL
  AND ("due_at" AT TIME ZONE 'Europe/Minsk')::time <> '12:00';
