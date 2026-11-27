ALTER TABLE "profile" ADD COLUMN "trial_words_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_day" ADD COLUMN "words" integer DEFAULT 0 NOT NULL;