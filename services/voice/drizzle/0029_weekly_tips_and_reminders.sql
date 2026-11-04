CREATE TABLE "weekly_reminder_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"attempt_id" text NOT NULL,
	"revision" integer NOT NULL,
	"body_enc" text NOT NULL,
	"replaces_pending" boolean NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_reminders" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"body_enc" text,
	"due_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"state" text NOT NULL,
	"attempt_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_tip_assignments" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"experiment" text NOT NULL,
	"arm" text NOT NULL,
	"randomized" boolean NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"sample_rank" integer NOT NULL,
	"opted_out_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weekly_tip_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_tip_experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"winner" text,
	"results" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_tip_offers" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"tip_id" text NOT NULL,
	"topic" text NOT NULL,
	"wording_enc" text NOT NULL,
	"offered_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone,
	"exposed_at" timestamp with time zone,
	"response" text
);
--> statement-breakpoint
CREATE TABLE "weekly_tool_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"attempt_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"response_enc" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "tips_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "tip_progress" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "weekly_reminder_drafts_expiry" ON "weekly_reminder_drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "weekly_reminder_drafts_caller" ON "weekly_reminder_drafts" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "weekly_reminders_due" ON "weekly_reminders" USING btree ("due_at") WHERE "weekly_reminders"."state" = 'scheduled';--> statement-breakpoint
CREATE INDEX "weekly_tip_assignments_cohort" ON "weekly_tip_assignments" USING btree ("experiment","randomized","arm","assigned_at");--> statement-breakpoint
CREATE INDEX "weekly_tip_offers_caller" ON "weekly_tip_offers" USING btree ("phone_hash","offered_at");--> statement-breakpoint
CREATE INDEX "weekly_tool_requests_expiry" ON "weekly_tool_requests" USING btree ("at");--> statement-breakpoint
CREATE INDEX "weekly_tool_requests_caller" ON "weekly_tool_requests" USING btree ("phone_hash");