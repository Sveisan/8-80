CREATE TABLE "weekly_pilot_followups" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"consent_version" text NOT NULL,
	"email_enc" text,
	"next_slot_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"feedback" text,
	CONSTRAINT "weekly_pilot_followups_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "signups" ADD COLUMN "weekly_pilot_followup" boolean DEFAULT false NOT NULL;
