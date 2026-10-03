ALTER TABLE "callers" ADD COLUMN "onboarding" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "onboarding_completed_at" timestamp with time zone;
--> statement-breakpoint
-- Preserve established routing without retrospectively asserting activation.
UPDATE "callers" SET "onboarding" = 'legacy' WHERE "call_number" > 1;
