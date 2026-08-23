# 06 — Auth & Security Plan

> ICAROS `/admin` 전용 자체 인증. 외부 Auth SaaS 미사용.
> 검증 기준: `02-requirements-matrix.md` H1–H22.
> 의존: `04-architecture.md`(패키지·런타임), `essentia_infra`(테이블 네이밍 컨벤션·DB role) — **테이블 이름은 잠정**.

---

## 0. 위협 모델 — 무엇을 막는가

ICAROS `/admin`은 **공개 회원가입이 없는 소수 관리자 콘솔**이다. 인터넷에 노출된 로그인 폼이 하나 있고, 그 뒤에 팀 전체의 공개 콘텐츠와 S3 쓰기 권한이 있다.

| 위협 | 대응 |
|---|---|
| 자격증명 스터핑 / 무차별 대입 | rate limit + 실패 backoff + 계정 열거 방지 |
| DB 유출 시 비밀번호 복원 | Argon2id (OWASP 파라미터) |
| DB 유출 시 세션 탈취 | 토큰 **해시**만 저장 |
| XSS로 세션 탈취 | `HttpOnly` |
| 네트워크 도청 | `Secure` + HSTS |
| CSRF (타 사이트에서 관리자 브라우저로 mutation 유발) | `SameSite` + Origin 검증 + Server Actions 내장 방어 |
| 계정 열거 | 응답·타이밍 동일화 |
| 퇴사·권한 회수 후 잔존 세션 | server-side revoke + 비활성화 플래그 |

**막지 않는 것(명시):** 관리자 단말 자체의 침해, 물리 접근, 소셜 엔지니어링. 2FA는 이번 범위 밖 — `icaros_admin_users`에 확장 여지만 남긴다.

---

## 1. 스키마 (잠정 — 네이밍 컨벤션 확정 대기 ⛔)

**갱신(2026-08-23)**: `essentia_infra` 회신에 따라 `public.icaros_*` 접두사 방식이 아니라 **별도 `icaros` 스키마**로 간다.
ESSENTIA는 `ddl-auto: validate`로 기동하므로 `public`에 낯선 테이블이 생기면 **ESSENTIA API가 기동 실패**할 수 있다.
Drizzle 설정은 `schemaFilter: ['icaros']` + `search_path=icaros` 고정. 아래 테이블은 전부 `icaros` 스키마 소속이다.

### `icaros_admin_users`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `email` | `citext unique not null` | **정규화 후 저장** (§3) |
| `password_hash` | `text not null` | Argon2id PHC 문자열 (`$argon2id$v=19$m=19456,t=2,p=1$...`) |
| `display_name` | `text` | |
| `is_active` | `boolean not null default true` | **비활성화 = 즉시 로그인·세션 차단** |
| `password_changed_at` | `timestamptz not null default now()` | 세션 일괄 폐기 기준 |
| `last_login_at` | `timestamptz` | |
| `created_at` / `updated_at` | `timestamptz not null default now()` | |

`citext` 미가용 시 `text` + `lower()` 유니크 인덱스로 대체.

### `icaros_admin_sessions`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | 쿠키에 **들어가지 않음** |
| `user_id` | `uuid not null references icaros_admin_users(id) on delete cascade` | |
| `token_hash` | `bytea not null unique` | SHA-256(raw token). **원문 저장 금지** |
| `created_at` | `timestamptz not null default now()` | |
| `expires_at` | `timestamptz not null` | 절대 만료 |
| `last_seen_at` | `timestamptz not null default now()` | 유휴 만료 판정 |
| `revoked_at` | `timestamptz` | logout / 비번 변경 / 강제 폐기 |
| `ip` | `inet` · `user_agent` `text` | 감사용. 세션 유효성 판정에는 **쓰지 않음**(모바일 IP 변동) |

인덱스: `(token_hash)` unique, `(user_id, revoked_at)`, `(expires_at)` (정리 작업용).

