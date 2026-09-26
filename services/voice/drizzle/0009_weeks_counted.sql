ALTER TABLE "callers" ADD COLUMN "weeks_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "weeks_partly" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "weeks_undone" integer DEFAULT 0 NOT NULL;