CREATE TABLE "icaros"."legacy_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content_md" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"cover_media_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_posts_title_ck" CHECK (length(btrim("icaros"."legacy_posts"."title")) > 0),
	CONSTRAINT "legacy_posts_slug_ck" CHECK ("icaros"."legacy_posts"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "legacy_posts_no_legacy_url_ck" CHECK ("icaros"."legacy_posts"."content_md" not like '%supabase.co%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_posts_slug_uq" ON "icaros"."legacy_posts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "legacy_posts_published_idx" ON "icaros"."legacy_posts" USING btree ("published_at");