### `icaros_auth_events`
| 컬럼 | 타입 |
|---|---|
| `id` `bigserial pk` · `at timestamptz default now()` | |
| `kind` `text not null` | `login_success` · `login_fail` · `logout` · `session_expired` · `password_changed` · `admin_deactivated` · `rate_limited` · `bootstrap` |
| `email_attempted` `citext` | 존재하지 않는 계정도 기록 |
| `user_id` `uuid` (nullable, FK 아님) | 계정 삭제 후에도 로그 보존 |
| `ip` `inet` · `user_agent` `text` · `detail` `jsonb` | |

**비밀번호·토큰·해시를 이 테이블에 절대 넣지 않는다.**

### `icaros_login_attempts` (rate limit 상태)
서버리스라 in-memory 카운터를 신뢰할 수 없다. Fluid Compute가 인스턴스를 재사용하더라도 보장이 아니므로 **DB 기반**으로 간다.

| 컬럼 | 타입 |
|---|---|
| `key` `text pk` | `ip:1.2.3.4` 또는 `email:a@b.c` |
| `fail_count` `int not null default 0` | |
| `first_fail_at` / `last_fail_at` `timestamptz` | |
| `locked_until` `timestamptz` | |

---

## 2. 비밀번호 해싱

**`@node-rs/argon2@2.1.0`** — NAPI-RS prebuilt(node-gyp 없음)이고 Next.js 16의 내장 `serverExternalPackages` 자동 목록에 이미 포함되어 있어 Vercel 네이티브 바인딩 설정이 불필요하다.

```ts
import { hash, verify, Algorithm, Version } from '@node-rs/argon2'

// OWASP 기준선. 라이브러리 기본값과 동일하지만 명시적으로 전달한다.
export const ARGON2 = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,   // v=19
  memoryCost: 19456,        // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const
```

- salt는 라이브러리가 CSPRNG로 생성하고 PHC 문자열에 포함한다. **직접 만들지 않는다.**
- 검증은 `verify(storedPhc, password, ARGON2)`. PHC에 파라미터가 박혀 있어 나중에 비용을 올려도 기존 해시가 검증된다.
- **파라미터 상향 시 재해싱**: 로그인 성공 직후 저장된 PHC의 m/t/p가 현재 기준보다 낮으면 그 자리에서 재해싱 후 갱신.

**기각한 대안**: `argon2`(node-gyp 컴파일, 동일 파라미터에서 더 느림) · `hash-wasm`(~2.6× 느림, 비상용으로만 보관) · `node:crypto.argon2`(Node 24.7+에 있으나 **Stability 1 Experimental**이고 PHC 문자열이 없는 raw KDF라 salt·인코딩을 직접 다뤄야 함 — H4의 "자체 암호 구현 금지" 취지에 어긋남).

---

## 3. 이메일 정규화 (H3)

```
trim → NFKC 정규화 → lowercase
```
- 도메인 부분만이 아니라 **전체를 lowercase** 한다(로컬파트 대소문자 구분은 이론상 유효하지만 실무에서 혼란만 만든다).
- gmail 의 `.` 제거나 `+태그` 제거는 **하지 않는다** — 관리자 수가 소수이고, 정규화 규칙이 공급자별로 갈리면 계정을 잃는다.
- 저장 시와 조회 시 **같은 함수**를 통과시킨다. 이 함수는 한 곳(`lib/auth/email.ts`)에만 존재한다.

---

## 4. 세션

### 토큰
```ts
const raw = base64url(crypto.randomBytes(32))          // 256-bit
const tokenHash = crypto.createHash('sha256').update(raw).digest()
```
- 쿠키에는 `raw`, DB에는 `tokenHash`만. **DB가 유출돼도 세션을 만들 수 없다.**
- SHA-256으로 충분하다 — 입력이 이미 256비트 고엔트로피라 사전 공격 대상이 아니다. (비밀번호와 달리 느린 KDF가 필요 없다.)
- 조회는 `where token_hash = $1` 단일 인덱스 히트. 비교 자체가 DB 인덱스라 타이밍 사이드채널이 실질적 위협이 아니지만, 애플리케이션 레벨 비교가 생기면 `crypto.timingSafeEqual`을 쓴다 (H17).

