-- ICAROS Posts CMS: Auth(이메일/비밀번호) + admins 테이블 기반 RLS로 전환
-- Track 1(Auth/RLS) + Track 3(cover_url/summary 컬럼) 스키마.
--
-- 적용: Supabase Dashboard > SQL Editor 에 이 파일 전체를 붙여넣어 실행하거나,
--       supabase CLI 연결 후 `supabase db push`.
-- 이 마이그레이션 이후 admin-posts Edge Function 과 ADMIN_PW / service_role 흐름은 더 이상 필요 없습니다.

-- ─────────────────────────────────────────────────────────────
-- 1. 관리자 테이블
-- ─────────────────────────────────────────────────────────────
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 2. is_admin() 헬퍼
--    security definer 로 admins 테이블 RLS 를 우회 → 정책 안에서 재귀 없이 호출 가능.
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to authenticated, anon;

-- admins 테이블은 본인이 관리자일 때만 조회 가능(목록 노출 방지)
drop policy if exists "admins readable by admins" on public.admins;
create policy "admins readable by admins" on public.admins
  for select
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 3. posts 컬럼 확장 (Track 3): 목록 경량화를 위한 비정규화 필드
-- ─────────────────────────────────────────────────────────────
alter table public.posts
  add column if not exists cover_url text,
  add column if not exists summary   text;

-- ─────────────────────────────────────────────────────────────
-- 4. posts RLS: 공개 읽기 + 관리자 전용 쓰기
-- ─────────────────────────────────────────────────────────────
alter table public.posts enable row level security;

drop policy if exists "posts public read"  on public.posts;
drop policy if exists "posts admin insert"  on public.posts;
drop policy if exists "posts admin update"  on public.posts;
drop policy if exists "posts admin delete"  on public.posts;

create policy "posts public read" on public.posts
  for select using (true);

create policy "posts admin insert" on public.posts
  for insert with check (public.is_admin());

create policy "posts admin update" on public.posts
  for update using (public.is_admin()) with check (public.is_admin());

create policy "posts admin delete" on public.posts
  for delete using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 5. Storage(post-img 버킷) RLS: 공개 읽기 + 관리자 전용 업로드/삭제
--    storage.objects 는 Supabase 기본으로 RLS 활성 상태이므로 정책만 추가.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "post-img public read"   on storage.objects;
drop policy if exists "post-img admin upload"   on storage.objects;
drop policy if exists "post-img admin delete"   on storage.objects;

create policy "post-img public read" on storage.objects
  for select using (bucket_id = 'post-img');

create policy "post-img admin upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-img' and public.is_admin());

create policy "post-img admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-img' and public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 6. 기존 게시글 backfill (근사치) — 관리자가 이후 저장하면 정확히 갱신됨
-- ─────────────────────────────────────────────────────────────
update public.posts
set
  cover_url = coalesce(cover_url, (regexp_match(content_md, '!\[[^\]]*\]\(([^)]+)\)'))[1]),
  summary   = coalesce(
    summary,
    left(
      btrim(
        regexp_replace(
          regexp_replace(content_md, '!\[[^\]]*\]\([^)]+\)', '', 'g'),  -- 이미지 제거
          '[#>*_`\[\]]', '', 'g'                                          -- 마크다운 기호 제거
        )
      ),
      160
    )
  )
where cover_url is null or summary is null;

-- ─────────────────────────────────────────────────────────────
-- 7. 관리자 등록
--    Dashboard → Authentication → Users → Add user 로 관리자 계정(이메일/비밀번호)을
--    먼저 만든 뒤 실행. (공개 회원가입은 Auth 설정에서 비활성화 권장.)
-- ─────────────────────────────────────────────────────────────
-- insert into public.admins (user_id, email)
-- select id, email from auth.users where email = 'YOUR_ADMIN_EMAIL@example.com'
-- on conflict (user_id) do nothing;
