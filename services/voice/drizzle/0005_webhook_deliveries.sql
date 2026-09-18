CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event" text,
	"conversation_id" text,
	"body_enc" text NOT NULL,
	"verdict" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_received_idx" ON "webhook_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_conversation_idx" ON "webhook_deliveries" USING btree ("conversation_id");