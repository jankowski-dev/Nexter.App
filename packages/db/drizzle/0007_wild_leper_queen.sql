CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"data" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transaction_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'notion' NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"source_hash" text NOT NULL,
	"file_name" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "data_quality" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prices" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "data_quality" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_source_unique" ON "import_rows" USING btree ("import_id","entity_type","source_id");--> statement-breakpoint
CREATE INDEX "import_rows_import_idx" ON "import_rows" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "imports_user_idx" ON "imports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_user_source_hash_unique" ON "imports" USING btree ("user_id","source","source_hash");--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prices_import_idx" ON "prices" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "transactions_import_idx" ON "transactions" USING btree ("import_id");