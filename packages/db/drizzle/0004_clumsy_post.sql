UPDATE "sessions" SET "revoked_at" = now() WHERE "csrf_token_hash" = '' AND "revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "csrf_token_hash" DROP DEFAULT;