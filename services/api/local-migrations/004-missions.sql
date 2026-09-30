-- LOCAL ONLY. Mission records are owned by ICAROS, independently of Community posts.
-- Convert to the approved production migration path before deployment.
BEGIN;

CREATE TABLE IF NOT EXISTS icaros.missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  launch_date date NOT NULL,
  vehicle_id text REFERENCES icaros.rockets(id) ON DELETE SET NULL,
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 200),
  outcome text NOT NULL CHECK (outcome IN ('success', 'partial', 'failure', 'planned')),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 1000),
  body_md text NOT NULL DEFAULT '' CHECK (length(body_md) <= 100000),
  cover_media_id uuid REFERENCES icaros.media(id) ON DELETE SET NULL,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS missions_public_date_idx ON icaros.missions (launch_date DESC, id) WHERE published;

-- Seed only launch events with an explicit date in the source body. The source
-- article remains in Posts; Mission becomes an independently editable record.
INSERT INTO icaros.missions (id, title, launch_date, vehicle_id, location, outcome, summary, body_md, cover_media_id, published)
SELECT '17c8105e-70ba-4d48-9c73-8f5ac0260718'::uuid, 'ICX-1A 첫 발사', DATE '2026-07-18', 'icx1',
  '알뜨르 비행장', 'success', '첫 고체연료 로켓 발사. 점화·비행·회수 성공.', p.content_md,
  substring(p.content_md from '/api/media/([0-9a-f-]{36})')::uuid, true
FROM icaros.legacy_posts p WHERE p.title = 'ICX-1A Launch'
ON CONFLICT (id) DO NOTHING;

INSERT INTO icaros.missions (id, title, launch_date, vehicle_id, location, outcome, summary, body_md, cover_media_id, published)
SELECT 'b47630e2-14f6-4c7a-908f-0ab9a0260817'::uuid, 'RAON 발사', DATE '2026-08-17', 'icx2a',
  '금악 사유지', 'partial', '발사·테일핀 제어·회수 성공. 사출장치 오작동으로 목표 고도 미달.', p.content_md,
  substring(p.content_md from '/api/media/([0-9a-f-]{36})')::uuid, true
FROM icaros.legacy_posts p WHERE p.title = 'RAON 발사'
ON CONFLICT (id) DO NOTHING;

COMMIT;
