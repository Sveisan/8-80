CREATE TABLE "journey_counts" (
	"day" text NOT NULL,
	"event" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_events" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"event" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "journey_counts_day_event_idx" ON "journey_counts" USING btree ("day","event");--> statement-breakpoint
CREATE INDEX "journey_events_phone_at_idx" ON "journey_events" USING btree ("phone_hash","at");--> statement-breakpoint
CREATE INDEX "journey_events_at_idx" ON "journey_events" USING btree ("at");