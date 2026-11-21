CREATE TABLE "weekly_invite_redemptions" (
	"invitation" text PRIMARY KEY NOT NULL,
	"used" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "weekly_offer" text;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "weekly_free_calls_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "weekly_pilot_checkout" text;--> statement-breakpoint
ALTER TABLE "signups" ADD COLUMN "weekly_invite_enc" text;