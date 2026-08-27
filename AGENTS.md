# AGENTS.md

ICAROS 웹 저장소에서 작업하는 에이전트를 위한 안내.

> ⚠️ 이 저장소는 **PUBLIC** 입니다 (`github.com/ESSENTIA-Science/ICAROS-web`).
> 운영 식별자(RDS 엔드포인트·버킷명·계정 번호·관리자 이메일)를 커밋하지 마십시오.
> 실제 값은 `docs/.local/identifiers.md` (추적 안 됨)에 있고, 문서에는 플레이스홀더만 씁니다.

## 프로젝트

**ICAROS** — 제주 중심 중·고등학생 항공우주 팀의 사이트. `icaros.kr`.
고체연료 사운딩 로켓과 UAV/VTVL 두 갈래로 활동하며, 사이트는 공개 기록 + 후원 창구다.
UI 문구는 한국어, 섹션 헤딩과 슬로건만 영문. 마케팅 과장 없이 실패도 실패로 적는 톤.

**Next.js 16 앱이 `icaros.kr` 에서 서비스 중이다. 프로덕션 브랜치는 `main` 이다** —
푸시하면 자동 배포된다. (2026-08-27 이전에는 `rebuild/next16` 에서 배포됐는데 Vercel 설정은
`main` 이라 자동 승격이 안 됐고, 배포마다 `vercel deploy --prod` 로 우회해야 했다.
그 우회를 잊으면 조용히 옛 커밋이 계속 서비스됐다. `main` 으로 병합해 없앴다.)

설계 문서는 `docs/icaros-rebuild/` 에 있고 **확정 결정은 `DECISIONS.md` 에 있다 — 재논의하지 말 것.**

랜딩은 **사진 패널**이다 — `icaros.media` 의 사진 한 장 + 그 위에 얹는 텍스트가 한 패널이고,
`icaros.page_panels` 의 행 배열이 곧 랜딩이다. 공개된 패널이 하나도 없으면 **기존 3D 히어로와
섹션 구성으로 저절로 돌아간다** (되돌리기: `npm run panels:publish -- --off`).

