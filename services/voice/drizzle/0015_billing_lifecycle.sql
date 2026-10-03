ALTER TABLE "callers" ADD COLUMN "billing_provider" text;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "paid_until" timestamp with time zone;
--> statement-breakpoint
-- Classify existing vendor identifiers without changing entitlement or inventing renewal dates.
UPDATE callers SET billing_provider = CASE
  WHEN ls_subscription_id ~ '^sub_' THEN 'stripe'
  WHEN ls_subscription_id ~ '^[0-9]+$' THEN 'lemonsqueezy'
  ELSE NULL END WHERE ls_subscription_id IS NOT NULL;
