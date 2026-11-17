ALTER TABLE "users" ADD COLUMN "last_totp_step" integer;--> statement-breakpoint
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_audit_log_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_log_no_mutation" ON "audit_log";--> statement-breakpoint
CREATE TRIGGER "audit_log_no_mutation"
BEFORE UPDATE OR DELETE ON "audit_log"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_log_mutation"();