공개 화면은 **검정과 흰색 두 색만** 쓴다 (`[data-palette='mono']`). 색은 사진이 낸다.
`/admin` 은 제외 — 편집 도구에서는 시그널이 "조작할 수 있는 것"을 가리키는 일을 계속한다.

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
npm run seed:panels      # 사진 → S3 업로드 + media·page_panels 시드 (--dry 로 대상 확인)
npm run panels:publish   # 패널 일괄 공개(--on) · 내림(--off) · 상태만(무인자)
npm run db:inspect-public # public 스키마 진단 (읽기 전용)
```

로컬: `docker compose up -d` 가 **postgres:17(5435)** 과 **MinIO(9010)** 를 함께 띄운다.
`tsc` 와 `lint` **둘 다** 0 이어야 완료다.

**`.env.local` 의 `DB_AUTH=iam` 은 로컬 명령까지 RDS 로 보낸다.** `npm run db:migrate` 든
`next dev` 든 마찬가지다. 로컬 DB 를 쓰려면 앞에 `DB_AUTH=password` 를 붙인다.
스토리지도 같다 — `S3_ENDPOINT` 를 주면 MinIO 로, 없으면 실제 S3 로 간다.

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
  **Vercel 에서 SDK 기본 자격증명 체인은 동작하지 않는다** — 기본 체인은
  `AWS_WEB_IDENTITY_TOKEN_FILE`(디스크의 **파일**)을 찾는데 Vercel 은 토큰을 파일로 주지 않는다.
  DB(`lib/db/connection.ts`)와 S3(`lib/s3/client.ts`) **둘 다** `AWS_ROLE_ARN` 이 있으면
  `@vercel/functions/oidc` 로 간다. 새 AWS 클라이언트를 만들면 같은 배선을 해야 한다.
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
| **커넥션 유휴 시간을 늘리지 말 것** | `idleTimeoutMillis` 를 10초→60초로 올렸다가 프로덕션이 죽었다. `max: 3` 은 **인스턴스당** 상한이고 Fluid Compute 는 인스턴스를 여러 개 띄운다. RDS 는 ESSENTIA 와 공유다 — `53300 remaining connection slots are reserved` |
| **집계 버전 토큰을 행 저장에 쓰지 말 것** | `maxVersionExpr` 는 목록 전체용이다. 개별 저장 `WHERE` 에 쓰면 한 행을 고친 뒤부터 나머지가 영원히 충돌로 막힌다 |
| **`vercel.json` 에 `outputDirectory` 를 넣지 말 것** | `framework: "nextjs"` 와 같이 두면 함수 배치가 어긋나 `/_next/image` 가 번들에서 빠진다 |
| **상대 스키마를 수치로 감시하지 말 것** | `public` 테이블 수를 상수와 대조했더니 ESSENTIA 의 **정상 배포**(`V19__application_bans`)에 빨간불이 났다. 상대는 계속 마이그레이션을 돌린다 — 우리가 볼 것은 개수가 아니라 **소유자**다 |
| **`drizzle-kit migrate` 의 exit code 를 믿지 말 것** | 실패한 마이그레이션을 삼키고 **exit 0** 으로 끝난다. 원장 행수와 테이블 수를 직접 셀 것 |
| **`next/font` 의 `preload`** | Turbopack 이 `<link rel=preload as=font>` 를 안 내보낸다. 현재 no-op |
| **`openGraph` 는 키 단위로 치환된다** | 페이지에서 `{ description }` 만 주면 루트의 `og:image` 가 그 페이지에서만 사라진다 |
| **`force-dynamic` 을 주석으로 확인하지 말 것** | `/rocket` 주석이 "이 페이지는 force-dynamic 이고"라고 **단정**하고 있었지만 선언은 없었다(옆 라우트의 사실을 옮겨 적은 것). 그래서 `next build` 가 프리렌더하며 DB 를 쳤고, **빌드가 DB 도달성을 필수로 요구**했다. 확인법: `DATABASE_URL` 을 죽은 포트로 두고 `npm run build` |
| **커넥션 문제를 `idleTimeoutMillis` 로 풀려 하지 말 것** | 진짜 변수는 **동시 인스턴스 수**다. 63개가 각자 1개만 잡아도 63이다. 유휴 시간은 트래픽이 **멎은 뒤**를 지배할 뿐 버스트 한복판에서는 아무것도 막지 못한다 (D26) |
| **순간값 지표를 일 단위로 보지 말 것** | 같은 커넥션 데이터가 창 크기만 바꿔서 **28 → 77** 이 됐다. `--period 86400` 이 5분 스파이크를 평균으로 눌렀다. 양쪽 세션이 각각 한 번씩 밟았다 — 도구 기본값이 만드는 함정이다 |
| **간헐적 DB 타임아웃을 코드에서 찾지 말 것** | RDS 5432 인바운드가 us-east-1 EC2 **일부 대역 29개**로만 열려 있다(상한 60 때문에 294개 중 29개). 목록 밖 인스턴스는 **조용히** 타임아웃 나고 **RDS 로그에도 안 남는다**. `essentia_infra` 에 먼저 물을 것 (D27) |
| **Fluid Compute 의 IP 를 관측으로 고정하지 말 것** | RDS 인바운드를 그날 관측된 우리 IP 124개에서 역산한 대역 29개로 좁혔더니 **몇 분 만에** 목록 밖 인스턴스(`35.153.176.161`)가 나왔다. 어제 쓴 대역이 오늘의 대역이 아니다 (D27) |

## 하지 말 것

- Production 배포·마이그레이션, S3 운영 버킷 변경, IAM 변경 — 전부 사용자 승인 사항
- 비밀값을 커밋하거나 출력하는 것
- 동작을 확인하지 않은 것을 "완료"로 보고하는 것

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
