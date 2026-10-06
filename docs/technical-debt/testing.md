# ICAROS-web — 테스트 품질

커밋 `eadb5ea` · 2026-09-02

## 숫자

| | 값 |
|---|---|
| 테스트 파일 | **0** |
| 테스트 프레임워크 | **없음** (vitest·jest·playwright 어느 것도 devDependencies에 없음) |
| CI | **없음** (`.github/workflows/` 디렉터리 자체가 없다) |
| LOC | 25,321 |

부채 대장이 이를 **D1 🟠 "테스트 프레임워크 부재"** 로 기록하고 있다.
이 문서는 **어디부터 덮을 것인가**를 더한다.

## 자동 게이트는 하나뿐이다

커밋에서 프로덕션까지의 경로:
```
git push → Vercel Git 연동 → next build → 배포
```

`next.config.ts:7` 의 `typescript: { ignoreBuildErrors: false }` 덕분에
**타입 오류만** 배포를 막는다.
ESLint는 막지 않는다. 테스트는 존재하지 않는다.

`package.json` 에 `typecheck` `lint` `smoke` 스크립트가 **이미 있는데
자동 실행 지점이 없다.** 대장 D2가 이를 기록한다 —
*"production smoke 가 수동 확인에 의존"* — 그리고 2026-08-30 장애 때
*"스모크 스크립트가 이 케이스를 정확히 갈랐겠지만 **그 시간에 돌린 사람이 없었다.**
도구가 있는 것과 도달하는 것은 다르다."*

## 우선순위 — 무엇부터 덮는가

전면 커버리지가 목표가 아니다. **비용 대비 위험 감소**로 정렬한다.

### 1순위 — `src/lib/db/connection.ts` `buildPoolConfig()` (30분)

**환경변수만 받아 객체를 반환하는 순수 함수**이고,
**2026-08-27 프로덕션 장애의 진원지**다.

```ts
expect(cfg.max).toBe(3)
expect(cfg.idleTimeoutMillis).toBe(10_000)
```

5줄로 **장애 재발 경로가 코드로 봉인된다.**
지금은 코드 주석이 유일한 방어이고, 주석은 사람이 읽어야 작동한다.

추가로 검증할 가치가 있는 것:
- CA 번들이 없으면 IAM 모드에서 throw하는가 (`:152-160`, fail-closed)
- 터널 사용 시 `host` 와 서명·`servername` 이 갈리는가 (`:145-150`)

### 2순위 — `src/lib/auth/` (1,162줄, 반나절)

| 파일 | 줄 | 무엇 |
|---|---|---|
| `account.ts` | 373 | 계정 생성·조회 |
| `session.ts` | 298 | 쿠키 발급·검증 |
| `guard.ts` | 168 | **Origin 허용 판정** |
| `ratelimit.ts` | 105 | 단계별 잠금 |
| `password.ts` | 82 | argon2 |

`guard.ts` 의 `normalizeOrigin` · `configuredOrigins` · `hostMatches` 는
순수 함수이고 **CSRF 방어의 핵심**이다.
self-origin 폴백을 제거한 판단(`:88-89` 주석)이 **회귀로 되돌아오는 것을 막는다.**

`ratelimit.ts` 의 단계별 잠금 계산도 순수 로직이다.

### 3순위 — `src/lib/s3/cleanup.ts` (반나절)

고아 파일 정리 로직. **잘못 돌면 살아 있는 파일을 지운다.**
`sweepStalePendingUploads()` 와 `runCleanupJobs()` 의 경계 조건
(막 업로드된 파일이 고아로 판정되지 않는가)이 핵심이다.
되돌릴 수 없는 손실이 나는 유일한 경로다.

### 4순위 — E2E 1개 (반나절)

로그인 → 관리자 화면 진입. `package.json` 의 `smoke` 스크립트를
Playwright로 옮기면 대장 D2가 함께 닫힌다.

## 조치 순서

```bash
npm i -D vitest @vitest/coverage-v8
```
1. `.github/workflows/ci.yml` 생성 — `typecheck` + `lint` (테스트 없이도 즉시 가치)
2. 1순위 테스트 (30분)
3. CI에 `npm test` 추가
4. 2·3순위를 여유 있을 때

**1번이 먼저다.** 테스트를 붙여도 돌릴 곳이 없으면 의미가 없다.
