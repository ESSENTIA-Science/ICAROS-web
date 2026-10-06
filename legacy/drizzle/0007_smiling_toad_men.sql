-- ⚠️ 이 파일은 `db:generate` 산출물을 **손으로 편집**했다. 세 곳이 추가되었고,
-- 셋 다 생성기가 알 수 없는 것 — 즉 **데이터 이동**이다. 생성기는 스키마의 전후만 본다.
--
--  ① `vehicle_types` 에 'rockets' 한 행. `rocket_series.type_id` 가 NOT NULL DEFAULT 'rockets'
--     라서 컬럼이 생기는 순간 기존 행이 전부 'rockets' 를 가리킨다. 그 행이 없으면 아래
--     FK 추가가 실패하고, 원인은 "마이그레이션이 깨졌다"로만 보인다. 0006 이 `rocket_series`
--     에서 한 것과 같은 이유·같은 모양이다.
--     나머지 두 분류('satellites'·'uavs')는 **여기 없다** — 아무 제약도 그것들에 의존하지
--     않고, 없어도 화면이 한 분류만 보일 뿐 깨지지 않는다. `scripts/db/seed-w5.ts` 가 넣는다.
--
--  ② `page_panels.cta_href` 의 '/rocket' → '/vehicles' UPDATE. **CHECK 변경보다 먼저**,
--     그리고 **옛 CHECK 를 떨어뜨린 뒤**여야 한다. 양쪽 모두 어기면 실패한다:
--       - 새 CHECK 를 먼저 걸면 → 남아 있는 '/rocket' 행이 걸려 통째로 롤백
--       - 옛 CHECK 가 살아 있을 때 UPDATE 하면 → '/vehicles' 가 옛 목록에 없어 위반
--     그래서 자리는 DROP 과 ADD **사이** 한 곳뿐이다.
--
--  ③ `site_settings` 에 'donation.round_label' 한 행. 스키마 변경이 아니라 데이터지만
--     마이그레이션에 넣는다 — 이 행이 없으면 `saveLandingCopyAction` 이 `RowsMissing` 으로
--     **랜딩 저장 전체를 거부**하고(잘린 폼이 카피를 날리는 것을 막는 장치다), 다음 웨이브가
--     이 키를 `LANDING_KEYS` 에 넣는 순간 /admin 이 잠긴다. 스크립트에 두면 사람이 잊어도
--     **아무것도 알려 주지 않는다.** 마이그레이션이면 `db:verify` 의 원장 대조에 걸린다.
--     값은 넣기만 하고 이후에는 /admin 에서 고친다.
--
-- 세 문장 모두 재실행 안전하다(ON CONFLICT DO NOTHING · 조건부 UPDATE).
CREATE TABLE "icaros"."vehicle_types" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_types_id_ck" CHECK ("icaros"."vehicle_types"."id" ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,31}$'),
	CONSTRAINT "vehicle_types_label_ck" CHECK (length(btrim("icaros"."vehicle_types"."label")) > 0)
);
--> statement-breakpoint
-- ① 아래 FK 가 성립하려면 이 행이 먼저 있어야 한다. 라벨은 화면 표기(VEHICLES)와 같은
-- 대문자로 둔다 — 팀이 /admin 에서 언제든 고친다.
INSERT INTO "icaros"."vehicle_types" ("id", "label", "sort_order") VALUES
	('rockets', 'ROCKETS', 0)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "icaros"."page_panels" DROP CONSTRAINT "page_panels_cta_href_ck";--> statement-breakpoint
-- ② 옛 CHECK 가 떨어진 지금이 유일한 창이다. 아래 ADD CONSTRAINT 보다 반드시 먼저.
UPDATE "icaros"."page_panels" SET "cta_href" = '/vehicles', "updated_at" = now()
	WHERE "cta_href" = '/rocket';--> statement-breakpoint
ALTER TABLE "icaros"."members" ADD COLUMN "bio_md" text;--> statement-breakpoint
ALTER TABLE "icaros"."rocket_series" ADD COLUMN "type_id" text DEFAULT 'rockets' NOT NULL;--> statement-breakpoint
ALTER TABLE "icaros"."rocket_series" ADD COLUMN "description_md" text;--> statement-breakpoint
CREATE INDEX "vehicle_types_order_idx" ON "icaros"."vehicle_types" USING btree ("sort_order");--> statement-breakpoint
ALTER TABLE "icaros"."rocket_series" ADD CONSTRAINT "rocket_series_type_id_vehicle_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "icaros"."vehicle_types"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "icaros"."page_panels" ADD CONSTRAINT "page_panels_cta_href_ck" CHECK ("icaros"."page_panels"."cta_href" is null or "icaros"."page_panels"."cta_href" in ('/vehicles', '/member', '/posts', '#support', '#contact'));--> statement-breakpoint
-- ③ 다음 웨이브가 이 키를 LANDING_KEYS 에 추가하기 전에 행이 있어야 한다.
INSERT INTO "icaros"."site_settings" ("key", "value") VALUES
	('donation.round_label', '1–3차')
ON CONFLICT ("key") DO NOTHING;
