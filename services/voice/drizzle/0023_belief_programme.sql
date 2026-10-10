CREATE TABLE "belief_enrollments" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"practice_enc" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"consent_version" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Europe/Oslo' NOT NULL,
	"daily_minute" integer,
	"weekly_weekday" integer,
	"weekly_minute" integer,
	"onboarding_at" timestamp with time zone,
	"next_daily_at" timestamp with time zone,
	"next_weekly_at" timestamp with time zone,
	"review_origin" timestamp with time zone,
	"standing" text DEFAULT 'awaiting_payment' NOT NULL,
	"provider" text,
	"purchase_id" text,
	"payment_id" text,
	"customer_id" text,
	"paid_at" timestamp with time zone,
	"amount_minor" integer,
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "belief_enrollments_purchase_id_unique" UNIQUE("purchase_id"),
	CONSTRAINT "belief_enrollments_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "belief_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"kind" text NOT NULL,
	"week" integer,
	"snapshot_enc" text NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"coverage_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "all_calls_stopped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signups" ADD COLUMN "product" text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD CONSTRAINT "belief_enrollments_phone_hash_callers_phone_hash_fk" FOREIGN KEY ("phone_hash") REFERENCES "callers"("phone_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "belief_sessions" ADD CONSTRAINT "belief_sessions_id_call_attempts_id_fk" FOREIGN KEY ("id") REFERENCES "call_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "belief_sessions" ADD CONSTRAINT "belief_sessions_phone_hash_belief_enrollments_phone_hash_fk" FOREIGN KEY ("phone_hash") REFERENCES "belief_enrollments"("phone_hash") ON DELETE cascade ON UPDATE no action;