# 레거시 Supabase 덤프 (U1 · U2)

> Supabase Management API(`/v1/projects/{ref}/database/query`)로 추출. DB 비밀번호 없이 access token 만 사용.
> 프로젝트 `<legacy-supabase-ref>` (ICAROS) · PostgreSQL 17.6.1 · `ACTIVE_HEALTHY`
> 추출 시점 2026-08-23. **읽기 전용 — 아무것도 변경하지 않았다.**
>
> `docs/icaros-rebuild/` 가 아니라 여기에 둔 이유: 그 디렉터리를 동시에 다른 작업이 쓰고 있어서다.

---

## U1 — `public.posts` DDL (해소)

레포에도 git history 에도 없던 정의다. `0001` 마이그레이션은 `alter table` 만 했고
테이블 본체는 Dashboard 에서 수동 생성됐다.

```sql
create table public.posts (
  id         uuid not null default gen_random_uuid(),
  title      text not null,
  content_md text not null,
  created_at timestamptz default now(),
  cover_url  text,
  summary    text,
  constraint posts_pkey primary key (id)
);
```

제약은 PK 하나뿐. 인덱스도 `posts_pkey` 하나뿐.
**`created_at` 이 nullable 이고 인덱스가 없다** — 목록이 `order by created_at desc` + `range()` 로
페이지네이션하는데 인덱스가 없었다. 20건 규모라 드러나지 않았을 뿐이다.

→ 우리 `icaros` 스키마는 이 결함을 이미 피했다. Community 로 갈 데이터라 이 DDL 자체는 재현하지 않는다.

## U2 — 관리자 목록 (해소)

`admins` 는 anon 키로 **에러가 아니라 빈 배열**을 반환해 확인이 불가능했다. Management API 로 해소.

| 이메일 | admin | 생성 | 최근 로그인 | 확인됨 |
|---|---|---|---|---|
| `<admin-1>` | ✅ | 2026-07-15 | 2026-07-27 | ✅ |
| `<admin-2>` | ✅ | 2026-07-21 | 2026-08-05 | ✅ |

`auth.users` 총 2명, 둘 다 `public.admins` 에 등록돼 있다. 비관리자 계정은 없다.

**비밀번호 해시는 가져오지 않았다** (H20 — bcrypt 를 Argon2id 스키마로 이전하지 않는다.
두 형식을 공존시키면 검증 분기가 생기고 그 분기가 곧 취약점이 된다).
→ 이 2명에게 `scripts/bootstrap-admin.ts` 로 새 계정을 발급한다.

## 이관 전 마지막 확인

- Supabase 프로젝트는 아직 `ACTIVE_HEALTHY` 다. **검증이 끝나기 전에 폐기하지 않는다.**
- Storage 52객체(86.67 MiB)는 public 버킷이라 anon 키로 다운로드 가능 — 별도 권한 불필요.
