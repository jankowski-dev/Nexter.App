CREATE TABLE "ai_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'deepseek' NOT NULL,
	"model" text DEFAULT 'deepseek-flash' NOT NULL,
	"reasoning" text DEFAULT 'fast' NOT NULL,
	"temperature" numeric(3, 2) DEFAULT '0.30' NOT NULL,
	"max_tokens" integer DEFAULT 2000 NOT NULL,
	"fallback_to_raw" boolean DEFAULT true NOT NULL,
	"api_key_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audio_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"viber_message_id" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"audio_mime" text NOT NULL,
	"audio_name" text DEFAULT '' NOT NULL,
	"audio_size" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"title" text,
	"transcript" text,
	"summary" text,
	"note_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_audio" (
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
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_notes" ADD CONSTRAINT "audio_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_notes" ADD CONSTRAINT "audio_notes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_audio" ADD CONSTRAINT "note_audio_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_audio" ADD CONSTRAINT "note_audio_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audio_notes_viber_message_unique" ON "audio_notes" USING btree ("viber_message_id");--> statement-breakpoint
CREATE INDEX "audio_notes_user_time_idx" ON "audio_notes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audio_notes_status_time_idx" ON "audio_notes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "note_audio_user_note_idx" ON "note_audio" USING btree ("user_id","note_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_temperature_range" CHECK ("temperature" >= 0 AND "temperature" <= 2);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_max_tokens_range" CHECK ("max_tokens" >= 256 AND "max_tokens" <= 8192);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON ai_settings TO nexter_app;
    GRANT SELECT, INSERT, UPDATE ON audio_notes TO nexter_app;
    GRANT SELECT, INSERT, UPDATE ON note_audio TO nexter_app;
    REVOKE DELETE ON ai_settings, audio_notes, note_audio FROM nexter_app;
  END IF;
END $$;
