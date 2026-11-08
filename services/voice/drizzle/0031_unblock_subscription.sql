ALTER TABLE "unblock_enrollments" ADD COLUMN "subscription_id" text;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "calls_per_month" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "pending_calls_per_month" integer;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "chapter" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "year" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "chapter_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "anchor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD CONSTRAINT "unblock_enrollments_subscription_id_unique" UNIQUE("subscription_id");