# ICAROS-web — 보안

커밋 `eadb5ea` · 2026-09-02

## 요약

**인증·저장 계층은 감사 대상 12개 저장소 중 가장 견고하다.**
아래 "강점"에 나열한 것들은 개선 대상이 아니라 **다른 저장소로 옮길 자산**이다.

| 영역 | 상태 |
|---|---|
| 비밀번호 해시 | `@node-rs/argon2` |
| CSRF | Origin 허용목록 (self-origin 폴백을 **의도적으로 제거**) |
| 세션 쿠키 | `httpOnly` + `secure` + `sameSite: lax` |
| DB 인증 | IAM 토큰 + `verify-full` TLS + CA 번들 필수 |
| cron 인증 | fail-closed + 상수시간 비교 |
| SQL 인젝션 | 없음 (확인함 — 아래 false positive 절) |
| **DB 권한 격리** | **없음 → P1** |

---

## 강점

### Origin 기반 CSRF (`src/lib/auth/guard.ts:85-95`)

주석이 중요한 판단을 기록하고 있다:
> *"예전에는 여기에 self-origin(`x-forwarded-host`+`x-forwarded-proto` 로 조립)을
> 항상 합집합으로 더했는데, 그러면 검증의 의미가
> **'Origin === 요청이 스스로 주장한 Host'** 로 축소된다."*

self-origin 폴백은 흔한 구현이고 **검증을 무의미하게 만든다.**
그것을 발견해 제거한 것이 이 코드의 핵심이다.

### DB 접속 (`src/lib/db/connection.ts:152-160`)
```ts
const ca = loadCaBundle()
if (!ca) {
  // 여기서 조용히 `rejectUnauthorized: false` 로 떨어지면 안 된다.
  // 인터넷 경유 접속에서 CA 검증을 끄는 것은 암호화만 하고 신원 확인을 포기하는 것이다.
  throw new Error('IAM 모드에는 RDS CA 번들이 필요합니다. ...')
}
```
**fail-closed.** 그리고 터널 사용 시 "접속 주소만 터널로 돌리고 신원은 실제 엔드포인트로
유지한다"는 처리(`:145-150`)가 정확하다 — IAM 토큰 서명에 호스트명이 들어가고
인증서 CN/SAN이 RDS 엔드포인트이기 때문이다. 둘을 같이 바꾸면 조용히 두 군데가 깨진다.

### cron 엔드포인트 (`src/app/api/cron/storage/route.ts:23-29`)
```ts
const secret = process.env.CRON_SECRET
if (!secret) return false          // fail-closed
const expected = Buffer.from(`Bearer ${secret}`)
const actual = Buffer.from(header ?? '')
return actual.length === expected.length && timingSafeEqual(actual, expected)
```
`CRON_SECRET` 미설정 시 **전부 거부**한다. 상수시간 비교.
주석이 왜 관리자 세션이 아니라 공유 비밀인지도 설명한다(cron은 Origin이 없다).

---

## P1-1. 스키마 권한 분리가 설계돼 있으나 적용 여부를 확인할 수 없다

> **정정** — 이 감사는 처음에 "GRANT/REVOKE가 없다"고 판단했으나 **틀렸다.**
> `docs/icaros-rebuild/DECISIONS.md` D17이 정확한 설계를 담고 있다.

**설계는 정확하다.** `icaros_app` role에 `public` 스키마 grant를 하나도 주지 않고,
DDL은 별도 마이그레이션 role로 분리하며, `alter default privileges` 까지 포함한다.
그리고 그 설계에 대한 기술 검토(D17 보정)가 **다섯 가지 구멍을 스스로 찾아냈다** —
`ALTER DEFAULT PRIVILEGES` 누락, 시퀀스 권한, `PUBLIC` 상속,
**마스터 계정이 함께 인터넷에 열린다는 점**, Postgres 로그인 시도 제한 부재.

특히 ③의 자기 정정이 정확하다:
> *"**내 표현을 정정한다** — '`forum_*`·`audit` 계열에 닿지 않는다'는
> **데이터 기준으로는 맞고 메타데이터 기준으로는 틀리다.**
> `information_schema`·`pg_catalog` 를 통한 스키마 구조 열람은 막지 못한다"*

**남은 것은 검증 경로 하나다.**

