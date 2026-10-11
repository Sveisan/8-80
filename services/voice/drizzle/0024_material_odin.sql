DROP INDEX "signups_phone_key";--> statement-breakpoint
CREATE UNIQUE INDEX "signups_phone_key" ON "signups" USING btree ("phone_hash","product");