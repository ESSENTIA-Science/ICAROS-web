CREATE SCHEMA IF NOT EXISTS "icaros";
--> statement-breakpoint
CREATE TYPE "icaros"."media_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "icaros"."members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"squad" text,
	"school" text,
	"image_media_id" uuid,
	"published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_name_ck" CHECK (length(btrim("icaros"."members"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "icaros"."page_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icaros"."rocket_engines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rocket_id" text NOT NULL,
	"type" text NOT NULL,
	"thrust_n" numeric(10, 2),
	"burn_time_s" numeric(10, 3),
	"count" integer DEFAULT 1 NOT NULL,
	"mode" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rocket_engines_count_ck" CHECK ("icaros"."rocket_engines"."count" >= 1),
	CONSTRAINT "rocket_engines_thrust_ck" CHECK ("icaros"."rocket_engines"."thrust_n" is null or "icaros"."rocket_engines"."thrust_n" > 0),
	CONSTRAINT "rocket_engines_burn_ck" CHECK ("icaros"."rocket_engines"."burn_time_s" is null or "icaros"."rocket_engines"."burn_time_s" > 0)
);
--> statement-breakpoint
CREATE TABLE "icaros"."rockets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"series" text DEFAULT 'A' NOT NULL,
	"description_md" text,
	"cover_media_id" uuid,
	"max_altitude_m" numeric(10, 2),
	"size_m" numeric(10, 3),
	"payload_kg" numeric(10, 3),
	"published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rockets_series_ck" CHECK ("icaros"."rockets"."series" in ('A','B')),
	CONSTRAINT "rockets_altitude_ck" CHECK ("icaros"."rockets"."max_altitude_m" is null or "icaros"."rockets"."max_altitude_m" >= 0),
	CONSTRAINT "rockets_size_ck" CHECK ("icaros"."rockets"."size_m" is null or "icaros"."rockets"."size_m" > 0),
	CONSTRAINT "rockets_payload_ck" CHECK ("icaros"."rockets"."payload_kg" is null or "icaros"."rockets"."payload_kg" >= 0)
);
--> statement-breakpoint
CREATE TABLE "icaros"."site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icaros"."media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"original_filename" text,
	"mime" text NOT NULL,
	"size" bigint,
	"etag" text,
	"width" integer,
	"height" integer,
	"status" "icaros"."media_status" DEFAULT 'pending' NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_key_prefix_ck" CHECK ("icaros"."media"."key" like 'icaros-web/%' or "icaros"."media"."key" like 'forum/%'),
	CONSTRAINT "media_size_ck" CHECK ("icaros"."media"."size" is null or "icaros"."media"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "icaros"."storage_cleanup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "icaros"."admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "icaros"."admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_ck" CHECK ("icaros"."admin_users"."email" = lower(btrim("icaros"."admin_users"."email"))),
	CONSTRAINT "admin_users_hash_ck" CHECK ("icaros"."admin_users"."password_hash" like '$argon2id$%')
);
--> statement-breakpoint
CREATE TABLE "icaros"."auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"email_attempted" text,
	"user_id" uuid,
	"ip" text,
	"user_agent" text,
	"detail" jsonb,
	CONSTRAINT "auth_events_kind_ck" CHECK ("icaros"."auth_events"."kind" in ('login_success','login_fail','logout','session_expired','password_changed','admin_deactivated','rate_limited','bootstrap'))
);
--> statement-breakpoint
CREATE TABLE "icaros"."login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"first_fail_at" timestamp with time zone,
	"last_fail_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	CONSTRAINT "login_attempts_count_ck" CHECK ("icaros"."login_attempts"."fail_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "icaros"."rocket_engines" ADD CONSTRAINT "rocket_engines_rocket_id_rockets_id_fk" FOREIGN KEY ("rocket_id") REFERENCES "icaros"."rockets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icaros"."admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "icaros"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_order_idx" ON "icaros"."members" USING btree ("sort_order","created_at");--> statement-breakpoint
CREATE INDEX "page_sections_order_idx" ON "icaros"."page_sections" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "rocket_engines_rocket_idx" ON "icaros"."rocket_engines" USING btree ("rocket_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "rockets_series_order_uq" ON "icaros"."rockets" USING btree ("series","sort_order");--> statement-breakpoint
CREATE INDEX "media_key_uq" ON "icaros"."media" USING btree ("bucket","key");--> statement-breakpoint
CREATE INDEX "media_entity_idx" ON "icaros"."media" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "media_status_idx" ON "icaros"."media" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "storage_cleanup_pending_idx" ON "icaros"."storage_cleanup_jobs" USING btree ("completed_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_uq" ON "icaros"."admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "icaros"."admin_sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "admin_sessions_expiry_idx" ON "icaros"."admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_uq" ON "icaros"."admin_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "auth_events_at_idx" ON "icaros"."auth_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "auth_events_kind_idx" ON "icaros"."auth_events" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "login_attempts_locked_idx" ON "icaros"."login_attempts" USING btree ("locked_until");