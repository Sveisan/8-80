CREATE TABLE "links" (
	"code" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"purpose" text DEFAULT 'reschedule' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "links_expiry_idx" ON "links" USING btree ("expires_at");