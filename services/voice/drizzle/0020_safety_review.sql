ALTER TABLE "call_attempts" ADD COLUMN "safety_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "held_for_review" boolean DEFAULT false NOT NULL;