`DECISIONS.md` 는 실행 주체를 "전부 사용자·`essentia_infra` 영역"으로 명시한다 —
**이 저장소가 실행하지 않는다.** 그리고 "현재 `icaros_app` 이 실제로 어떤 권한을 갖는가"를
확인하는 수단이 저장소에 없다.

설계와 적용이 어긋나도 **아무 신호가 없다.** 권한이 더 넓어도 앱은 정상 동작한다
(앱은 `icaros` 스키마만 쓰므로). D17 보정 ①이 지적한 default privileges 누락은
"다음 마이그레이션 후 배포가 깨진다"는 **원인에서 먼 증상**으로 나타난다.

**조치 (30분, 권한 변경 없음)** 권한 상태를 **읽어서 출력하는** 스크립트를 추가한다:
`information_schema.role_table_grants` · `pg_default_acl` ·
`has_schema_privilege('icaros_app','icaros','CREATE')`.
`scripts/db/verify.ts` 와 `inspect-public.ts` 가 이미 있어 패턴이 마련돼 있다.
CI(P1-2)에 붙이면 설계와 현실의 드리프트가 자동으로 잡힌다.

**2026-08-30 장애와의 연결** D17 보정 ④가 "마스터 계정이 같이 인터넷에 열린다"를
🔴로 지적했는데, 그 뒤 실제 40분 장애의 원인이 **마스터 비밀번호 콘솔 변경**이었다.
마스터 계정이 여전히 운영 경로에 있다는 뜻이며, ④의 후속 조치
("ESSENTIA 앱도 마스터 대신 전용 제한 role 을 쓰게 하고 마스터는 운영자만 보관")가
아직 열려 있는 것으로 보인다. **ESSENTIA 측과 함께 확인할 것.**

---

## P2 — 멤버 실명 사진 (대장 B3 보강)

`public/assets/img/member/` 의 8개 파일이 **실명 로마자 표기**를 파일명으로 쓴다
(`kimjihoo.webp` `parkhyunbin.webp` `standhyo.webp` `yunho.jpg` 등).

대장이 🔴로 기록했으나 조치 방법이 §3으로 미뤄져 있다. 실무적으로 중요한 점:

**HEAD에서 지워도 해결되지 않는다.** git 이력에 blob이 남고,
저장소가 공개라면 이미 클론·포크·GitHub 캐시로 퍼졌을 수 있다.

**조치 순서 (이 순서가 중요하다)**
1. **저장소를 private으로 전환** (공개라면). 되돌릴 수 없는 확산을 멈추는 것이 먼저다
2. 이미지를 S3(이미 쓰고 있다)로 옮기고 코드가 URL을 참조하게 한다
3. 이력 제거(`git filter-repo`)는 강제 푸시를 동반하므로 1·2 뒤에 별도 판단
4. **당사자 동의 여부를 확인한다** — 개인정보보호법상 사진은 개인정보다

---

## 확인했으나 문제가 아닌 것 (false positive 제거)

### `sql.raw` 6건 — 전부 안전

| 위치 | 내용 | 판정 |
|---|---|---|
| `src/lib/db/schema/panels.ts:55` | `inList()` 가 문자열을 직접 조립 | **안전** — 호출 인자가 전부 `as const` 리터럴 튜플(`PANEL_SCRIMS` 등)이고 CHECK 제약 생성 시점에만 쓰인다 |
| `src/lib/s3/cleanup.ts:227` | `sql.raw(String(MAX_ATTEMPTS))` | 숫자 상수 |
| `src/lib/auth/ratelimit.ts:72` | `sql.raw(String(step.atLeast))` | 숫자 상수 |
| `src/lib/auth/_sql.ts:13` | `make_interval(secs => ...)` | 숫자 상수. `:8` 주석이 바인딩 불가 이유를 설명 |
| `src/lib/posts/feed.ts:112` | `sql.raw(String(LEGACY_HEAD_CHARS))` | 숫자 상수 |

**다만** `inList()` 가 런타임 값을 받도록 재사용되면 즉시 취약해진다.
시그니처에 리터럴 타입 제약을 걸어 두는 편이 안전하다.

### `next.config.ts:7` — `typescript: { ignoreBuildErrors: false }`
타입 오류가 배포를 막는다. **유일하게 동작하는 자동 게이트다**(P1-2 참조).

### `sg-rollback-*.json`
`.gitignore:38` 에 있어 tracked되지 않는다. AWS SG 규칙 ID가 들어 있으나 로컬에만 남는다.
