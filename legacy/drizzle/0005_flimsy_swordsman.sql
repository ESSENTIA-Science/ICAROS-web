DROP INDEX "icaros"."legacy_posts_published_idx";--> statement-breakpoint
ALTER TABLE "icaros"."legacy_posts" ADD COLUMN "published" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "legacy_posts_published_idx" ON "icaros"."legacy_posts" USING btree ("published","published_at");