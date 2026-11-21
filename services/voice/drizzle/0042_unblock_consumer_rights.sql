ALTER TABLE "unblock_enrollments" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "early_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "contract_subscription_id" text;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "contract_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "contract_email_enc" text;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "contract_document_enc" text;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "contract_notice_id" text;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "information_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "unblock_enrollments" ADD COLUMN "withdraw_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "unblock_refund_requests" (
 "id" text PRIMARY KEY,
 "enrollment_id" text REFERENCES "unblock_enrollments"("id") ON DELETE SET NULL,
 "reason" text NOT NULL CHECK ("reason" IN ('withdrawal','service_failure','billing_error')),
 "requested_at" timestamp with time zone NOT NULL,
 "repay_by" timestamp with time zone NOT NULL,
 "guaranteed" boolean NOT NULL DEFAULT false,
 "status" text NOT NULL DEFAULT 'requested' CHECK ("status" IN ('requested','refunded','resolved_no_payment','reviewed')),
 "checkout_reference" text,"provider" text,"subscription_id" text,"invoice_id" text,"product_id" text,
 "amount_minor" integer CHECK ("amount_minor" IS NULL OR "amount_minor">=0),"currency" text,
 "cancel_confirmed_at" timestamp with time zone,"next_attempt_at" timestamp with time zone NOT NULL,
 "refund_id" text UNIQUE,"resolved_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX "unblock_refunds_enrollment_reason_idx" ON "unblock_refund_requests"("enrollment_id","reason") WHERE "status"='requested';--> statement-breakpoint
CREATE INDEX "unblock_refunds_pending_idx" ON "unblock_refund_requests"("repay_by") WHERE "status"='requested';