### 쿠키
```
__Host-icaros_session = <raw>
  HttpOnly
  Secure
  SameSite=Lax
  Path=/
  (Domain 미지정 — __Host- 접두사 요구사항)
  Max-Age = 세션 절대 만료까지
```

**`SameSite=Lax`를 고른 이유**: `Strict`가 더 강해 보이지만, 실제 CSRF 방어력 차이는 "외부 링크로 `/admin`에 처음 진입할 때 쿠키가 안 실려 로그인 화면이 한 번 뜬다"는 UX 비용만큼도 되지 않는다. `Lax`는 이미 **모든 cross-site POST를 차단**한다. 그리고 우리는 여기에만 의존하지 않는다 — §5의 Origin 검증이 2차 방어선이다.

**`__Host-` 접두사**를 쓰는 이유: 서브도메인이 이 쿠키를 덮어쓸 수 없게 못박는다. `icaros.kr`과 `sim.icaros.kr`이 같은 등록 도메인이므로 실제 의미가 있다.

### 수명
| 값 | 설정 |
|---|---|
| 절대 만료 | **7일** — 갱신 없이 무조건 폐기 |
| 유휴 만료 | **8시간** — `last_seen_at` 기준 |
| `last_seen_at` 갱신 | 5분 이상 경과 시에만 write (매 요청 write 금지) |

### 폐기 (H10·H15·H16)
`revoked_at`을 채우는 경로:
1. **logout** — 해당 세션 1건
2. **비밀번호 변경** — 그 사용자의 **모든** 세션. 현재 세션도 포함하고, 직후 새 세션을 발급한다
3. **`is_active = false`** — 그 사용자의 모든 세션
4. 관리자 수동 강제 폐기

검증 쿼리는 **한 번에** 판정한다:
```sql
select u.id, u.email
from icaros_admin_sessions s
join icaros_admin_users u on u.id = s.user_id
where s.token_hash = $1
  and s.revoked_at is null
  and s.expires_at   > now()
  and s.last_seen_at > now() - interval '8 hours'
  and u.is_active
  and s.created_at  >= u.password_changed_at   -- 비번 변경 이전 세션 자동 무효
```
마지막 조건이 안전망이다. `revoked_at` 일괄 UPDATE가 실패해도 비번 변경 이전 세션은 구조적으로 통과하지 못한다.

### 만료 세션 정리
Vercel Cron(일 1회) → `delete from icaros_admin_sessions where expires_at < now() - interval '30 days'`.
감사 흔적은 `icaros_auth_events`에 남으므로 세션 행 자체는 지워도 된다.

---

## 5. CSRF · Origin (H12)

3중으로 간다.

1. **`SameSite=Lax`** — cross-site POST 차단 (위)
2. **Next.js Server Actions 내장 방어** — Origin/Host 대조. `serverActions.allowedOrigins`에 프로덕션 도메인을 명시한다.
   ⚠ 이 설정은 16.3.2에서도 여전히 `experimental` 아래에 문서화되어 있다(Server Actions 자체는 14부터 stable). 설정 키 위치가 바뀔 수 있으니 업그레이드 시 확인 대상.
3. **명시적 Origin 검증** — 모든 mutation의 공통 진입점에서 직접 확인. 내장 방어를 신뢰하되 검증한다.

```ts
// 모든 mutation이 통과하는 단일 게이트
async function requireAdmin() {
  const h = await headers()
  const origin = h.get('origin')
  // GET이 아닌 요청에 Origin이 없으면 거부 (구형 브라우저 예외를 두지 않는다)
  if (!origin || !ALLOWED_ORIGINS.has(origin)) throw new AuthError('bad_origin')

  const session = await resolveSession()      // §4 쿼리
  if (!session) throw new AuthError('unauthenticated')
  return session
}
```

