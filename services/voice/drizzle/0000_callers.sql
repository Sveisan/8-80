CREATE TABLE "callers" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"phone_enc" text NOT NULL,
	"name" text,
	"language" text,
	"voice" text,
	"call_number" integer DEFAULT 1 NOT NULL,
	"last_commitment_enc" text,
	"last_commitment_day" text,
	"consecutive_undone" integer DEFAULT 0 NOT NULL,
	"patience_offset_ms" integer,
	"last_call_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "callers_phone_hash_key" ON "callers" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "callers_last_call_at_idx" ON "callers" USING btree ("last_call_at");