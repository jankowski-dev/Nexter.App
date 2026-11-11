INSERT INTO "chains" ("code", "name") VALUES ('tron', 'TRON'), ('solana', 'Solana')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "assets" ("chain_id", "symbol", "name", "decimals", "coingecko_id", "is_verified")
SELECT id, 'TRX', 'TRON', 6, 'tron', true FROM "chains" WHERE "code" = 'tron'
ON CONFLICT ("chain_id", "symbol") DO NOTHING;--> statement-breakpoint
INSERT INTO "assets" ("chain_id", "symbol", "name", "decimals", "coingecko_id", "is_verified")
SELECT id, 'SOL', 'Solana', 9, 'solana', true FROM "chains" WHERE "code" = 'solana'
ON CONFLICT ("chain_id", "symbol") DO NOTHING;