**Route Handler를 쓰는 경우**(presigned URL 발급 등)에도 같은 게이트를 통과시킨다. Server Actions의 내장 보호는 Route Handler에 적용되지 않는다.

`ALLOWED_ORIGINS` 의 실제 출처는 **`ADMIN_ALLOWED_ORIGINS` 환경변수 하나**다 (형식은 `.env.example`).

- 설정돼 있으면 **그 목록만** 쓴다.
- 미설정일 때만 `x-forwarded-host` + `x-forwarded-proto` 로 조립한 self-origin 으로 폴백하고, 서버 로그에 경고를 한 번 남긴다.
- 값을 넣었는데 하나도 파싱되지 않으면 빈 집합 → 모든 mutation 거부(fail-closed).

**두 출처를 합집합으로 쓰면 안 된다.** 그렇게 하면 이 층의 의미가 "Origin === 요청이 스스로 주장한 Host" 로 축소되고, `Origin: https://evil.com` + `x-forwarded-host: evil.com` 이 통과한다. 남는 안전은 코드가 아니라 "앞단 프록시가 그 헤더를 덮어쓴다"는 배포 토폴로지에 있게 된다.

---

## 6. Rate limit · 계정 열거 방지 (H13)

### 이중 키
- `ip:<addr>` — 한 IP의 분산 시도 차단
- `email:<normalized>` — 한 계정에 대한 분산 IP 공격 차단

둘 중 **하나라도** 잠기면 거부한다.

### backoff
| 연속 실패 | 잠금 |
|---|---|
| 1–4 | 없음 |
| 5 | 1분 |
| 6 | 5분 |
| 7 | 15분 |
| 8+ | 60분 (상한) |

성공 시 해당 키의 카운터를 리셋한다. `first_fail_at`이 24시간 이상 지났으면 카운터를 0부터 다시 센다.

### 계정 열거 방지 (H3 연장)
- 존재하지 않는 이메일과 틀린 비밀번호의 **응답 본문·상태코드·헤더가 동일**해야 한다 → 항상 `이메일 또는 비밀번호가 올바르지 않습니다.`
- **타이밍도 동일해야 한다.** 사용자가 없으면 Argon2 검증을 건너뛰게 되고, 그 20~50ms 차이가 계정 존재 여부를 알려준다.
  → 사용자 미존재 시 **더미 PHC 해시에 대해 실제 `verify()`를 수행**한 뒤 실패를 반환한다.
  더미 해시는 부팅 시 1회 생성해 모듈 상수로 보관한다.
- 잠금 상태도 동일 메시지로 감춘다. 잠금 사실을 알리면 그 자체가 "이 계정은 존재한다"는 신호다.

---

## 7. 런타임 · 경계 (H18·H21)

```ts
// 인증이 닿는 모든 Route Handler / Server Action 파일
export const runtime = 'nodejs'
```
`@node-rs/argon2`는 네이티브 바인딩이라 Edge에서 동작하지 않는다. Next 16의 기본이 Node이지만 **명시한다** — 나중에 누가 Edge로 바꾸면 빌드가 아니라 런타임에 깨진다.

```ts
// lib/auth/*.ts, lib/db/*.ts, lib/s3/*.ts 최상단
import 'server-only'
```
클라이언트에서 import되는 순간 **빌드가 실패**한다. 런타임 사고 대신 빌드 사고로 만든다.

### 검증 (Gate 6)
```bash
# 클라이언트 번들에 비밀값·서버 모듈이 새지 않았는지
grep -rE 'DATABASE_URL|AWS_SECRET|argon2|password_hash' .next/static/ && echo "LEAK" || echo "clean"
```

---

## 8. 초기 관리자 bootstrap (H19)

`scripts/bootstrap-admin.ts` — 일회성 CLI.

```
$ pnpm tsx scripts/bootstrap-admin.ts --email admin@icaros.kr
비밀번호를 입력하세요 (화면에 표시되지 않습니다):
```

