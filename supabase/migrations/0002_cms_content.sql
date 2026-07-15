-- 통합 CMS: rockets / members / site_content 테이블 + RLS + 기존 데이터 seed
-- 전제: 0001_cms_auth_rls.sql 의 public.is_admin() / public.admins 존재.
-- RLS 패턴은 posts 와 동일: 공개 read + is_admin() write.

-- ─────────────────────────────────────────────────────────────
-- rockets  (rocket_info.json 이관)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.rockets (
  id             text primary key,             -- slug (예: 'icx1')
  name           text not null,
  img            text,
  series         text not null default 'A',    -- 'A' = ICX 1/2, 'B' = ICX MV
  max_altitude_m numeric,
  size_m         numeric,
  payload_kg     numeric,
  engines        jsonb not null default '[]'::jsonb,
  sort_order     int   not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.rockets enable row level security;
drop policy if exists "rockets public read"  on public.rockets;
drop policy if exists "rockets admin write"   on public.rockets;
create policy "rockets public read" on public.rockets for select using (true);
create policy "rockets admin write" on public.rockets for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.rockets (id, name, img, series, max_altitude_m, size_m, payload_kg, engines, sort_order) values
  ('icx1',       'ICX-I',        '/assets/img/rocket/icx1.webp',     'A', 200, 1.5, 0.5, '[{"type":"KNSB","thrust_n":90,"burn_time_s":2}]'::jsonb, 0),
  ('icx1s',      'ICX-Is',       '/assets/img/rocket/icx1s.webp',    'A', 250, 1.6, 0.5, '[{"type":"KNSB","thrust_n":90,"burn_time_s":2},{"type":"Black Powder","thrust_n":6.8,"burn_time_s":0.6,"count":3}]'::jsonb, 1),
  ('icx2',       'ICX-II',       '/assets/img/rocket/icx2.webp',     'A',  80, 1.7, 0.5, '[{"type":"KNSB","mode":"landing burn"}]'::jsonb, 2),
  ('icx2s',      'ICX-IIs',      '/assets/img/rocket/icx2s.webp',    'A', 130, 1.8, 0.5, '[{"type":"KNSB","thrust_n":90,"burn_time_s":2},{"type":"Black Powder","thrust_n":6.8,"burn_time_s":0.6,"count":3}]'::jsonb, 3),
  ('icxmv1',     'ICX MV-I',     '/assets/img/rocket/icxmv1.webp',   'B', 200, 1.8, 0.8, '[{"type":"KNSB","thrust_n":90,"burn_time_s":2}]'::jsonb, 0),
  ('icxmv1lr',   'ICX MV-I LR',  '/assets/img/rocket/icxmv1lr.webp', 'B', 250, 1.9, 0.8, '[{"type":"KNSB","thrust_n":90,"burn_time_s":2},{"type":"Black Powder","thrust_n":6.8,"burn_time_s":0.6,"count":3}]'::jsonb, 1),
  ('icxmv1mirv', 'ICX MV-I MIRV','/assets/img/rocket/icxmv1lr.webp', 'B', 230, 1.9, 1.0, '[{"type":"KNSB","thrust_n":90,"burn_time_s":2},{"type":"Black Powder","thrust_n":6.8,"burn_time_s":0.6,"count":3}]'::jsonb, 2)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- members  (member.json 이관)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  role       text,
  school     text,
  image      text,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;
drop policy if exists "members public read" on public.members;
drop policy if exists "members admin write"  on public.members;
create policy "members public read" on public.members for select using (true);
create policy "members admin write" on public.members for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.members (name, role, school, image, sort_order) values
  ('김지후', '주관 · 추진공학부 부장',   '표선고등학교', '/assets/img/member/kimjihoo.webp',    0),
  ('박현빈', '부주관 · 전자제어부 부장', '남녕고등학교', '/assets/img/member/parkhyunbin.webp', 1),
  ('이성우', '동체부 부장',             '아라중학교',   '/assets/img/member/sungwoo.webp',     2),
  ('백예람', '법률·재무 부장',          '서정고등학교', '/assets/img/member/yeahram.webp',     3),
  ('이솔',   'SW부',                   '표선고등학교', null,                                  4),
  ('고연호', 'SW부',                   '아라중학교',   '/assets/img/member/yunho.jpg',        5),
  ('김하준', '추진공학부',              null,          null, 6),
  ('양성재', '동체부',                 null,          null, 7),
  ('윤건',   '동체부',                 null,          null, 8),
  ('이황주', '전자제어부',              null,          null, 9),
  ('현서효', '전자제어부',              null,          null, 10),
  ('박재민', '전자제어부',              null,          null, 11),
  ('현영준', '추진공학부',              null,          null, 12),
  ('윤효준', '추진공학부',              null,          null, 13),
  ('강현우', '추진공학부',              null,          null, 14),
  ('김민준', '동체부',                 null,          null, 15),
  ('조한빛', '동체부',                 '아라중학교',   null, 16),
  ('이혁준', '동체부',                 '아라중학교',   null, 17),
  ('정근호', '동체부',                 '아라중학교',   null, 18),
  ('조현재', '동체부',                 '아라중학교',   null, 19),
  ('김호연', '동체부',                 '아라중학교',   null, 20)
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────
-- site_content  (랜딩 문구 + 기부 현황) — key/value 문자열.
--   슬로건 필드는 **단어** 를 하이라이트로 렌더(home.jsx 미니 파서).
--   본문의 줄바꿈은 개행(\n)으로 저장하고 CSS white-space: pre-line 으로 렌더.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.site_content (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;
drop policy if exists "site_content public read" on public.site_content;
drop policy if exists "site_content admin write"  on public.site_content;
create policy "site_content public read" on public.site_content for select using (true);
create policy "site_content admin write" on public.site_content for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.site_content (key, value) values
  ('about.slogan', 'We build what flies, from **UAVs** to rockets.'),
  ('about.body', 'ICAROS는 무인기 설계와 비행 제어를 중심으로 항공우주 기술을 탐구하는 학생 연구 프로젝트입니다.
우리는 비행기, 드론, 로켓 등을 직접 설계하고 제작하며, 실제 비행 데이터와 실험 결과를 바탕으로 더 나은 기체와 시스템을 만들어갑니다.
현재는 고정익 및 회전익 무인기 개발을 핵심 활동으로 하며 기체 구조 설계, 비행 제어, 센서 데이터 분석, 시험 비행을 통해 실질적인 항공우주 프로젝트를 진행하고 있습니다.
또한 로켓공학 분야에서는 추진 원리, 구조 설계, 비행 안정성, 회수 시스템 등을 이론 연구와 시뮬레이션, 안전한 범위의 실험을 통해 함께 탐구합니다.'),
  ('vision.slogan', 'We learn from **COSMOS**, not textbooks.'),
  ('vision.body', 'ICAROS는 학생들이 직접 항공우주 시스템을 설계하고 검증하는 경험을 통해,
미래 항공우주 기술을 이해하고 만들어갈 수 있는 기반을 쌓는 것을 목표로 합니다.
우리는 단순히 기체를 제작하는 것에 그치지 않고,
비행 원리, 제어 기술, 구조 설계, 추진 시스템을 종합적으로 탐구하며
실제 문제를 해결하는 항공우주 프로젝트 팀으로 성장하고자 합니다.'),
  ('research.uav.title', 'Unmanned Aerial Vehicles'),
  ('research.uav.body', 'ICAROS의 핵심 연구 분야는 무인기입니다.
고정익 및 회전익 무인기를 직접 설계하고 제작하며, 시험 비행을 통해 기체 성능과 안정성을 개선합니다.'),
  ('research.control.title', 'Flight Control & Data'),
  ('research.control.body', '비행 제어 시스템, 자세 안정화, 센서 데이터 분석을 연구합니다.
실제 비행 데이터를 바탕으로 기체의 문제점을 파악하고, 더 안정적이고 정밀한 비행을 목표로 개선을 진행합니다.'),
  ('research.rocketry.title', 'Rocketry & Propulsion'),
  ('research.rocketry.body', '로켓 공학과 추진 시스템은 고체연료 과학 로켓을 직접 개발하고 발사하며 이론 연구, 시뮬레이션, 구조 설계, 안전한 범위의 실험을 중심으로 탐구합니다.
추진 원리, 비행 안정성, 회수 시스템 등을 연구하며 항공우주 기술에 대한 이해를 확장합니다.'),
  ('mission.body', 'ICAROS는 고정익 무인기와 회전익 무인기를 중심으로 직접 설계, 제작, 시험 비행을 진행합니다.
또한 로켓공학 분야에서는 추진 원리와 구조 설계, 비행 안정성, 회수 시스템 등을 현실적이고 안전한 범위 안에서 탐구합니다.
우리는 실제 제작과 실험을 통해 항공우주 기술을 경험하고, 실패와 개선 과정을 반복하며 더 나은 시스템을 만들어가는 것을 목표로 합니다.'),
  ('mission.list', '고정익 및 회전익 무인기 설계, 제작, 비행 시험
비행 제어 시스템과 자세 안정화 기술 연구
항공 구조, 공력, 추진 시스템에 대한 실험 및 분석
로켓공학 이론 연구, 시뮬레이션, 구조 설계 탐구
실제 비행 데이터 기반의 기체 개선 및 프로젝트 확장'),
  ('donate.intro', 'ICAROS는 학생들이 직접 항공우주 기술을 실험하고 발전시켜 나가는 프로젝트입니다.
여러분의 후원은 새로운 기체를 제작하고, 더 안전하고 정밀한 실험 환경을 만드는 데 사용됩니다.'),
  ('donate.usage_title', '여러분의 후원금은 이렇게 사용됩니다.'),
  ('donate.usage_list', '무인기 제작 부품
전자 장비 및 비행 제어 장치
배터리, 센서, 통신 장비
3D 프린팅 재료 및 구조 제작 비용
시험 비행 및 안전 장비
로켓공학 연구 자료와 시뮬레이션 환경 구축'),
  ('contact.body', 'ICAROS는 무인기, 항공우주, 로켓공학에 관심 있는 사람들과 함께 성장하고 있습니다.
프로젝트 참여, 협업, 후원 문의는 언제든지 연락해 주세요.'),
  ('donation.goal', '2700000'),
  ('donation.current', '900000')
on conflict (key) do nothing;
