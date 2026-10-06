CREATE TABLE "icaros"."rocket_series" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rocket_series_id_ck" CHECK ("icaros"."rocket_series"."id" ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,31}$'),
	CONSTRAINT "rocket_series_label_ck" CHECK (length(btrim("icaros"."rocket_series"."label")) > 0)
);
--> statement-breakpoint
CREATE INDEX "rocket_series_order_idx" ON "icaros"."rocket_series" USING btree ("sort_order");--> statement-breakpoint
-- 기존 두 시리즈를 행으로 옮긴다. 라벨은 components/rocket/series.ts 에 하드코딩돼 있던 값
-- 그대로다 — 팀 안에서 통용되는 호칭이라 이관하면서 바꾸지 않는다.
INSERT INTO "icaros"."rocket_series" ("id", "label", "sort_order") VALUES
	('A', 'ICX 1/2 Series', 0),
	('B', 'ICX MV Series', 1)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- 방어. 위 두 값만 있는 게 맞지만(예전 CHECK 가 그렇게 막고 있었다), 하나라도 다른 값이
-- 남아 있으면 아래 FK 가 실패하고 원인이 "마이그레이션이 깨졌다"로만 보인다.
-- 데이터에서 직접 긁어 채워 두면 그 경우에도 참조가 성립한다. 라벨은 나중에 /admin 에서 고친다.
INSERT INTO "icaros"."rocket_series" ("id", "label", "sort_order")
SELECT DISTINCT r."series", r."series", 100
	FROM "icaros"."rockets" r
	WHERE NOT EXISTS (
		SELECT 1 FROM "icaros"."rocket_series" s WHERE s."id" = r."series"
	)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- 값 집합이 코드에서 행으로 내려왔다. CHECK 를 FK 로 교체한다.
ALTER TABLE "icaros"."rockets" DROP CONSTRAINT "rockets_series_ck";--> statement-breakpoint
ALTER TABLE "icaros"."rockets" ADD CONSTRAINT "rockets_series_rocket_series_id_fk" FOREIGN KEY ("series") REFERENCES "icaros"."rocket_series"("id") ON DELETE restrict ON UPDATE cascade;
