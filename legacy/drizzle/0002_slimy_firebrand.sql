CREATE TABLE "icaros"."home_feature" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"rocket_id" text,
	"model_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_feature_singleton_ck" CHECK ("icaros"."home_feature"."id" = 'singleton')
);
--> statement-breakpoint
CREATE TABLE "icaros"."rocket_hotspots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body_md" text,
	"x" numeric(10, 4) DEFAULT '0' NOT NULL,
	"y" numeric(10, 4) DEFAULT '0' NOT NULL,
	"z" numeric(10, 4) DEFAULT '0' NOT NULL,
	"highlight_node" text,
	"sort_order" numeric(6, 0) DEFAULT '0' NOT NULL,
	CONSTRAINT "rocket_hotspots_title_ck" CHECK (length(btrim("icaros"."rocket_hotspots"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "icaros"."rocket_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rocket_id" text,
	"label" text NOT NULL,
	"glb_media_id" uuid,
	"poster_media_id" uuid,
	"scale" numeric(8, 4) DEFAULT '1' NOT NULL,
	"position_x" numeric(10, 4) DEFAULT '0' NOT NULL,
	"position_y" numeric(10, 4) DEFAULT '0' NOT NULL,
	"position_z" numeric(10, 4) DEFAULT '0' NOT NULL,
	"rotation_x" numeric(10, 4) DEFAULT '0' NOT NULL,
	"rotation_y" numeric(10, 4) DEFAULT '0' NOT NULL,
	"rotation_z" numeric(10, 4) DEFAULT '0' NOT NULL,
	"camera_x" numeric(10, 4) DEFAULT '0' NOT NULL,
	"camera_y" numeric(10, 4) DEFAULT '0' NOT NULL,
	"camera_z" numeric(10, 4) DEFAULT '5' NOT NULL,
	"target_x" numeric(10, 4) DEFAULT '0' NOT NULL,
	"target_y" numeric(10, 4) DEFAULT '0' NOT NULL,
	"target_z" numeric(10, 4) DEFAULT '0' NOT NULL,
	"fov" numeric(6, 2) DEFAULT '45' NOT NULL,
	"camera_presets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"environment" text DEFAULT 'studio' NOT NULL,
	"exposure" numeric(6, 3) DEFAULT '1' NOT NULL,
	"ambient_intensity" numeric(6, 3) DEFAULT '1' NOT NULL,
	"key_intensity" numeric(6, 3) DEFAULT '1' NOT NULL,
	"auto_rotate" boolean DEFAULT false NOT NULL,
	"animation_clip" text,
	"enabled_desktop" boolean DEFAULT true NOT NULL,
	"enabled_mobile" boolean DEFAULT false NOT NULL,
	"extras" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rocket_models_scale_ck" CHECK ("icaros"."rocket_models"."scale" > 0),
	CONSTRAINT "rocket_models_fov_ck" CHECK ("icaros"."rocket_models"."fov" > 0 and "icaros"."rocket_models"."fov" < 180),
	CONSTRAINT "rocket_models_exposure_ck" CHECK ("icaros"."rocket_models"."exposure" >= 0),
	CONSTRAINT "rocket_models_env_ck" CHECK ("icaros"."rocket_models"."environment" in ('studio','city','sunset','dawn','night','warehouse','none')),
	CONSTRAINT "rocket_models_presets_ck" CHECK (jsonb_typeof("icaros"."rocket_models"."camera_presets") = 'array'),
	CONSTRAINT "rocket_models_extras_ck" CHECK (jsonb_typeof("icaros"."rocket_models"."extras") = 'object')
);
--> statement-breakpoint
ALTER TABLE "icaros"."home_feature" ADD CONSTRAINT "home_feature_rocket_id_rockets_id_fk" FOREIGN KEY ("rocket_id") REFERENCES "icaros"."rockets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icaros"."home_feature" ADD CONSTRAINT "home_feature_model_id_rocket_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "icaros"."rocket_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icaros"."rocket_hotspots" ADD CONSTRAINT "rocket_hotspots_model_id_rocket_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "icaros"."rocket_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icaros"."rocket_models" ADD CONSTRAINT "rocket_models_rocket_id_rockets_id_fk" FOREIGN KEY ("rocket_id") REFERENCES "icaros"."rockets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "home_feature_singleton_uq" ON "icaros"."home_feature" USING btree ("id");--> statement-breakpoint
CREATE INDEX "rocket_hotspots_model_idx" ON "icaros"."rocket_hotspots" USING btree ("model_id","sort_order");--> statement-breakpoint
CREATE INDEX "rocket_models_rocket_idx" ON "icaros"."rocket_models" USING btree ("rocket_id");