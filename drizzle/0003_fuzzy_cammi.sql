CREATE TABLE "icaros"."page_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"media_id" uuid NOT NULL,
	"focal_x" smallint DEFAULT 50 NOT NULL,
	"focal_y" smallint DEFAULT 50 NOT NULL,
	"scrim" text DEFAULT 'bottom' NOT NULL,
	"anchor" text DEFAULT 'bottom-left' NOT NULL,
	"height" text DEFAULT 'full' NOT NULL,
	"eyebrow" text,
	"headline" text NOT NULL,
	"body" text,
	"cta_label" text,
	"cta_href" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_panels_focal_x_ck" CHECK ("icaros"."page_panels"."focal_x" between 0 and 100),
	CONSTRAINT "page_panels_focal_y_ck" CHECK ("icaros"."page_panels"."focal_y" between 0 and 100),
	CONSTRAINT "page_panels_scrim_ck" CHECK ("icaros"."page_panels"."scrim" in ('none', 'bottom', 'full', 'top')),
	CONSTRAINT "page_panels_anchor_ck" CHECK ("icaros"."page_panels"."anchor" in ('bottom-left', 'bottom-center', 'center', 'top-left')),
	CONSTRAINT "page_panels_height_ck" CHECK ("icaros"."page_panels"."height" in ('full', 'tall', 'half')),
	CONSTRAINT "page_panels_cta_href_ck" CHECK ("icaros"."page_panels"."cta_href" is null or "icaros"."page_panels"."cta_href" in ('/rocket', '/member', '/posts', '#support', '#contact')),
	CONSTRAINT "page_panels_cta_pair_ck" CHECK (("icaros"."page_panels"."cta_label" is null) = ("icaros"."page_panels"."cta_href" is null)),
	CONSTRAINT "page_panels_headline_ck" CHECK (length(btrim("icaros"."page_panels"."headline")) > 0)
);
--> statement-breakpoint
ALTER TABLE "icaros"."page_panels" ADD CONSTRAINT "page_panels_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "icaros"."media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_panels_order_idx" ON "icaros"."page_panels" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "page_panels_published_idx" ON "icaros"."page_panels" USING btree ("published","sort_order");