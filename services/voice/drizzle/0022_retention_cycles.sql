CREATE TABLE "journey_tracking" (
	"event" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "cycle_key" text;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "next_call_cycle" text;--> statement-breakpoint
ALTER TABLE "journey_events" ADD COLUMN "cycle_key" text;
--> statement-breakpoint
INSERT INTO journey_tracking (event) VALUES ('conversation_completed') ON CONFLICT DO NOTHING;
