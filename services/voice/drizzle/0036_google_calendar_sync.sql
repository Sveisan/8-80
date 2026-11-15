CREATE TABLE "google_calendar_deletes" (
	"event_id" text PRIMARY KEY NOT NULL,
	"calendar_id" text NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_calendar_sync" (
	"calendar_id" text PRIMARY KEY NOT NULL,
	"sync_token_enc" text,
	"lease_id" text,
	"lease_until" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"failed" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_invitations" ADD COLUMN "provider" text DEFAULT 'ics' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_invitations" ADD COLUMN "google_calendar_id" text;--> statement-breakpoint
ALTER TABLE "calendar_invitations" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "calendar_invitations" ADD COLUMN "google_etag" text;--> statement-breakpoint
ALTER TABLE "calendar_invitations" ADD COLUMN "google_valid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_invitations_google_event" ON "calendar_invitations" USING btree ("google_calendar_id","google_event_id");