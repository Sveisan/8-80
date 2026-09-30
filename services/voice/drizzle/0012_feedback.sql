CREATE TABLE "feedback" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"attempt_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"pickup_enc" text,
	"nearly_enc" text,
	"else_enc" text
);
--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "safety_tier" integer;