DO $$
DECLARE owner_count integer;
BEGIN
  SELECT count(*) INTO owner_count FROM "users";
  IF owner_count > 1 THEN
    RAISE EXCEPTION 'users_singleton_unique preflight failed: % owners exist. Resolve duplicate owners before applying migration 0003 (see docs/runbooks/railway.md).', owner_count;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "users_singleton_unique" ON "users" USING btree ((true));