CREATE TABLE "message_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"result" text
);
--> statement-breakpoint
CREATE TABLE "message_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"phone_hash" text NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"reference" text,
	"recipient_enc" text,
	"payload_enc" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	CONSTRAINT "message_outbox_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "sms_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "message_attempts_message_idx" ON "message_attempts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_outbox_due_idx" ON "message_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "message_outbox_caller_idx" ON "message_outbox" USING btree ("phone_hash","created_at");