CREATE TABLE "unblock_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"checked_in_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "unblock_availability" ("id") VALUES ('sole-operator');
