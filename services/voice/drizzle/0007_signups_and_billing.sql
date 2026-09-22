CREATE TABLE "signups" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"phone_enc" text NOT NULL,
	"email_enc" text,
	"name" text,
	"timezone" text NOT NULL,
	"slot_weekday" integer NOT NULL,
	"slot_minute" integer NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "billing_status" text DEFAULT 'comped' NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "ls_subscription_id" text;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "ls_customer_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "signups_phone_key" ON "signups" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "signups_expiry_idx" ON "signups" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "callers_ls_subscription_key" ON "callers" USING btree ("ls_subscription_id");--> statement-breakpoint
CREATE INDEX "callers_trial_idx" ON "callers" USING btree ("trial_ends_at");