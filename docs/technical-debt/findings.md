# ICAROS-web — 기술부채 findings

- 감사일: 2026-09-02 · 커밋 `eadb5ea` (main)
- 규모: 25,321 LOC · 라우트 12개 · **테스트 0** · **CI 0**
- Stack: Next.js 16.3.2 (SSR) · React 19 · Drizzle ORM · PostgreSQL(RDS, IAM 인증) · argon2 · S3 · three.js
- 배포: Vercel (Fluid Compute), Vercel Git 연동

## 총평 — 먼저 인정할 것

**이 저장소에는 이미 이 감사보다 정밀한 부채 대장이 있다.**
`docs/icaros-rebuild/15-infra-debt.md` 는 2026-08-27 커넥션 고갈 장애와 08-30 공유 RDS 40분
장애를 측정값(p50/p90/p99/최대, FATAL 건수, 알람 발화 여부)과 함께 기록하고,
남은 위험 16건을 소관·다음 액션·변경 시 위험까지 나눠 관리한다.
`src/lib/db/connection.ts:170-184` 는 "10초를 60초로 올렸다가 프로덕션을 죽였다"는 사후분석을
코드 주석으로 남겨 두었다.

따라서 이 문서는 **그 대장을 다시 쓰지 않는다.** 대장을 코드와 대조해 검증하고,
**대장이 다루지 않는 영역**만 추가한다.

### 대장 검증 결과

| 대장 항목 | 코드 대조 | 판정 |
|---|---|---|
| A4 공유 RDS blast radius 🔴 | `05-database-plan.md:25,61-64` 가 `public` 스키마를 ESSENTIA Flyway 단독 소유로 규정 | **정확** |
| A2 커넥션 총량 미보장 🟠 | `connection.ts:170` `max: 3` 은 인스턴스당. Fluid Compute 인스턴스 수는 통제 불가 | **정확** |
| B3 멤버 사진 공개 저장소 🔴 | `public/assets/img/member/` 에 실명 파일명 8건 여전히 tracked | **미해결 확인** |
| D1 테스트 프레임워크 부재 🟠 | `package.json` 에 vitest·jest·playwright 없음, `.test.*` 0건 | **정확** |
| A3 ICAROS 알림 수신 경로 없음 🔴 | 코드로는 확인 불가(AWS 측). 대장 기재를 신뢰 | — |

---

## 대장에 없는 findings

### P1-1. 스키마 권한 분리가 **설계돼 있으나 적용 여부를 저장소로 확인할 수 없다**

> **정정(2026-09-02)** — 이 감사는 처음에 "GRANT/REVOKE가 어디에도 없다"고 판단했으나
> **틀렸다.** `docs/icaros-rebuild/DECISIONS.md` 의 D17이 정확히 그 설계를 담고 있다.
> 아래는 정정된 내용이다.

**이미 설계돼 있는 것** (`docs/icaros-rebuild/DECISIONS.md` D17)

```sql
revoke all on schema public from icaros_app;
grant usage on schema icaros to icaros_app;
grant select, insert, update, delete on all tables in schema icaros to icaros_app;
alter default privileges in schema icaros grant ... to icaros_app;
```
> *"ICAROS 전용 role 을 만들고 **`public` 스키마에 대한 grant 를 하나도 주지 않는다**
> → 그 자격증명이 유출돼도 `forum_*`·`user`·`audit` 계열에 **닿지 않는다.** DDL 권한도 없다
> (마이그레이션은 별도 role 로, 배포 파이프라인에서만)."*

**게다가 그 설계에 대한 기술 검토(D17 보정)가 다섯 가지 구멍을 스스로 찾아냈다:**

| # | 발견 | 왜 중요한가 |
|---|---|---|
| ① | `ALTER DEFAULT PRIVILEGES` 누락 | `grant ... on all tables` 는 그 시점 테이블만 덮는다 → **배포마다 깨진다** |
| ② | 시퀀스 권한 누락 | serial/identity 컬럼이 있으면 **INSERT가 거부된다** |
| ③ | `PUBLIC` 상속을 못 지운다 | **"데이터 기준으로는 맞고 메타데이터 기준으로는 틀리다"** — `information_schema`·`pg_catalog` 스키마 열람은 막지 못한다 |
| ④ | 🔴 마스터 계정이 같이 인터넷에 열린다 | 최소권한은 `icaros_app` 유출만 막는다. 마스터가 뚫리면 감사로그·전자서명 전부 |
| ⑤ | Postgres에 로그인 시도 제한이 없다 | 공개된 5432는 무한 브루트포스 대상 |

**이 수준의 자기 검토는 이 감사가 더할 것이 없다.** ③의 자기 정정
("내 표현을 정정한다")은 특히 정확하다.

---

**그래서 실제로 남은 것은 하나다 — 적용 여부의 검증 경로**

