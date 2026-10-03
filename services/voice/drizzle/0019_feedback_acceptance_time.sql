ALTER TABLE "feedback" ALTER COLUMN "sent_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "sent_at" DROP NOT NULL;