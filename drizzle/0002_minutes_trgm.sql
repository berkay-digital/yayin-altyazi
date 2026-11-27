CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "usage_day" ADD COLUMN "active_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "translation_key_trgm" ON "translation" USING gin ("key" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "profile" DROP COLUMN "byok_key_enc";--> statement-breakpoint
UPDATE "profile" SET "trial_minutes_used" = 0;--> statement-breakpoint
DELETE FROM "translation" WHERE "source" = 'byok';
