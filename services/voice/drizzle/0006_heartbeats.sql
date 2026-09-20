CREATE TABLE "heartbeats" (
	"job" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
