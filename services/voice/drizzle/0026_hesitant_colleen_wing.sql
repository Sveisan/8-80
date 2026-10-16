CREATE TABLE "belief_refund_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"programme_id" text NOT NULL,
	"reason" text NOT NULL,
	"guaranteed" boolean NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "belief_sessions" DROP CONSTRAINT "belief_sessions_phone_hash_belief_enrollments_phone_hash_fk";
--> statement-breakpoint
ALTER TABLE "belief_enrollments" DROP CONSTRAINT "belief_enrollments_pkey";
--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "first_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "history_delete_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "history_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "retention_notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "checkin_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "checkin_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "checkin_attempt_id" text;--> statement-breakpoint
ALTER TABLE "belief_enrollments" ADD COLUMN "correction_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "belief_sessions" ADD COLUMN "programme_id" text;--> statement-breakpoint
UPDATE "belief_sessions" s SET "programme_id"=e."id" FROM "belief_enrollments" e WHERE e."phone_hash"=s."phone_hash";--> statement-breakpoint
ALTER TABLE "belief_sessions" ALTER COLUMN "programme_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "belief_refund_requests" ADD CONSTRAINT "belief_refund_requests_programme_id_belief_enrollments_id_fk" FOREIGN KEY ("programme_id") REFERENCES "belief_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "belief_refund_programme_idx" ON "belief_refund_requests" USING btree ("programme_id");--> statement-breakpoint
ALTER TABLE "belief_sessions" ADD CONSTRAINT "belief_sessions_phone_hash_callers_phone_hash_fk" FOREIGN KEY ("phone_hash") REFERENCES "callers"("phone_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "belief_sessions" ADD CONSTRAINT "belief_sessions_programme_id_belief_enrollments_id_fk" FOREIGN KEY ("programme_id") REFERENCES "belief_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "belief_enrollments_current_idx" ON "belief_enrollments" USING btree ("phone_hash") WHERE "belief_enrollments"."is_current" = true;--> statement-breakpoint
CREATE INDEX "belief_enrollments_owner_idx" ON "belief_enrollments" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "belief_enrollments_retention_idx" ON "belief_enrollments" USING btree ("history_delete_at");--> statement-breakpoint
CREATE INDEX "belief_sessions_programme_idx" ON "belief_sessions" USING btree ("programme_id");
--> statement-breakpoint
ALTER TABLE belief_enrollments ADD COLUMN checkout_reference text;
--> statement-breakpoint
UPDATE belief_enrollments SET checkout_reference='beliefs:' || phone_hash;
--> statement-breakpoint
ALTER TABLE belief_enrollments ALTER COLUMN checkout_reference SET NOT NULL;
--> statement-breakpoint
ALTER TABLE belief_enrollments ADD CONSTRAINT belief_enrollments_checkout_reference_unique UNIQUE(checkout_reference);

--> statement-breakpoint
ALTER TABLE belief_enrollments ADD COLUMN retention_delivered_at timestamptz;

--> statement-breakpoint
ALTER TABLE belief_enrollments ADD COLUMN policy_checked_at timestamptz;

--> statement-breakpoint
ALTER TABLE belief_enrollments ADD COLUMN product_id text;
