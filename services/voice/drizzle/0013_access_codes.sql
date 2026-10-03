CREATE TABLE "access_codes" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"window_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"sends" integer NOT NULL,
	CONSTRAINT "access_codes_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE INDEX "access_codes_sent_idx" ON "access_codes" USING btree ("sent_at");