CREATE TABLE "note_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"data_url" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_images" ADD CONSTRAINT "note_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_images" ADD CONSTRAINT "note_images_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_images_user_note_idx" ON "note_images" USING btree ("user_id","note_id","created_at");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON note_images TO nexter_app;
  END IF;
END $$;
