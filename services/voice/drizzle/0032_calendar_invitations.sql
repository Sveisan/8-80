CREATE TABLE "calendar_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"source_key" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"recipient_enc" text,
	"sequence" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "calendar_invites_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "calendar_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signups" ADD COLUMN "calendar_invites" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_invitations_caller" ON "calendar_invitations" USING btree ("phone_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_invitations_active_source" ON "calendar_invitations" USING btree ("phone_hash","source_key") WHERE "calendar_invitations"."state" = 'active';