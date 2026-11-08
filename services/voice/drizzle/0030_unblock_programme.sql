CREATE TABLE "unblock_enrollments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"phone_hash" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"checkout_reference" text NOT NULL,
	"programme_enc" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"consent_version" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Europe/Oslo' NOT NULL,
	"weekly_weekday" integer,
	"weekly_minute" integer,
	"light_weekdays" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"light_minute" integer,
	"opening_at" timestamp with time zone,
	"next_weekly_at" timestamp with time zone,
	"next_light_at" timestamp with time zone,
	"standing" text DEFAULT 'awaiting_payment' NOT NULL,
	"provider" text,
	"purchase_id" text,
	"payment_id" text,
	"customer_id" text,
	"product_id" text,
	"paid_at" timestamp with time zone,
	"amount_minor" integer,
	"currency" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unblock_enrollments_checkout_reference_unique" UNIQUE("checkout_reference"),
	CONSTRAINT "unblock_enrollments_purchase_id_unique" UNIQUE("purchase_id"),
	CONSTRAINT "unblock_enrollments_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "unblock_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"programme_id" text NOT NULL,
	"kind" text NOT NULL,
	"week" integer,
	"snapshot_enc" text NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"coverage_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD CONSTRAINT "unblock_enrollments_phone_hash_callers_phone_hash_fk" FOREIGN KEY ("phone_hash") REFERENCES "callers"("phone_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unblock_sessions" ADD CONSTRAINT "unblock_sessions_id_call_attempts_id_fk" FOREIGN KEY ("id") REFERENCES "call_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unblock_sessions" ADD CONSTRAINT "unblock_sessions_phone_hash_callers_phone_hash_fk" FOREIGN KEY ("phone_hash") REFERENCES "callers"("phone_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unblock_sessions" ADD CONSTRAINT "unblock_sessions_programme_id_unblock_enrollments_id_fk" FOREIGN KEY ("programme_id") REFERENCES "unblock_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unblock_enrollments_current_idx" ON "unblock_enrollments" USING btree ("phone_hash") WHERE "unblock_enrollments"."is_current" = true;--> statement-breakpoint
CREATE INDEX "unblock_enrollments_owner_idx" ON "unblock_enrollments" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "unblock_sessions_programme_idx" ON "unblock_sessions" USING btree ("programme_id");