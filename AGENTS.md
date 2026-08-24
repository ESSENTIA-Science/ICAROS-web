# AGENTS.md

ICAROS 웹 저장소에서 작업하는 에이전트를 위한 안내.

> ⚠️ 이 저장소는 **PUBLIC** 입니다 (`github.com/ESSENTIA-Science/ICAROS-web`).
> 운영 식별자(RDS 엔드포인트·버킷명·계정 번호·관리자 이메일)를 커밋하지 마십시오.
> 실제 값은 `docs/.local/identifiers.md` (추적 안 됨)에 있고, 문서에는 플레이스홀더만 씁니다.

## 프로젝트

**ICAROS** — 제주 중심 중·고등학생 항공우주 팀의 사이트. `icaros.kr`.
고체연료 사운딩 로켓과 UAV/VTVL 두 갈래로 활동하며, 사이트는 공개 기록 + 후원 창구다.
UI 문구는 한국어, 섹션 헤딩과 슬로건만 영문. 마케팅 과장 없이 실패도 실패로 적는 톤.

현재 **Next.js 16 전면 재구축 중**이다. `main` 은 구 Vite SPA 를 서빙하고,
작업은 `rebuild/next16` 에서 한다. 설계 문서는 `docs/icaros-rebuild/` 에 있고
**확정 결정은 `DECISIONS.md` 에 있다 — 재논의하지 말 것.**

## 명령

```bash
npm run dev              # 5174
npm run build            # 프로덕션 빌드
npm run lint             # eslint (flat config)
npm run typecheck        # tsc --noEmit
npm run db:generate      # drizzle-kit generate  (push 는 금지)
npm run db:migrate
npm run bootstrap:admin  # 관리자 발급 · 복구
npm run storage:cleanup  # S3 정리 큐 수동 실행
npm run migrate:posts    # 레거시 → Community 이관 페이로드
```

로컬 DB: `docker compose up -d` (postgres:17, 포트 **5435**).
`tsc` 와 `lint` **둘 다** 0 이어야 완료다.

## 스택

Next.js 16 App Router · React **19.2.x 정확히 핀** · TypeScript strict + `noUncheckedIndexedAccess`
· Drizzle + `pg` · CSS Modules · react-markdown · three/R3F(지연 로드)

**React 를 올리지 마십시오.** `@react-three/fiber` peer 가 `>=19 <19.3` 창이고
Next peer(`^19.0.0`)는 19.3 을 통과시킨다. `package.json` 의 정확한 핀과 `overrides` 가 방어선이다.

## 아키텍처

- **DB**: `icaros` 스키마만 소유. `public` 은 ESSENTIA Flyway 단독 소유이고, 그쪽은
  `ddl-auto: validate` 로 기동하므로 **`public` 에 무엇이든 만들면 상대 API 가 죽는다.**
  `drizzle-kit push` 금지 — 라이브 DB 를 introspect 한다. `generate` + `migrate` 만.
- **인증**: 자체 구현(Argon2id + DB 세션). 외부 Auth SaaS 없음. 공개 가입 없음.
- **스토리지**: S3. 전부 private, `/api/media/[id]` 가 바이트를 스트리밍한다(302 아님).
- **`/posts`**: ESSENTIA Community 의 ICAROS 게시판이 단일 원본. **복제하지 않는다.**
  읽기는 공개 API 로 이미 동작하고, 쓰기는 서비스 토큰(D1) 대기.

## 규약

- CSS 값은 `src/app/tokens.css` 커스텀 프로퍼티만. 하드코딩 `#hex`/`rgb()` 금지.
- `--sig` 는 밝은 배경 텍스트로 대비 2.46:1 실패 → 텍스트는 `--sig-ink`, `--sig` 는 마크에만.
- 한글은 자간 0.02em 을 넘으면 깨진다. 모듈 CSS 가 `globals.css` 의 `:lang(ko)` 를
  특이도로 이기므로 각 모듈에서 `&:lang(ko)` 를 명시할 것.
- 서버 전용 모듈에 `import 'server-only'`. 모든 mutation 첫 줄에 `requireAdmin()`.
- 기본 Server Component. `'use client'` 는 상호작용이 실제 필요한 잎에만.

## 밟았던 지뢰 — 반복하지 말 것

| | |
|---|---|
| **`loading.tsx` 를 새로 만들지 말 것** | `notFound()` 위에 loading 경계가 있으면 셸이 먼저 flush 되어 **404 가 200 이 된다** |
| **Suspense 경계 안에 내비게이션을 넣지 말 것** | JS 없는 클라이언트에게 그 링크가 사라진다 |
| **JSX 반환 익명 화살표 금지** | `react/display-name` 이 컴포넌트로 오인해 lint 를 깬다 |
| **ISR 로 공개 여부를 감싸지 말 것** | `revalidate` 를 걸면 `published=false` 가 최대 그 시간만큼 계속 보인다 |
| **`drizzle-kit migrate` 의 exit code 를 믿지 말 것** | 실패한 마이그레이션을 삼키고 **exit 0** 으로 끝난다. 원장 행수와 테이블 수를 직접 셀 것 |
| **`next/font` 의 `preload`** | Turbopack 이 `<link rel=preload as=font>` 를 안 내보낸다. 현재 no-op |
| **`openGraph` 는 키 단위로 치환된다** | 페이지에서 `{ description }` 만 주면 루트의 `og:image` 가 그 페이지에서만 사라진다 |

## 하지 말 것

- Production 배포·마이그레이션, S3 운영 버킷 변경, IAM 변경 — 전부 사용자 승인 사항
- 비밀값을 커밋하거나 출력하는 것
- 동작을 확인하지 않은 것을 "완료"로 보고하는 것
