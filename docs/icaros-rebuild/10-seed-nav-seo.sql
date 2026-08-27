-- ─────────────────────────────────────────────────────────────────────────────
-- site_settings 시드: 헤더 메뉴명(nav.*) + SEO/OG(seo.*, og.*)   — A2 · F10
--
-- 적용 방법 (사용자가 직접):
--   로컬  docker exec -i icaros-db psql -U icaros -d icaros < docs/icaros-rebuild/10-seed-nav-seo.sql
--   운영  psql "$DATABASE_URL_UNPOOLED" -f docs/icaros-rebuild/10-seed-nav-seo.sql
--
-- ⚠ 적용 전까지 /admin 의 Landing 탭 **카피 폼**은 열리지 않는다.
--   `_data/landing.ts` 카탈로그가 이 7키를 요구하고, 값을 모르는 채로 폼을 그리면
--   저장 시 공백으로 덮이기 때문이다 (F8). 섹션 노출·순서 편집은 그와 무관하게 계속 열린다.
--
-- 값은 **기존 코드에 하드코딩돼 있던 문구 그대로**다. 이 시드는 문구를 바꾸지 않는다:
--   nav.*                  src/components/ui/Header.tsx 의 NAV 배열 (삭제됨)
--   seo.title              src/app/layout.tsx metadata.title.default
--   seo.description        src/app/layout.tsx metadata.description
--   og.image_media_id      빈 값 = 기존 정적 파일 /og.png 유지
--
-- on conflict do nothing: 이미 사람이 고쳐 놓은 값을 시드가 되돌리지 않는다. 재실행해도 안전하다.
-- ─────────────────────────────────────────────────────────────────────────────

insert into icaros.site_settings (key, value) values
  ('nav.about',         'About Us'),
  ('nav.rocket',        'Rockets'),
  ('nav.posts',         'Posts'),
  ('nav.member',        'Members'),
  ('seo.title',         'ICAROS'),
  ('seo.description',   'ICAROS는 학생 주도 항공우주·로켓 연구팀으로 무인기 설계, 비행 제어, 고체연료 로켓 개발과 발사를 수행합니다.'),
  ('og.image_media_id', '')
on conflict (key) do nothing;

-- 확인
select key, value from icaros.site_settings
where key in ('nav.about','nav.rocket','nav.posts','nav.member','seo.title','seo.description','og.image_media_id')
order by key;
