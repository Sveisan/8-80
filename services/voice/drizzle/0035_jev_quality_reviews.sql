CREATE TABLE "jev_quality_reviews" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"report" text,
	"recap_enc" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jev_quality_reviews" ADD CONSTRAINT "jev_quality_reviews_attempt_id_call_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "call_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jev_quality_reviews" ADD CONSTRAINT "jev_quality_reviews_phone_hash_callers_phone_hash_fk" FOREIGN KEY ("phone_hash") REFERENCES "callers"("phone_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jev_quality_expiry" ON "jev_quality_reviews" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "jev_quality_caller" ON "jev_quality_reviews" USING btree ("phone_hash");