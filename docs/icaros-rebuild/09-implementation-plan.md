# 09 — Implementation Plan

> Gate 2 완료 시점 기준. 결정 근거는 `DECISIONS.md`.
> **Production Vercel 배포 · Production Neon 마이그레이션 · S3 운영 버킷 변경 · IAM 변경은 사용자 승인 전 실행하지 않는다.**

---

## 0. 지금 실행 가능한 것 / 막힌 것

| | 상태 |
|---|---|
| **Gate 4 (기반)** — Next.js 16 스캐폴드 · `icaros` 스키마 · 자체 인증 · S3 어댑터 | ✅ **로컬 postgres:17로 착수 가능.** 외부 승인 불필요 |
| **Gate 5 (기능)** — Landing · Rockets · Members · Admin · SEO | ✅ 착수 가능 |
| Gate 5 중 **Posts** | ⛔ D1 서비스 토큰(ESSENTIA BE 레포) 대기 |
| Gate 5 중 **3D** | ◐ `icx-2.fbx`(16MB) → GLB 변환 선행 |
| **마이그레이션 실행** | ⛔ U1·U2 (`service_role` 덤프) |
| **Preview 배포** | ⛔ Neon 연결 · CORS 2건 · IAM OIDC — 전부 사용자 승인 |
| 폰트 | ⛔ D10 라이선스 |

---

## 1. 저장소 전략

**같은 레포(`ESSENTIA-Science/ICAROS-web`)에서 in-place 전환.** 새 레포를 만들지 않는다.

- 작업 브랜치 `rebuild/next16`. `main`은 현행 사이트가 계속 서빙되도록 건드리지 않는다.
- Vite 트리는 `legacy/` 로 옮기지 않고 **그대로 두었다가 Gate 6 통과 후 한 번에 삭제**한다. 이전 중 참조 원본이 필요하다.
- `.env.local`의 죽은 변수 `VITE_ADMIN_PW` 제거 (`00-legacy-schema-snapshot.md` §6).

## 2. 디렉터리 (목표)

```
src/
  app/
    (public)/
      layout.tsx  page.tsx                 ← Landing
      rocket/page.tsx  rocket/[slug]/page.tsx
      posts/page.tsx   posts/[slug]/page.tsx
      member/page.tsx
      loading.tsx  error.tsx  not-found.tsx
    admin/
      layout.tsx  page.tsx                 ← 인증 게이트
      _panels/{posts,rockets,members,landing,scene}.tsx
    api/
      media/[id]/route.ts                  ← 302 presigned GET 프록시 (D3)
      upload/presign/route.ts  upload/confirm/route.ts
  lib/
    auth/     { email.ts session.ts password.ts ratelimit.ts guard.ts }
    db/       { index.ts schema/*.ts }
    s3/       { client.ts presign.ts cleanup.ts }
    content/  { markdown.ts highlight.tsx }
    community/{ client.ts }                ← ESSENTIA REST (D1)
  components/
    three/    ← 전부 client, dynamic import
    ui/
scripts/
  bootstrap-admin.ts
  migrate-legacy/{export.ts transform.ts upload.ts verify.ts}
drizzle/      ← generate 산출물. 리뷰 후 커밋
```

경계 규칙: `lib/db` · `lib/s3` · `lib/auth` 최상단에 `import 'server-only'`.

## 3. 단계

### P1 — 스캐폴드 (승인 불필요)
1. Next 16 + TS + Turbopack. **`react`/`react-dom`을 `19.2.x`로 정확히 핀** (R3F peer가 `>=19 <19.3`)
2. `eslint.config.js` 신설 — 현행 `npm run lint`는 flat config 부재로 실패한다
3. 폰트: Pretendard woff2 서브셋 + `next/font/local`. **디스플레이 폰트는 D10 해소까지 Pretendard로 대체**
4. `03-reference-research.md`의 토큰을 `app/globals.css`에 `:root` 커스텀 프로퍼티로. `--motion: 1|0` 포함
5. Header/Footer — **Simulate 전면 제거**, 메뉴 4개

### P2 — 데이터 계층
6. 로컬 `postgres:17-alpine` (compose, 포트 **5435** — ESSENTIA의 5434와 충돌 회피)
7. Drizzle: `schemaFilter: ['icaros']`, `migrations: { schema:'icaros', table:'__drizzle_migrations' }`. **`push` 금지**
8. `icaros` 스키마 테이블 (`05-database-plan.md` §3)
9. Zod 스키마 + `drizzle-zod`. **DB CHECK 제약**으로 현행 결함 #6 해소

### P3 — 인증 (`06-auth-security-plan.md` 전문)
10. Argon2id · 세션 · 쿠키 · rate limit · `requireAdmin()` 게이트
11. `scripts/bootstrap-admin.ts` (stdin 전용)
12. **Reviewer 체크리스트 11항을 구현자와 다른 에이전트가 검증**