`DECISIONS.md` 는 실행 주체를 명시한다:
> *"### 실행 순서 (전부 사용자·`essentia_infra` 영역)
> 1. RDS 퍼블릭 액세스 ON + `rds.force_ssl`
> 2. `icaros` 스키마 생성 + `icaros_app` role (위 grant)
> 3. 마이그레이션 전용 role 분리"*

즉 **이 저장소가 실행하지 않는다.** 그리고 저장소에는
"현재 `icaros_app` 이 실제로 어떤 권한을 갖고 있는가"를 확인하는 수단이 없다.

**왜 이것이 P1인가**
- 설계와 적용이 어긋나도 **아무 신호가 없다.** 앱은 정상 동작한다
  (권한이 더 넓어도 앱은 `icaros` 스키마만 쓰므로)
- D17 보정 ①이 지적한 `ALTER DEFAULT PRIVILEGES` 누락은
  **"다음 마이그레이션 후 배포가 깨진다"** 는 형태로 나타난다 — 원인에서 먼 증상이다
- 2026-08-30 장애가 ④와 정확히 맞물린다 — 마스터 비밀번호를 콘솔에서 바꾼 것이
  40분 정지의 원인이었다. **마스터 계정이 여전히 운영 경로에 있다**는 뜻이다

**조치 (30분, 코드 변경 0)**

권한 상태를 **읽어서 출력하는** 스크립트를 추가한다. 바꾸는 것이 아니라 확인하는 것이다:

```ts
// scripts/db/verify-grants.ts  — npm run db:verify 에 이어 붙인다
// 1) icaros_app 이 public 스키마에 가진 권한 (기대: 없음)
//    select * from information_schema.role_table_grants where grantee='icaros_app' and table_schema='public';
// 2) icaros 스키마의 default privileges (기대: 마이그레이션 role 기준으로 설정됨)
//    select * from pg_default_acl;
// 3) icaros_app 의 DDL 권한 (기대: 없음)
//    select has_schema_privilege('icaros_app','icaros','CREATE');
```

`scripts/db/verify.ts` 와 `inspect-public.ts` 가 이미 있으므로 **패턴이 마련돼 있다.**
CI(P1-2)에 붙이면 설계와 현실의 드리프트가 자동으로 잡힌다.

**검증** 스크립트 출력이 D17의 기대값과 일치하는지. 어긋나면 그 자체가 발견이다.


---

### P1-2. 커밋에서 프로덕션까지 자동 게이트가 하나도 없다

**근거**
- `.github/workflows/` **디렉터리 자체가 없다.**
- `package.json` 에 `typecheck`·`lint`·`smoke` 스크립트가 있으나 **자동 실행 지점이 없다.**
- Vercel Git 연동이 `next build` 만 돌린다. `next.config.ts:7` 의
  `typescript: { ignoreBuildErrors: false }` 덕분에 **타입 오류만** 배포를 막는다.
- ESLint는 배포를 막지 않는다. 테스트는 존재하지 않는다(D1).

대장의 D1은 "테스트 프레임워크가 없다"를 다루지만, **CI 파이프라인 자체의 부재**는
별도 문제다. 테스트를 붙여도 돌릴 곳이 없다.

**실패 시나리오**
`main` 에 푸시하면 Vercel이 곧바로 프로덕션에 배포한다. 타입이 맞기만 하면
런타임 오류·권한 회귀·마이그레이션 누락이 전부 통과한다.
D2("production smoke 가 수동 확인에 의존")가 지적하듯, 검증은 사람이 `npm run smoke` 를
**기억해서** 돌릴 때만 일어난다. 08-30 장애 때 그 사람이 없었다는 것이 대장에 기록돼 있다.

**권장 조치 (2시간)**
`.github/workflows/ci.yml` 하나를 만들어 PR과 main 푸시에서
`npm run typecheck && npm run lint` 를 돌린다. 그다음 배포 후 `npm run smoke` 를
GitHub Actions에서 실행해 D2를 자동화한다 — **스크립트는 이미 있다. 트리거만 없다.**

---

### P1-3. 운영 DB 마이그레이션이 개발자 노트북에서 수동 실행된다

**위치** `scripts/db/migrate.ts:24-33` (`loadEnvLocal()` 이 `.env.local` 을 읽는다),
`package.json` `"db:migrate": "tsx scripts/db/migrate.ts"`, `"db:tunnel"` (SSM 포트포워딩)

마이그레이션 러너 자체는 잘 만들어져 있다 — `drizzle-kit migrate` 가 실패를 삼키는 것을
발견하고 직접 구현했으며, 파일당 단일 트랜잭션 · `--dry` 모드 · 해시 원장을 갖췄다.

문제는 **실행 위치**다. 운영 DB에 대한 스키마 변경이
(a) 개발자 로컬에서, (b) `.env.local` 의 자격증명으로, (c) SSM 터널을 통해,
(d) 아무 승인·기록 없이 일어난다.