규칙:
- 비밀번호는 **stdin 프롬프트로만** 받는다. `--password` 플래그를 제공하지 않는다 → 셸 히스토리·프로세스 목록에 남지 않는다.
- 또는 `--generate`로 CSPRNG 비밀번호를 만들어 **stdout에 1회만** 출력한다(로그 파일로 리다이렉트하지 말 것을 경고).
- 최소 길이 12자 검사. 그 외 복잡도 규칙은 두지 않는다(NIST 800-63B 권고).
- 대상 DB URL을 출력해 확인을 받는다. **Production DB에 대한 실행은 사용자 승인 사항.**
- 실행 결과를 `icaros_auth_events(kind='bootstrap')`에 기록한다.

금지: 기본 비밀번호, 코드 내 이메일·비밀번호 하드코딩, 초기 비밀번호 커밋, Production 관리자 자동 생성.

---

## 9. 기존 Supabase 관리자 이관 (H20)

**비밀번호 해시와 세션 토큰은 이전하지 않는다.**

- Supabase GoTrue의 해시는 bcrypt이고, 우리 스키마는 Argon2id PHC를 전제한다. 두 형식을 공존시키면 검증 분기가 생기고 그 분기가 곧 취약점이다.
- 절차:
  1. Supabase 폐기 **전에** `service_role`로 `public.admins` + `auth.users`에서 **이메일 목록만** 덤프 (→ `02` J11, 현재 ⛔)
  2. 각 관리자에게 새 계정을 bootstrap CLI로 발급
  3. 첫 로그인 후 본인이 비밀번호를 변경 (강제 아님 — 관리자 소수이므로 운영 부담만 늘린다)
  4. Supabase 프로젝트 폐기
- **덤프 없이 진행하면 "이전은 성공했는데 아무도 로그인 못 하고 가리킬 에러도 없는" 상태가 된다.** anon 키로는 `admins`가 에러가 아니라 빈 배열을 반환하기 때문이다.

---

## 10. 감사 로그에 남기는 것 / 남기지 않는 것 (H5·H14)

| 남긴다 | 남기지 않는다 |
|---|---|
| 시도된 이메일(정규화 후) | 비밀번호 (평문·해시 불문) |
| 성공/실패/잠금/로그아웃 | 세션 토큰 원문·해시 |
| IP · User-Agent | 쿠키 전체 |
| 비번 변경·비활성화 시각 | DB 연결 문자열 |

애플리케이션 로그(stdout → Vercel)에도 동일 규칙을 적용한다. 에러 객체를 통째로 `console.error` 하는 코드가 자격증명을 흘리는 가장 흔한 경로다 — mutation 게이트에서 에러를 정규화한 뒤 로깅한다.

### ⚠ `kind` 오버로딩 — 집계 전에 반드시 읽을 것

`auth_events_kind_ck` 는 8개 값으로 고정돼 있고 스키마를 늘리려면 마이그레이션이 먼저다. 그래서 **두 종류의 이벤트가 의미가 다른 `kind` 를 빌려 쓰고 있다.** `kind` 만으로 집계하면 서로 다른 사건이 한 통계에 섞인다.

| 실제 사건 | 기록되는 `kind` | 구분 조건 | 발행 위치 |
|---|---|---|---|
| 비밀번호 변경 시 **재인증 실패** (이미 인증된 세션 안) | `login_fail` | `detail->>'reason' = 'password_change_reauth'` | `src/lib/auth/account.ts` `changePassword()` |
| 관리자 **재활성화** | `admin_deactivated` | `detail->>'action' = 'reactivated'` | `src/lib/auth/account.ts` `setAdminActive(true)` · `scripts/bootstrap-admin.ts --reactivate` |
| 관리자 **비활성화** (본래 의미) | `admin_deactivated` | `detail->>'action' = 'deactivated'` | `src/lib/auth/account.ts` `setAdminActive(false)` |
| CLI 비밀번호 **재설정** | `password_changed` | `detail->>'source' = 'scripts/bootstrap-admin.ts'` | `scripts/bootstrap-admin.ts --reset-password` |

집계 시 규칙:

