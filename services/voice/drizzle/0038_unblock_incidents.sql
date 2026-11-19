CREATE TABLE "unblock_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text,
	"alert_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"ack_due_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"failure" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "unblock_incidents_attempt_id_unique" UNIQUE("attempt_id")
);
--> statement-breakpoint
ALTER TABLE "unblock_incidents" ADD CONSTRAINT "unblock_incidents_attempt_id_call_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "call_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unblock_incidents" ADD CONSTRAINT "unblock_incidents_alert_id_message_outbox_id_fk" FOREIGN KEY ("alert_id") REFERENCES "message_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unblock_incidents_open_idx" ON "unblock_incidents" USING btree ("ack_due_at") WHERE "unblock_incidents"."resolved_at" is null;