### P4 — S3
13. presigned **PUT** + `/confirm` `HeadObject` 검증 (D12)
14. `/api/media/[id]` 302 프록시 (D3). `next/image` `src`로 사용
15. 브라우저 전처리: canvas → WebP, **품질 하향 루프**, SVG 차단
16. `icaros.media` pending→ready + cleanup job
17. **로컬은 MinIO 또는 실제 버킷 read-only.** 쓰기는 CORS·IAM 승인 후

### P5 — 공개 페이지
18. Landing 7섹션 (Server Component, DB 직접 조회, **`DEFAULTS` 폴백 사본 제거**)
19. `/rocket` + `/rocket/[slug]` — 모달 → 전용 페이지 (딥링크)
20. `/member` — `school` 표시 여부 결정, 부서 그룹핑, `sort_order` tie-break
21. `generateMetadata`로 CMS 기반 SEO·OG
22. 404 FuzzyText 이식 + `prefers-reduced-motion`

### P6 — Admin CMS
23. 4탭 + Scene Configuration (검증된 JSON schema만, **임의 JS 저장 금지**)
24. **Landing 저장 차단 로직** — fetch 실패 시 Save 불가 (현행 결함 #1)
25. 게시일 편집 필드 (현행 결함 #3)

### P7 — 3D
26. `icx-2.fbx`(16MB) → GLB + Draco/meshopt. **웹 적합성 먼저 평가**
27. 고정 캔버스 1개 + 섹션 타깃 박스 (Vast·한화 공통 패턴)
28. 모바일 fallback = 포스터. WebGL 미지원 대응
29. **pinning·snapping·scroll hijacking 없음** — `IntersectionObserver` 일회성 reveal

### P8 — Posts (⛔ D1 대기)
30. `lib/community/client.ts` — ESSENTIA REST 어댑터
31. `/posts` + `/posts/[slug]`, CMS Posts 탭
32. 마이그레이션: 중복 2건 제외, `author` = ICAROS 서비스 계정 FK (D13)

### P9 — 마이그레이션 (⛔ U1·U2)
33. `pg_dump --schema-only` + `admins`/`auth.users` 덤프
34. export → WebP 일괄 변환 → S3 업로드 → 체크섬 검증
35. `summary` **재계산**(복사 금지), `sort_order` 재부여, `.PNG` 정규화, 고아 3건 제외

### P10 — 검증
36. Gate 6 교차 리뷰 (요구사항·UI·Auth·DB·S3·접근성·성능)
37. 잔존 문자열 검사: `supabase` · `NEXT_PUBLIC_SUPABASE` · `SUPABASE_SERVICE_ROLE` · `sim.icaros.kr` · `nav-simulate-mobile` · `simulate`
38. `02-requirements-matrix.md` 전 항목 ☑ 확인

---

## 4. 에이전트 배정 (P별)

동일 파일을 두 에이전트가 동시에 만지지 않도록 소유 범위를 고정한다.

| 오케스트레이터 | 담당 | 소유 경로 |
|---|---|---|
| Frontend | P1 · P5 · P6 | `app/(public)`, `app/admin`, `components/ui` |
| Backend & Data | P2 · P8 | `lib/db`, `drizzle/`, `lib/community` |
| Auth & Security | P3 | `lib/auth`, `scripts/bootstrap-admin.ts` |
| Storage & AWS | P4 | `lib/s3`, `app/api/media`, `app/api/upload` |
| 3D & Performance | P7 | `components/three`, GLB 자산 |
| Quality & Review | P10 | 읽기 전용 + 리뷰 산출물 |

**구현자와 검토자를 분리한다.** 특히 P3은 별도 Security Reviewer가 `06` §12 체크리스트를 수행한다.

## 5. 성능 예산 (Gate 6)

| 항목 | 예산 | 현행 |
|---|---|---|
| 초기 JS (3D 제외) | ≤ 150 KB gz | 측정 필요 |
| 폰트 | ≤ 200 KB | **17 MB** (ttf 18종) |
| LCP 이미지 | ≤ 200 KB | 최대 **9.7 MB** |
| GLB | ≤ 8 MB | FBX **16 MB** |
| 목록 페이지 총 전송 | ≤ 1.5 MB | 원본 풀사이즈 로드 중 |

## 6. Rollback

- `main`은 Gate 7까지 현행 Vite 사이트를 서빙한다. Vercel 프로덕션 도메인 전환이 유일한 되돌릴 지점이다.
- Supabase는 **검증 완료 전까지 폐기하지 않는다.** 읽기 전용으로 살려 둔다.
- S3는 **Versioning이 꺼져 있다** — 이관은 복사만, 덮어쓰기·삭제 금지.
- DB 롤백은 Drizzle down 마이그레이션이 아니라 `icaros` 스키마 통째 재생성으로 한다(우리 소유이므로 안전).