```sql
-- 미인증 로그인 실패만 (침해 조사·brute force 탐지)
select count(*) from icaros.auth_events
where kind = 'login_fail'
  and coalesce(detail->>'reason', '') <> 'password_change_reauth';

-- 권한 회수만 (재활성화 제외)
select * from icaros.auth_events
where kind = 'admin_deactivated'
  and detail->>'action' = 'deactivated';
```

`detail.action` 이 없는 과거 행은 전부 비활성화다 — 재활성화 기록이 존재하지 않던 시기의 데이터다.

`kind` 를 늘리는 마이그레이션(`password_reauth_fail` · `admin_reactivated`)을 넣게 되면 이 절과 두 발행 위치의 주석을 함께 지운다.

### `session_expired` 발행 규칙

만료·유휴로 세션 판정에서 떨어질 때 `src/lib/auth/session.ts` `expireSession()` 이 발행한다. **세션당 정확히 1회**다 — 폐기(`revoked_at = now()`)와 같은 UPDATE 에 묶여 있고 그 UPDATE 가 `revoked_at is null` 을 조건으로 두기 때문에, 만료된 쿠키를 든 브라우저가 계속 요청해도 두 번째부터는 갱신 행이 0이라 로그가 쌓이지 않는다. 존재하지 않는 토큰은 매칭되지 않으므로 무작위 대입으로 이 테이블을 부풀릴 수 없다.

`detail.reason` 은 `absolute`(7일 절대 만료) 또는 `idle`(8시간 유휴). `is_active=false` · 비밀번호 변경으로 떨어진 세션은 여기 걸리지 않는다 — 각각 `admin_deactivated` · `password_changed` 가 이미 남는다.

---

## 11. 미해결 · 블로커

| # | 항목 | 대기 |
|---|---|---|
| 1 | ~~테이블 접두사·스키마 컨벤션~~ → **해소**: 전용 `icaros` 스키마 권장 (사용자 승인 대기) | ✅ 회신 수신 |
| 2 | ICAROS 전용 최소권한 Neon role — **ESSENTIA 객체에 대한 DROP 없음**이 4중 방어의 마지막 층 | `essentia_infra` Q7 |
| 3 | `citext` 확장 사용 가능 여부 — 미회신. 불가 시 `text` + `lower()` 유니크 인덱스로 대체(설계에 반영됨) | Neon 콘솔 |
| 4 | Vercel이 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`를 자동 설정하는지 — 미확인. 다중 인스턴스에서 Server Action 암호화 키 불일치 가능성 | 검증 필요 |
| 5 | `serverActions.allowedOrigins`의 최종 설정 키 위치(여전히 `experimental` 아래) | Next 업그레이드 시 재확인 |
| 6 | 2FA — 이번 범위 밖. 스키마 확장 여지만 확보 | 사용자 판단 |

## 12. Reviewer 체크리스트 (H22 — 구현자와 분리된 에이전트가 수행)

- [ ] 비밀번호가 평문으로 존재하는 경로가 있는가 (변수·로그·에러·DB)
- [ ] 세션 토큰 원문이 DB·로그에 저장되는 경로가 있는가
- [ ] 모든 mutation이 `requireAdmin()`을 통과하는가 — **예외 1건도 없이**
- [ ] Route Handler가 Server Actions 내장 CSRF 방어를 잘못 신뢰하고 있지 않은가
- [ ] 사용자 미존재 경로에서 더미 verify가 실제로 실행되는가 (타이밍 측정)
- [ ] `is_active=false` 직후 기존 세션이 즉시 거부되는가
- [ ] 비번 변경 후 다른 브라우저 세션이 즉시 거부되는가
- [ ] `runtime = 'nodejs'`가 인증 경로 전체에 선언되어 있는가
- [ ] `.next/static/` 번들에 비밀값·서버 모듈이 없는가
- [ ] rate limit이 IP·email 양쪽 키로 동작하는가
- [ ] 잠금 상태가 별도 메시지로 노출되지 않는가
