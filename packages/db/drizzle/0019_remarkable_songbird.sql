CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"related_asset_id" uuid,
	"related_trade_group_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"related_asset_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"salt" text NOT NULL,
	"iterations" integer DEFAULT 600000 NOT NULL,
	"wrapped_key" text NOT NULL,
	"wrapped_key_iv" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_related_asset_id_assets_id_fk" FOREIGN KEY ("related_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_related_trade_group_id_trade_groups_id_fk" FOREIGN KEY ("related_trade_group_id") REFERENCES "public"."trade_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_related_asset_id_assets_id_fk" FOREIGN KEY ("related_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_configs" ADD CONSTRAINT "vault_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_user_updated_idx" ON "notes" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_user_archived_idx" ON "notes" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "notes_user_pinned_idx" ON "notes" USING btree ("user_id","pinned");--> statement-breakpoint
CREATE INDEX "tasks_user_status_idx" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_user_due_idx" ON "tasks" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "tasks_user_archived_idx" ON "tasks" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_configs_user_unique" ON "vault_configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vault_items_user_updated_idx" ON "vault_items" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "vault_items_user_archived_idx" ON "vault_items" USING btree ("user_id","archived_at");