결과:
- 누가 언제 무엇을 적용했는지 **git 밖에서는 알 수 없다** (원장 테이블에 해시는 남지만 주체는 없다)
- 운영 DB 접근 권한이 개발 머신에 상주한다
- 마이그레이션이 코드 배포와 **원자적으로 묶이지 않는다** — 코드가 먼저 나가면 스키마 불일치

**권장 조치** P1-2의 CI에 배포 후 마이그레이션 단계를 추가하고, 로컬 실행은 `--dry` 로만 쓴다.

---

## P2

### P2-1. 죽은 Vite 설정이 저장소 루트에 tracked 되어 있다

`vite.config.js` 가 `@vitejs/plugin-react` 와 `react-router-dom` 을 참조한다.
**둘 다 `package.json` 에 없다.** Next.js 이전 시대의 잔재이며 `git ls-files` 에 잡힌다.

`npm run dev` 는 `next dev --port 5174` 인데 이 파일도 `port: 5174` 를 선언해
읽는 사람이 어느 쪽이 도는지 혼동한다. 삭제할 것.

### P2-2. 25,000줄에 테스트가 0이고, 가장 위험한 계층이 노출돼 있다

대장 D1이 이미 잡고 있으나 **어디부터 덮어야 하는지**는 없다. 우선순위를 붙인다:

1. `src/lib/auth/` (1,162줄) — `guard.ts` 의 Origin 허용 판정, `session.ts` 의 쿠키 발급,
   `ratelimit.ts` 의 단계별 잠금. **순수 함수가 많아 테스트 비용이 가장 싸고 위험은 가장 크다.**
2. `src/lib/s3/cleanup.ts` — 고아 파일 정리. 잘못 돌면 **살아 있는 파일을 지운다.**
3. `src/lib/db/connection.ts:112-190` — `buildPoolConfig()`. 08-27 장애의 진원지이며,
   지금은 아무 회귀 방어가 없다. 값이 다시 바뀌면 같은 장애가 재현된다.

`buildPoolConfig()` 는 환경변수만 받아 객체를 반환하는 순수 함수다 —
`max === 3`, `idleTimeoutMillis === 10_000` 을 고정하는 테스트 5줄이면
**장애의 재발 경로가 코드로 봉인된다.** 이것이 가장 비용 대비 효과가 큰 한 걸음이다.

### P2-3. 멤버 실명 사진이 저장소 이력에 영구히 남는다 (대장 B3 보강)

`public/assets/img/member/` 의 8개 파일은 파일명이 **실명 로마자 표기**다
(`kimjihoo.webp`, `parkhyunbin.webp`, `standhyo.webp` 등).

대장은 이를 🔴로 기록했으나 조치 방법이 §3에 미뤄져 있다. 실무적으로 중요한 점은
**HEAD에서 지워도 해결되지 않는다**는 것이다 — git 이력에 blob이 남고,
저장소가 공개라면 이미 클론·포크·GitHub 캐시로 퍼졌을 수 있다.

**권장 조치 순서**
1. 저장소를 즉시 private으로 전환한다(공개라면). 되돌릴 수 없는 확산을 멈추는 것이 먼저다.
2. 이미지를 S3(이미 쓰고 있다)로 옮기고 코드가 URL을 참조하게 바꾼다.
3. 이력 제거(`git filter-repo`)는 강제 푸시를 동반하므로 1·2 뒤에 별도로 판단한다.
4. 당사자 동의 여부를 확인한다 — 개인정보보호법상 사진은 개인정보다.

---

## P3

- `src/lib/db/schema/panels.ts:55` `inList()` 가 `sql.raw` 로 문자열을 직접 조립하지만,
  호출 인자가 전부 `as const` 컴파일 타임 리터럴(`PANEL_SCRIMS` 등)이고 CHECK 제약 생성 시점에만
  쓰인다 — **SQL 인젝션 아님(확인함).** 다만 이 헬퍼가 런타임 값을 받도록 재사용되면
  즉시 취약해지므로, 시그니처에 리터럴 타입 제약을 걸어 두는 편이 안전하다.
- `src/lib/s3/cleanup.ts:227` · `src/lib/auth/ratelimit.ts:72` · `src/lib/posts/feed.ts:112` 의
  `sql.raw` 도 전부 숫자 상수 래핑이다 — **인젝션 아님(확인함).**
  `_sql.ts:8` 이 그 이유(`make_interval(secs => $1)` 바인딩 불가)를 문서화해 두었다.
- `@node-rs/argon2`, Origin 허용목록 CSRF, `httpOnly`+`secure`+`sameSite:lax` 쿠키,
  IAM DB 인증 + `verify-full` TLS — 인증·저장 계층은 감사 대상 저장소 중 가장 견고하다.
  개선할 것이 없다.
