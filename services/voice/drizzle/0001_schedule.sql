CREATE TABLE "call_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"provider_call_id" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "slot_weekday" integer;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "slot_minute" integer;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "next_call_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "call_attempts_slot_key" ON "call_attempts" USING btree ("phone_hash","scheduled_for");--> statement-breakpoint
CREATE INDEX "call_attempts_status_idx" ON "call_attempts" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "callers_due_idx" ON "callers" USING btree ("next_call_at");