CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"currency" text DEFAULT 'BYN' NOT NULL,
	"opening_balance" numeric(20, 2) DEFAULT '0' NOT NULL,
	"opening_date" date NOT NULL,
	"fx_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"credit_limit" numeric(20, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"color" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"source_id" text,
	"data" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'notion' NOT NULL,
	"source_hash" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "finance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"amount" numeric(20, 2) NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"base_amount" numeric(20, 2) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"import_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"from_amount" numeric(20, 2) NOT NULL,
	"to_amount" numeric(20, 2) NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"fx_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"from_base_amount" numeric(20, 2) NOT NULL,
	"to_base_amount" numeric(20, 2) NOT NULL,
	"description" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"import_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_import_rows" ADD CONSTRAINT "finance_import_rows_import_id_finance_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."finance_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_import_rows" ADD CONSTRAINT "finance_import_rows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_imports" ADD CONSTRAINT "finance_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_import_id_finance_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."finance_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_from_account_id_finance_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_to_account_id_finance_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transfers" ADD CONSTRAINT "finance_transfers_import_id_finance_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."finance_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_accounts_user_name_unique" ON "finance_accounts" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "finance_accounts_user_sort_idx" ON "finance_accounts" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE INDEX "finance_accounts_user_archived_idx" ON "finance_accounts" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_categories_user_kind_name_unique" ON "finance_categories" USING btree ("user_id","kind","name");--> statement-breakpoint
CREATE INDEX "finance_categories_user_kind_sort_idx" ON "finance_categories" USING btree ("user_id","kind","sort_order");--> statement-breakpoint
CREATE INDEX "finance_import_rows_import_status_idx" ON "finance_import_rows" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "finance_import_rows_user_idx" ON "finance_import_rows" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_imports_user_source_hash_unique" ON "finance_imports" USING btree ("user_id","source","source_hash");--> statement-breakpoint
CREATE INDEX "finance_imports_user_created_idx" ON "finance_imports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_transactions_user_source_unique" ON "finance_transactions" USING btree ("user_id","source_id") WHERE "finance_transactions"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "finance_transactions_user_date_idx" ON "finance_transactions" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "finance_transactions_user_account_idx" ON "finance_transactions" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "finance_transactions_user_category_idx" ON "finance_transactions" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_transfers_user_source_unique" ON "finance_transfers" USING btree ("user_id","source_id") WHERE "finance_transfers"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "finance_transfers_user_date_idx" ON "finance_transfers" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "finance_transfers_user_from_idx" ON "finance_transfers" USING btree ("user_id","from_account_id");--> statement-breakpoint
CREATE INDEX "finance_transfers_user_to_idx" ON "finance_transfers" USING btree ("user_id","to_account_id");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      finance_accounts,
      finance_categories,
      finance_transactions,
      finance_transfers,
      finance_imports,
      finance_import_rows
    TO nexter_app;
  END IF;
END $$;
