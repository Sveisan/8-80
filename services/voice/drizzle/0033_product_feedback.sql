CREATE TABLE "product_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"session_hash" text NOT NULL,
	"client_bucket" text NOT NULL,
	"request_id" text NOT NULL,
	"phone_hash" text,
	"payload_enc" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"issue_number" integer,
	"issue_attempted_at" timestamp with time zone,
	"issue_sending" boolean DEFAULT false NOT NULL,
	"pr_number" integer,
	"improved" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_phone_hash_callers_phone_hash_fk" FOREIGN KEY ("phone_hash") REFERENCES "callers"("phone_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_feedback_request_idx" ON "product_feedback" USING btree ("session_hash","request_id");--> statement-breakpoint
CREATE INDEX "product_feedback_expiry_idx" ON "product_feedback" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "product_feedback_owner_idx" ON "product_feedback" USING btree ("phone_hash");