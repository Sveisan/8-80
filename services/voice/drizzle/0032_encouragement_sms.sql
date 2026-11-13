CREATE TABLE "encouragement_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"revision" integer NOT NULL,
	"local_day" text NOT NULL,
	"variant" text NOT NULL,
	"topic" text NOT NULL,
	"tone" text NOT NULL,
	"arm" text NOT NULL,
	"pilot" boolean DEFAULT true NOT NULL,
	"adaptive" boolean DEFAULT false NOT NULL,
	"body_enc" text NOT NULL,
	"feedback" text,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encouragement_preferences" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"tone" text DEFAULT 'gentle' NOT NULL,
	"content" text DEFAULT '["encouragement"]' NOT NULL,
	"swearing" boolean DEFAULT false NOT NULL,
	"quiet_start" integer DEFAULT 1260 NOT NULL,
	"quiet_end" integer DEFAULT 540 NOT NULL,
	"timezone" text NOT NULL,
	"focus_enc" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"consented_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "encouragement_one_per_day" ON "encouragement_deliveries" USING btree ("phone_hash","local_day");--> statement-breakpoint
CREATE INDEX "encouragement_retention" ON "encouragement_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "encouragement_due" ON "encouragement_preferences" USING btree ("next_at") WHERE "encouragement_preferences"."enabled" and not "encouragement_preferences"."paused";