CREATE TABLE "finance_fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" text DEFAULT 'nbrb' NOT NULL,
	"rate_date" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_fx_rates_currency_check" CHECK ("finance_fx_rates"."currency" in ('USD', 'EUR', 'CNY')),
	CONSTRAINT "finance_fx_rates_rate_positive" CHECK ("finance_fx_rates"."rate" > 0),
	CONSTRAINT "finance_fx_rates_source_check" CHECK ("finance_fx_rates"."source" in ('nbrb', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "finance_fx_rates" ADD CONSTRAINT "finance_fx_rates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_fx_rates_user_currency_unique" ON "finance_fx_rates" USING btree ("user_id","currency");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finance_fx_rates TO nexter_app;
    REVOKE DELETE ON finance_fx_rates FROM nexter_app;
  END IF;
END $$;
