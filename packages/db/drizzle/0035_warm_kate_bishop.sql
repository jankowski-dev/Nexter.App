ALTER TABLE "trading_bots" DROP CONSTRAINT IF EXISTS "trading_bots_strategy_id_bot_strategies_id_fk";--> statement-breakpoint
ALTER TABLE "trading_bots" DROP COLUMN IF EXISTS "strategy_id";--> statement-breakpoint
DROP TABLE IF EXISTS "bot_strategies";
