ALTER TABLE "callers" ADD COLUMN "nudges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "next_nudge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "nudge_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "signups" ADD COLUMN "voice" text;--> statement-breakpoint
ALTER TABLE "signups" ADD COLUMN "nudges" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "callers_nudge_due" ON "callers" USING btree ("next_nudge_at") WHERE "callers"."nudges_enabled" = true;