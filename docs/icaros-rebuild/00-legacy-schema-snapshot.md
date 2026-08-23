# 00 — Legacy Supabase Schema Snapshot

> `supabase/migrations/0001_cms_auth_rls.sql` · `0002_cms_content.sql`의 내용 스냅샷.
> 두 파일은 2026-08-23 워킹트리에서 삭제됐고 **사용자 결정에 따라 복구하지 않는다.**
> git history(`3e8595c` 이전)에는 남아 있으므로 원문이 필요하면 `git show 3e8595c:supabase/migrations/0001_cms_auth_rls.sql`.
> 이 문서는 마이그레이션 근거 자료로만 존재한다. **리뉴얼 런타임과 무관.**

---

## 1. 권한 기반

```sql
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
  language sql security definer set search_path = public stable
as $$ select exists (select 1 from public.admins a where a.user_id = auth.uid()) $$;

grant execute on function public.is_admin() to authenticated, anon;

create policy "admins readable by admins" on public.admins
  for select using (public.is_admin());
```

`is_admin()`이 전체 트러스트 모델의 단일 지점. 모든 테이블·버킷 쓰기 정책이 이 함수를 호출한다.

---

## 2. 테이블 정의

### `posts` — ⚠ CREATE 문이 마이그레이션에 없음
`0001`은 `alter table public.posts add column if not exists cover_url text, summary text`만 수행.
테이블 본체는 그 이전에 Dashboard에서 수동 생성됨. **재현 가능한 정의가 존재하지 않는다.**

라이브에서 관측된 컬럼: `id uuid` · `title text` · `content_md text` · `cover_url text` · `summary text` · `created_at timestamptz`

### `rockets`
```sql
create table public.rockets (
  id             text primary key,            -- slug (예: 'icx1')
  name           text not null,
  img            text,
  series         text not null default 'A',   -- 'A' = ICX 1/2, 'B' = ICX MV  (CHECK 없음)
  max_altitude_m numeric,
  size_m         numeric,
  payload_kg     numeric,
  engines        jsonb not null default '[]'::jsonb,
  sort_order     int   not null default 0,
  created_at     timestamptz not null default now()
);
```

### `members`
```sql
create table public.members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  role       text,
  school     text,
  image      text,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
```

### `site_content`
```sql
create table public.site_content (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
```
슬로건 필드는 `**단어**`를 하이라이트로 렌더(마크다운 아님, 자체 파서). 본문 줄바꿈은 `\n` 저장 + CSS `white-space: pre-line`.

---

## 3. RLS 패턴 (4개 테이블 동일)

```sql
alter table public.<t> enable row level security;
create policy "<t> public read" on public.<t> for select using (true);
create policy "<t> admin write"  on public.<t> for all
  using (public.is_admin()) with check (public.is_admin());
```
`posts`만 insert/update/delete 정책이 개별 분리돼 있고 나머지는 `for all`.

---

## 4. Storage 정책 (`post-img` 버킷)

```sql
create policy "post-img public read" on storage.objects
  for select using (bucket_id = 'post-img');

create policy "post-img admin upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-img' and public.is_admin());

create policy "post-img admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-img' and public.is_admin());
```
**update 정책 없음** — 클라이언트가 `upsert: false`로만 올려서 현재는 무해.

---

## 5. 시드 데이터 — 라이브와 불일치 (신뢰 불가)

| 시드 | 라이브 | 비고 |
|---|---|---|
| rockets 7기 (`icx1` `icx1s` `icx2` `icx2s` `icxmv1` `icxmv1lr` `icxmv1mirv`) | **4기** | `icx2`·`icx2s`·`icxmv1mirv` 삭제됨 |
| `icx1` = `ICX-I`, 200m/1.5m, 90N/2s | `ICX-IA`, 150m/0.6m, 146N/1.1s | 이름·스펙 전부 변경 |
| members 구 부서명(`동체부`, `전자제어부`, `추진공학부 부장`) | `비행제어부`·`전자부`·`주관 · 전 부분 총괄 설계` | 조직 개편 |
| `donation.goal` 2,700,000 / `current` 900,000 | 3,200,000 / 2,257,445 | 실시간 값 |
| `about.slogan` = `...from **UAVs** to rockets.` | `...from **UAVs to rockets.**` | 강조 범위 변경 |

**마이그레이션 소스는 시드 SQL도, `src/assets/*.json`도 아니다. 라이브 DB만이 진실이다.**

---

## 6. 보안 사고 기록 (조치 종결)

- 커밋 `c5bffd0`("add post")에 `.env.local` 전체가 **PUBLIC 저장소**로 커밋됨.
  포함 변수: `VITE_SUPABASE_URL` · `VITE_SUPABASE_PUBLISHABLE_KEY` · `VITE_SUPABASE_ANON_KEY` · **`VITE_ADMIN_PW`**
- `08dd75a`("add cms")에서 파일 삭제 + `.gitignore`에 `.env` / `.env.*` 추가. **git history에는 잔존.**
- anon/publishable 키는 설계상 클라이언트 공개 값 → 위험 낮음.
- `VITE_ADMIN_PW`(구 관리자 비밀번호)는 평문 노출. **사용자 판단: 이미 폐기된 값 — 로테이션·history purge 미실시.**
- 리뉴얼 시 Supabase 자체가 제거되므로 해당 자격증명 계열은 전부 무효화된다.
- 로컬 `.env.local`에 남은 `VITE_ADMIN_PW`는 사용처가 없는 죽은 변수 → 리뉴얼 시 제거.
