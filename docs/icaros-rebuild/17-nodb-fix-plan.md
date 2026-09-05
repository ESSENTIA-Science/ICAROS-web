# 17 — DB 를 건드리지 않고 끝낼 수 있는 것 전부 (작업 지시서)

> **범위 규칙 하나:** 이 문서에 있는 작업은 **마이그레이션 0개, `site_settings` 행 추가 0개**다.
> `npm run db:generate`·`db:migrate` 를 부르는 순간 그 작업은 이 문서 밖이다.
> DB 가 필요한 것은 §7 에 이유와 함께 따로 적어 두었고, 여기서 **하지 않는다**.
>
> 작성 2026-09-06. 근거가 되는 실측은 전부 그날 프로덕션(`www.icaros.kr`)에서 직접 잰 값이다.

---

## 0. 한 장 요약

| 요구 | 이 문서에서 | 남는 것 |
|---|---|---|
| 1. 패널 위 작은 글자 삭제 | ✅ 전부 | — |
| 2. 포스트 상단 인스타 링크 | ✅ 전부 | — |
| 3. 멤버 분과 밑 `1` 삭제 | ✅ | 개인 소개글은 §7 (컬럼 필요) |
| 4. 포스트 기능 정상화 | ⛔ | 외부 토큰 대기 — §7 |
| 5. 메인 사진 추가·삭제 | ✅ 전부 (삭제는 이미 됨, **업로드가 없었다**) | — |
| 6. 후원 차수 표기 | ⛔ | `site_settings` 행 1개 필요 — §7 |
| 7. VEHICLES 개편 | ⛔ | 분류 테이블 필요 — §7 |
| 8. AI 티 나는 자잘한 것 | ✅ 전부 (코드에 있는 것) | 카피 2건은 `/admin` 에서 사람이 — §6 |
| 9. 메인 영상 | ✅ 전부 | 포스트 PDF·영상은 §7 |
| 10. 웹 로딩 속도 | ⚠️ **부분 — 7개 라우트 중 5개** | `/rocket`·`/posts` 는 `searchParams` 때문에 남음 → §4.5 W4 |

**작업량: 6개 에이전트, 2 웨이브, 순수 작업 1.5일.**
가장 큰 효과는 `A6`(캐시 정책) 하나다 — TTFB 550ms → 80ms 예상, 코드 6줄.

> **사후 정정 (2026-09-06, A7 검수).** 위 10번은 계획 시점에 `✅ 전부` 였다. 틀렸다.
> "무효화 배선이 다 되어 있으니 `force-dynamic` 만 걷으면 된다"가 전제였는데, **캐시를 막은 것은
> 무효화가 아니라 빌드와 `searchParams` 였다.** 그 둘은 이 문서를 쓸 때 계산에 없었다.
> 실제로 전환된 것은 `/rocket/[slug]`·`/posts/[id]`·`/posts/legacy/[slug]` **3개**다.
> 이 표를 예쁘게 고치지 않고 정정으로 남기는 이유는, 다음에 같은 전제를 다시 세우지 않기 위해서다.

> **두 번째 정정 (2026-09-06, W4 실행 후).** 위 3개가 5개가 됐다. `/`·`/member` 가 `○ (Static)`
> `Revalidate 1m` 으로 넘어갔다. A6 이 막혔던 벽(빌드 프리렌더가 RDS 를 친다)은 **없애지 못했고,
> 대신 프리렌더가 실패해도 죽지 않게** 했다 — 로더를 전부 fail-safe 로 바꾸고, 그 대가로 생기는
> "빈 화면이 캐시에 박히는 창"을 배포 웹훅 + 60초 백스톱 + 스모크 본문 검사 셋으로 막았다.
> **남은 2개(`/rocket`·`/posts`)는 그대로다** — `searchParams` 는 fail-safe 로 풀리는 문제가
> 아니라 라우트 모양을 바꿔야 하는 문제라서 §7 에 남는다.

---

## 1. 오케스트레이터 규칙

### 1.1 웨이브 구성 — 파일 소유권으로 갈랐다

에이전트를 같은 파일에 두 개 붙이지 않는다. 아래 분할은 **파일 단위로 겹치지 않는다.**

```
웨이브 1 (4개 동시)          웨이브 2 (2개 동시)        웨이브 3 (1개)
─────────────────────       ────────────────────      ──────────────
A1 랜딩 껍데기          ┐
A2 멤버·기체 페이지     ├──▶  A5 영상 파이프라인   ┐
A3 포스트 페이지        │     A6 캐시·도메인       ├──▶  A7 검수·회귀
A4 어드민 패널 업로드   ┘                          ┘
```

웨이브 2 가 웨이브 1 뒤에 오는 이유는 딱 하나다 — `A5` 가 `Panel.tsx`(A1 소유)를,
`A6` 가 공개 라우트 `page.tsx`(A1·A2·A3 소유)를 다시 연다. 논리적 의존이 아니라 **충돌 회피**다.

### 1.2 오케스트레이터가 웨이브마다 하는 일

1. 웨이브 시작 전 `git status` 가 깨끗한지 확인한다. 아니면 멈추고 사람에게 묻는다.
2. 웨이브의 에이전트를 **한 메시지에서 동시에** 띄운다.
3. 전원 복귀 후 **오케스트레이터가 직접** 게이트를 돈다 (§1.4). 에이전트 보고를 그대로 믿지 않는다.
4. 게이트 통과 시에만 다음 웨이브. 실패하면 해당 에이전트에게 `SendMessage` 로 실패 출력을 그대로 넘겨 고치게 한다 — 새 에이전트를 띄우지 않는다(맥락이 사라진다).
5. 웨이브 단위로 커밋한다. 웨이브 3개 = 커밋 3개.

### 1.3 모든 에이전트에게 공통으로 주는 제약

에이전트 프롬프트에 **그대로 복사해 넣는다.** 이 저장소는 규약이 빡빡하고, 어기면 lint 나 런타임에서
조용히 깨진다.

```
- 이 저장소의 CLAUDE.md 를 먼저 읽어라. 특히 "밟았던 지뢰" 표.
- CSS 값은 src/app/tokens.css 커스텀 프로퍼티만 쓴다. 하드코딩 #hex/rgb() 금지.
- loading.tsx 를 새로 만들지 마라. notFound() 위에 loading 경계가 있으면 404 가 200 이 된다.
- Suspense 경계 안에 내비게이션을 넣지 마라.
- JSX 를 반환하는 익명 화살표 함수를 만들지 마라 — react/display-name 이 lint 를 깬다.
- 기본은 Server Component. 'use client' 는 상호작용이 실제로 필요한 잎에만.
- noUncheckedIndexedAccess 가 켜져 있다 — 배열·레코드 인덱싱 결과는 항상 undefined 가능이다.
- 한글 자간은 0.02em 을 넘기지 마라. 모듈 CSS 에서 &:lang(ko) 를 명시해야 globals.css 를 이긴다.
- 마이그레이션을 만들지 마라. drizzle 스키마 파일(src/lib/db/schema/**)을 수정하지 마라.
- 완료 기준은 `npm run typecheck` 와 `npm run lint` 가 둘 다 exit 0 이다. 둘 다 직접 돌리고 결과를 보고해라.
- 네가 담당한 파일 목록 밖의 파일을 수정하지 마라. 필요하면 수정하지 말고 보고해라.
- 확인하지 않은 것을 "완료"로 보고하지 마라.
```

### 1.4 게이트 — 오케스트레이터가 직접 돈다

```bash
npm run typecheck        # 반드시 0
npm run lint             # 반드시 0
DATABASE_URL=postgres://x@127.0.0.1:1/x DB_AUTH=password npm run build
#   ↑ 죽은 포트다. 빌드가 DB 도달성을 요구하지 않는지 보는 회귀 테스트 (CLAUDE.md 지뢰).
#     A6 이 force-dynamic 을 걷어낸 뒤 특히 중요하다 — 프리렌더가 살아나면 여기서 잡힌다.
```

**로컬 시각 확인은 기대하지 마라.** `.env.local` 의 `DB_AUTH=iam` 이 로컬 명령까지 RDS 로 보내고,
RDS 5432 는 us-east-1 EC2 대역으로만 열려 있다. `npm run db:tunnel` 없이는 `next dev` 도 데이터를
못 읽는다. 로컬 docker DB(`DB_AUTH=password`)는 비어 있어 **패널이 0개 → 랜딩이 3D 히어로로 폴백**한다.
→ 패널·영상 관련 시각 확인은 **Vercel 프리뷰 배포에서 사람이** 한다. 에이전트는 타입·린트·빌드까지만.

---

## 2. 웨이브 1

### A1 — 랜딩 껍데기의 작은 글자

**소유 파일 (이 밖은 건드리지 않는다)**

```
src/components/panel/Panel.tsx
src/components/panel/Panel.module.css
src/components/landing/Section.tsx
src/components/landing/Section.module.css
src/lib/panels.ts
```

**할 일**

1. **`Scroll` 지시문 삭제** — `Panel.tsx:96-104`. 첫 패널에만 붙던 `scrollCue` 블록 전체와
   `Panel.module.css` 의 `.scrollCue`·`.scrollWord`·`.scrollLine` 을 같이 지운다.
2. **패널 아이브로 렌더 삭제** — `Panel.tsx:55-59`. 이게 화면의 `Track 01 · Solid Rockets` /
   `Track 02 · UAV / VTVL` 이다. **값은 DB(`page_panels.eyebrow`)에 있지만 렌더를 지우면 화면에서
   사라진다** — 이 문서가 DB 를 안 건드리고 1번을 끝내는 방법이다.
   `PanelForm` 의 입력 칸은 **그대로 둔다** (어드민은 A4 소유이고, 값은 남겨 둔다).
   → `.eyebrow` CSS 도 같이 정리.
3. **섹션 번호 `01` `02` 삭제** — `Section.tsx:52-54` 의 `styles.index` span.
   `Section.module.css` 의 `.index` 와, 헤더 그리드가 3칸을 전제하고 있으면 그 정의도 같이 맞춘다.
   `index` prop 자체는 남겨도 되지만 **쓰이지 않으면 lint 가 잡는다** — `page.tsx` 는 A1 소유가
   아니므로, prop 을 지우지 말고 **번호 표시만** 없앤다(시그니처 유지).
4. **죽은 credit 경로 제거** — `lib/panels.ts` 가 `credit: null` 을 하드코딩하고 있어
   `Panel.tsx:110-114` 의 credit 렌더는 **절대 실행되지 않는다.** DTO 필드와 렌더를 같이 지운다.

**하지 말 것** — `page_panels` 스키마, `PanelForm`, `admin/_actions/panels.ts`.

**보고** — 지운 요소 목록, typecheck/lint 출력.

---

### A2 — 멤버·기체 페이지의 작은 글자

**소유 파일**

```
src/app/(public)/member/page.tsx
src/app/(public)/member/page.module.css
src/app/(public)/rocket/page.tsx
src/app/(public)/rocket/page.module.css
src/app/(public)/rocket/[slug]/page.tsx
src/components/rocket/SeriesTabs.tsx
src/components/rocket/SeriesTabs.module.css
```

**할 일**

1. **분과 인원수 `1` 삭제** — `member/page.tsx:55-57` 의 `squadCount` span. CSS 도 같이.
   (요구 3번의 절반. 나머지 절반인 "옆에 소개글"은 컬럼이 필요해 §7.)
2. **`Crew` 아이브로 삭제** — `member/page.tsx:40`.
3. **`Fleet` 아이브로 삭제** — `rocket/page.tsx:74`.
4. **사용설명서 문장 삭제** — `rocket/page.tsx:77` 의
   `"카드를 선택하면 제원과 엔진 구성을 볼 수 있습니다."` 한 문장만. 앞 문장은 남긴다.
   → 요구 8번. 링크를 누르라고 알려 주는 문장은 LLM 카피의 대표 냄새다.
5. **시리즈 탭 옆 숫자 검토** — `SeriesTabs.tsx:32-34` 가 `RAON Series 1`, `ICX-I Series 1` 처럼
   개수를 붙인다. 1기짜리 카테고리에서 이 숫자는 정보가 아니다.
   **삭제한다.** `counts` prop 은 호출부(`rocket/page.tsx`, A2 소유)까지 같이 정리한다 —
   `countRocketsBySeries()` 호출도 빠지므로 **쿼리 하나가 덤으로 준다.**
6. **`[slug]` 의 시리즈 라벨 아이브로는 남긴다** (`[slug]/page.tsx:99`). 그건 그 기체가 어느
   계열인지 알려 주는 유일한 표시라 장식이 아니다.

**보고** — 삭제 목록, `counts` 제거로 빠진 쿼리 1개 명시, typecheck/lint.

---

### A3 — 포스트 페이지: 작은 글자 제거 + 인스타 링크

**소유 파일**

```
src/app/(public)/posts/page.tsx
src/app/(public)/posts/page.module.css
src/app/(public)/posts/[id]/page.tsx
src/app/(public)/posts/legacy/[slug]/page.tsx
src/components/landing/Contact.tsx     ← 헬퍼 하나만 옮긴다 (아래 3번)
src/lib/content.ts                      ← 그 헬퍼가 갈 곳
```

**할 일**

1. **아이브로 삭제** — `posts/page.tsx:57` 의 `Posts`, `posts/[id]/page.tsx:52` 의 `Post`.
   바로 아래 `<h1>기록</h1>` 이 이미 같은 말을 한다.
2. **내부 사정 문구 2건 삭제** (요구 8번) —
   - `posts/page.tsx:104` `"최신 기록은 ESSENTIA 커뮤니티의 ICAROS 게시판이 원본이고, 그 이전 기록은 ICAROS 가 직접 보관합니다."`
   - `posts/legacy/[slug]/page.tsx:76` `"이관 이전 기록입니다. 원본은 ICAROS 가 직접 보관합니다."`

   방문자에게 우리 데이터 소유 구조는 알 바가 아니다. 상류 장애 때 뜨는
   `communityUnavailable` 안내(`posts/page.tsx:63-77`)는 **남긴다** — 그건 목록이 짧아진 이유를
   설명하는 기능적 문구다.
3. **인스타그램 링크 추가** (요구 2번) — `/posts` 최상단, 제목 `기록` 과 목록 사이.
   - 핸들은 **이미 있는** `site_settings.contact.instagram` 을 쓴다. 새 키를 만들지 않는다.
     `posts/page.tsx` 에서 `getSiteContent()` 를 호출하면 된다 —
     `cache()` 라 Header·Footer 와 같은 요청에서 결과를 공유하므로 **쿼리 비용 0** 이다.
   - URL 조립은 `Contact.tsx:6-7` 의 `instagramUrl()` 이 이미 한다. **복사하지 말고**
     `src/lib/content.ts` 로 export 를 옮기고 `Contact.tsx` 가 그걸 import 하게 바꾼다.
     (두 벌이 되면 `@` 처리가 언젠가 갈라진다.)
   - 값이 없으면 **아무것도 그리지 않는다.** 랜딩 섹션들과 같은 규칙이다.
   - `target="_blank" rel="noreferrer"`.
   - 문구는 포스트 목록과 구별되어야 한다 — 예: `Instagram @icaros_aerospace ↗`.
     본문 톤(평이·사실적)에 맞춘다. "팔로우하고 소식을 받아보세요" 같은 문장 금지.

**하지 말 것** — `lib/posts/feed.ts`, `lib/community/client.ts`.

**보고** — 인스타 링크 위치와 폴백 동작, typecheck/lint.

---

### A4 — 어드민: 패널 사진 업로드 (요구 5번)

**소유 파일**

```
src/components/admin/PanelForm.tsx
src/app/admin/_actions/panels.ts
src/app/admin/_data/panels.ts
src/app/admin/_panels/PanelsPanel.tsx
```

**지금 상태 — 이게 5번의 정확한 정체**

- **삭제는 이미 된다** — `deletePanel`(`_actions/panels.ts:248`), 순서 이동 `movePanel`,
  공개 토글 `togglePanelPublished` 전부 있다.
- **업로드가 없다.** `PanelForm` 은 `listPanelMediaChoices()`(`_data/panels.ts:92`)가 준
  **이미 존재하는 `media` 행 중에서 고르기만** 한다. 새 사진을 넣으려면
  `npm run seed:panels` 를 개발자가 돌려야 했다. 그래서 "사진 추가가 안 된다"가 맞다.

**할 일**

1. `PanelForm` 에 **업로드 경로**를 붙인다. 로켓·멤버가 쓰는
   `src/components/admin/MediaField.tsx` 가 이미 presign → PUT → confirm 전체를 한다.
   - `kind`: **`hero`** (2MB / 긴 변 1600px). `media`(1MB/512px)는 전면 사진에 부족하다.
   - `entityType`: **`landing`** — **반드시 넘긴다.** 비우면 `/api/media/[id]` 가
     `private, no-store` 로 서빙해 랜딩 사진에 CDN 캐시가 안 붙는다
     (`lib/s3/media.ts` 의 `CACHEABLE_ENTITY_TYPES`).
2. **기존 "고르기" 목록은 남긴다.** 같은 사진을 두 패널에 쓰는 경우가 있고, 지우면 그 경로가
   사라진다. 업로드와 고르기를 한 화면에 둔다 (업로드가 위, 기존에서 고르기가 아래).
3. 업로드 직후 `mediaId`·`mediaWidth`·`mediaHeight` 를 폼 상태에 반영해서 **초점 찍기 미리보기가
   즉시 새 사진으로 갱신**되게 한다. 지금 미리보기는 `choices` 에서 찾은 항목에 의존한다
   (`PanelForm:71`) — 업로드로 들어온 사진은 그 배열에 없으므로 그대로 두면 미리보기가 빈다.
4. `createPanel`/`updatePanel` 의 zod 스키마는 이미 `mediaId` 를 받는다. **서버 액션은
   바꿀 필요가 없을 가능성이 높다** — 확인하고, 정말 필요 없으면 손대지 마라.
5. 모든 mutation 첫 줄의 `requireAdmin()` 은 그대로. 낙관적 잠금(`_lib/version.ts`)도 그대로.

**하지 말 것** — 업로드 정책 상수(`lib/image/policy.ts`)는 **A5 소유다.** 여기서 바꾸지 마라.

**보고** — 업로드 후 미리보기가 갱신되는 경로, `entityType='landing'` 을 넘긴 위치, typecheck/lint.

---

## 3. 웨이브 2

### A5 — 영상 파이프라인 (요구 9번의 "메인 영상")

> 참고 — 사용자가 지목한 두 곳을 실제로 확인했다.
> **페리지**: `<video src=".../*.mp4" loop preload="none" muted playsinline>` + `object-fit: cover`.
> **이노스페이스**: `<video autoplay muted loop playsinline>` + `object-fit: cover`,
> 소스가 **854×480** 이다 — 배경 영상은 작게 쓴다.
> 둘 다 특별한 라이브러리 없이 순수 `<video>` 다. 우리도 같은 방식으로 간다.

**소유 파일**

```
src/lib/image/policy.ts
src/lib/image/upload.ts
src/lib/image/encode.ts
src/components/admin/media-upload.ts
src/components/admin/MediaField.tsx
src/components/panel/Panel.tsx
src/components/panel/Panel.module.css
src/lib/panels.ts
src/app/api/upload/presign/route.ts
src/app/api/upload/confirm/route.ts
```

**왜 마이그레이션이 필요 없나 — 먼저 확인할 것**

- `media.mime` 은 자유 텍스트다. CHECK 가 없다.
- `media.entity_type` 도 자유 텍스트다. `MEDIA_ENTITY_TYPES` 는 **코드 상수**일 뿐이다.
- `media_key_prefix_ck` 는 `icaros-web/%` 또는 `forum/%` 만 본다 — **폴더 세그먼트를 새로
  추가해도 통과한다.**
- `page_panels.media_id` 는 이미 `media` 를 가리킨다. 그 행이 사진인지 영상인지 스키마는 모른다.

→ **영상은 스키마를 하나도 안 건드리고 들어간다.** 이 4줄을 먼저 코드로 검증하고 시작해라.

**할 일**

1. **업로드 종류 추가** — `policy.ts` 의 `UPLOAD_KINDS` 에 `'video'`.
   ```
   video: { folder: 'video', extension: 'mp4', mime: 'video/mp4', maxBytes: 32MB, maxEdgePx: null }
   ```
   - `KEY_FOLDERS` 에 `'video'` 추가, `MAX_BYTES_BY_FOLDER` 에 같은 값.
   - `UploadPolicy` 의 `extension`·`mime` 유니온을 넓힌다.
   - **브라우저 인코딩은 없다.** 이미지는 WebP 로 다시 굽지만 영상은 그대로 PUT 한다
     (`encode.ts` 를 타지 않는 경로). `checkUploadCandidate` 가 `policy.extension === 'glb'`
     일 때만 확장자를 강제하는데, **영상도 확장자를 강제해야 한다** — 전처리가 없어 확장자가
     곧 형식 주장이기 때문이다. GLB 와 같은 이유다.
   - 상한 32MB 근거: presigned PUT 은 브라우저 → S3 직행이라 Vercel 함수 100MB 제한과 무관하다.
     제약은 회선과 `/confirm` 의 HeadObject 뿐이다. 이노스페이스가 854×480 을 쓰는 것을 감안하면
     32MB 는 배경 루프에 넉넉하다.
2. **치수 측정** — `media.width`/`height` 는 `getLandingPanels()` 의 필터 조건이다
   (`lib/panels.ts` 가 둘 중 하나라도 null 이면 그 패널을 **버린다**).
   영상은 `HeadObject` 로 치수를 알 수 없으므로 **브라우저에서 `<video>` 메타데이터를 읽어**
   (`videoWidth`/`videoHeight`) presign·confirm 페이로드에 실어 보낸다.
   → 이걸 빼먹으면 영상 패널이 **조용히 화면에서 사라진다.** 반드시 한다.
3. **`lib/panels.ts` 가 mime 을 들고 온다** — `LandingPanel` DTO 에 `mime: string` 추가,
   select 에 `media.mime`.
4. **`Panel.tsx` 분기** — mime 이 `video/` 로 시작하면 `<Image>` 대신:
   ```
   <video autoPlay muted loop playsInline preload="metadata"
          poster={...} width={...} height={...} />
   ```
   - `object-fit: cover` + `object-position: var(--focal-x) var(--focal-y)` — **초점 필드가
     사진과 똑같이 동작해야 한다.** 그게 이 모델의 핵심이다.
   - `prefers-reduced-motion: reduce` 면 자동재생하지 않는다. 첫 프레임(poster)만 세운다.
     접근성 요구이자, 이 저장소가 3D·리빌에서 이미 지키는 규칙이다.
   - `preload`: 첫 패널만 `metadata`, 나머지는 `none`. 페리지가 `none` 을 쓰는 이유와 같다 —
     화면 밖 영상이 대역폭을 먼저 먹으면 LCP 가 밀린다.
   - **`next/image` 를 통과하지 않는다.** `/api/media/[id]` 가 Range 요청을 이미 S3 로
     그대로 넘기므로(`route.ts:53`) `<video src="/api/media/{id}">` 가 그대로 탐색까지 된다.
5. **`MediaField` 가 영상을 다룬다** — 미리보기를 `<img>` 대신 `<video>` 로, 업로드 진행 문구를
   "이미지를 변환하고 있습니다…" 가 아닌 것으로.

**하지 말 것** — `page_panels` 스키마, 어드민 폼 배치(A4 가 방금 고쳤다 — 충돌 확인 후 최소 수정),
`hasReferences()`/`media-references.ts` (패널은 이미 FK 목록에 있다).

**보고** — 치수 측정 경로, reduced-motion 처리, 프리뷰 배포에서 사람이 볼 확인 항목 목록.

---

### A6 — 로딩 속도 (요구 10번). **가장 싸고 가장 큰 건**

**소유 파일**

```
src/app/(public)/page.tsx
src/app/(public)/posts/page.tsx
src/app/(public)/posts/[id]/page.tsx
src/app/(public)/posts/legacy/[slug]/page.tsx
src/app/(public)/member/page.tsx
src/app/(public)/rocket/page.tsx
src/app/(public)/rocket/[slug]/page.tsx
src/app/layout.tsx
next.config.ts
```

**측정값 (2026-09-06, 경기도에서 실측)**

```
홈       TTFB 콜드 1.81s / 웜 0.55s
/posts        1.52s / 0.55s
/rocket       0.77s
/member       0.56s

JS 202KB(brotli) · 폰트 100KB · CSS 14KB     ← 전부 정상. 손댈 것 없다.
이미지: 엣지 캐시 HIT, 170ms                  ← 정상.
```

**병목은 100% HTML TTFB 다.** JS 도 이미지도 아니다. 원인 3개:

**① 공개 라우트 7개가 전부 `force-dynamic` → CDN 캐시가 0**

응답 헤더가 `cache-control: private, no-cache, no-store` 다. 매 요청이
오사카 엣지 → 버지니아 함수 → RDS 를 왕복한다 (`x-vercel-id: kix1::iad1::…`).
한국 방문자에게는 그 지리적 왕복이 통째로 TTFB 다.

**여기서 결정적인 사실 — 무효화 배선이 이미 전부 되어 있다.**

```
_actions/panels.ts        revalidatePath('/')  ·  ('/admin')     × 5곳
_actions/rockets.ts       revalidatePath('/rocket') · ('/rocket/[slug]', 'page')
_actions/rocket-series.ts 같음
_actions/members.ts       revalidatePath('/member')
_actions/landing.ts       revalidatePath('/', 'layout')
_actions/scene.ts         revalidatePath('/') · ('/rocket') · ('/rocket/[slug]', 'page')
```

`rockets.ts:212` 주석이 그대로 적어 두었다 — *"지금은 force-dynamic 이라 즉시 반영되지만,
ISR 로 바꿀 때를 대비해 배선해 둔다."* **그때가 지금이다.**

CLAUDE.md 의 지뢰 *"ISR 로 공개 여부를 감싸지 말 것"* 은 **시간 기반** revalidate 를 두고
`published=false` 가 그 시간만큼 계속 보이는 것을 경고한 것이다. 온디맨드 무효화가
mutation 마다 걸려 있으면 그 창이 닫힌다.

**할 일 ①**

| 라우트 | 지금 | 바꿀 값 | 근거 |
|---|---|---|---|
| `/` | `force-dynamic` | `revalidate = false` (온디맨드 전용) | 패널·카피 변경은 전부 `_actions` 를 지난다 |
| `/member` | `force-dynamic` | `revalidate = false` | `members.ts` 가 `/member` 를 무효화한다 |
| `/rocket`, `/rocket/[slug]` | `force-dynamic` | `revalidate = false` | `rockets`·`rocket-series`·`scene` 셋 다 배선됨 |
| `/posts` | `force-dynamic` | **`revalidate = 60`** | 상류(ESSENTIA)가 **우리 밖에서** 글을 쓴다. 무효화 신호가 우리에게 오지 않으므로 시간 기반이 유일한 방법이다 |
| `/posts/[id]` | `force-dynamic` | **`revalidate = 300`** | 같은 이유. 상세는 수정 빈도가 더 낮다 |
| `/posts/legacy/[slug]` | `force-dynamic` | `revalidate = false` | 고정 아카이브다. 늘지도 바뀌지도 않는다 |

- `/rocket` 은 `searchParams`(`?series=`)를 읽는다. Next 16 에서 searchParams 를 읽는
  세그먼트가 어떻게 캐시되는지 **실제로 확인하고** 결정해라. 캐시가 안 붙으면
  시리즈를 쿼리에서 경로 세그먼트로 옮기는 건 §7(라우트 개편) 일이므로 **여기서는 하지 말고
  현상 유지 + 보고**한다.
- **`revalidate = false` 로 바꾼 뒤 반드시 §1.4 의 죽은 포트 빌드를 돌린다.**
  프리렌더가 살아나면 빌드가 DB 를 필수 의존성으로 갖게 된다 — 그게 이 저장소가 이미 한 번
  밟은 지뢰다(`/rocket` 주석 참조).
- 무효화가 안 걸린 mutation 이 하나라도 있으면 그 화면은 영원히 낡는다.
  **`_actions/**` 를 전수로 훑어 `revalidatePath` 누락을 찾고, 있으면 고치지 말고 보고해라**
  (그 파일들은 A4 가 만졌다).

**② `icaros.kr` → `www.icaros.kr` 307 리다이렉트 = 0.25s**

그런데 더 나쁜 것은 이거다:

```
src/app/layout.tsx:22    metadataBase: new URL('https://icaros.kr')
src/app/layout.tsx:27    url: 'https://icaros.kr'
src/app/(public)/page.tsx:82   url: 'https://icaros.kr'
```

**canonical·OG URL 전부가 리다이렉트되는 주소를 가리키고 있다.** 검색엔진과 SNS 크롤러가
매번 한 번 더 튕긴다.

**할 일 ②** — 두 갈래다. **사람이 골라야 한다:**
- (가) Vercel 대시보드에서 **apex(`icaros.kr`)를 primary** 로 바꾼다 → 코드 변경 0.
- (나) 코드의 세 곳을 `https://www.icaros.kr` 로 통일한다 → 대시보드 변경 0.

에이전트는 **(나)를 구현하되 커밋하지 말고 diff 만 보고**한다. 어느 쪽이 정답인지는
도메인 소유자가 정할 일이다. 한쪽만 고치면 불일치가 유지된 채 시간만 간다 —
CLAUDE.md 의 "자격증명 불일치는 어느 쪽이 정답인가를 먼저 정할 것"과 같은 종류다.

**③ 콜드 스타트 1.81s**

①을 하면 대부분의 요청이 함수에 닿지 않으므로 **사용자에게 보이지 않게 된다.**
별도 작업 없음. ①의 부수 효과로 처리한다.

**기대치** — 웜 TTFB 550ms → 엣지 캐시 히트 시 **80ms 내외**. 콜드 1.8s 는 사용자 경로에서 사라짐.

**하지 말 것** — 함수 리전 변경 금지. RDS 가 us-east-1 이라 `icn1` 로 옮기면 쿼리마다
태평양을 건넌다. 이미지 `deviceSizes`·`imageSizes` 도 건드리지 마라 — D26 에서 계산해 줄인 값이다.

---

#### A6 실제 결과 (2026-09-06 실행 후, A7 검수로 확인) — **위 표는 7개 전부를 전제했고, 3개만 됐다**

| 라우트 | 계획 | **실제** | 왜 |
|---|---|---|---|
| `/rocket/[slug]` | `revalidate = false` | ✅ `revalidate = false` + `generateStaticParams(): []` | |
| `/posts/[id]` | `revalidate = 300` | ✅ `revalidate = 300` + `generateStaticParams(): []` | |
| `/posts/legacy/[slug]` | `revalidate = false` | ✅ `revalidate = false` + `generateStaticParams(): []` | |
| `/` | `revalidate = false` | ❌ **`force-dynamic` 유지** | 프리렌더가 `getSiteContent()` 를 부른다 → 죽은 포트 빌드가 `ECONNREFUSED` 로 exit 1 |
| `/member` | `revalidate = false` | ❌ **`force-dynamic` 유지** | 같음. `listMembers()` 가 빌드 시점에 나간다 |
| `/rocket` | `revalidate = false` | ❌ **`force-dynamic` 유지** | `searchParams`(`?series=`) + `generateMetadata` 가 await 전에 `listRocketSeries()` 를 부른다 |
| `/posts` | `revalidate = 60` | ❌ **`force-dynamic` 유지** | `searchParams`(`?page=`) |

**계획이 틀렸던 지점은 셋이다. 셋 다 이 문서를 쓸 때 몰랐던 사실이다.**

1. **`revalidate` 만으로는 캐시 대상이 되지 않는다.**
   동적 세그먼트가 있는 라우트는 **`generateStaticParams()` 가 있어야** 빌드 표에서 `● (SSG)` 가 된다.
   없으면 `revalidate` 를 무엇으로 두든 `ƒ (Dynamic)` 으로 남고 **엣지 캐시가 0**이다.
   빈 배열(`return []`)이면 충분하다 — 프리렌더되는 페이지는 0개이고, 실제 slug 는 첫 요청에
   렌더돼 ISR 캐시에 들어간다(`dynamicParams` 기본값 true). **그 안에서 DB 를 읽으면 안 된다** —
   읽는 순간 배포 빌드가 RDS 도달성을 필수로 요구한다.
   → 이 문서의 §3 A6 표에는 이 조건이 **한 글자도 없었다.** 표대로만 했으면 세 라우트도 안 됐다.

2. **동적 세그먼트가 없는 라우트(`/`·`/member`)에는 그 우회가 없다.**
   `revalidate` 를 주면 빌드 시점에 반드시 한 번 프리렌더되고 그 안의 DB 조회가 그대로 나간다.
   실측: `DATABASE_URL=postgres://x@127.0.0.1:1/x npm run build`
   → `Error occurred prerendering page "/"` · `Failed query: select "key","value" from "icaros"."site_settings"` · exit 1.
   **배포 빌드를 RDS 도달성에 묶지 않는다는 규칙(D27)이 TTFB 보다 위다.** 그래서 되돌렸다.

3. **`searchParams` 를 읽는 세그먼트는 캐시되지 않는다** (`/rocket`·`/posts`).
   정적 생성 중 `await searchParams` 가 동적 렌더로 빠지므로 `revalidate` 값은 무의미하다.
   `/rocket` 은 더 나쁘다 — `generateMetadata` 가 **searchParams 를 await 하기 전에**
   `listRocketSeries()` 를 부르므로 동적 탈출 전에 DB 왕복이 먼저 나가고, 죽은 포트 빌드가 실패한다.
   문서의 "실제로 확인하고 결정해라"는 `/rocket` 에만 붙어 있었지만 **`/posts` 도 같은 이유로 막혔다.**

**남은 길** (둘 다 이 문서 밖 → §7):
- `/`·`/member`: (가) 빌드 타임 실패를 흡수 → **배포 직후 빈 랜딩이 캐시에 박힌다**(현재 거부).
  (나) `cacheComponents`(PPR)로 셸/데이터를 갈라 캐시 — 라우트 전반의 Suspense 재설계.
- `/rocket`·`/posts`: 시리즈·페이지를 쿼리에서 경로 세그먼트로 옮긴다(`/rocket/series/[series]`).

**②(도메인)의 실제 결과** — 에이전트는 지시대로 (나)를 구현해 `www` 로 통일했다(`3d862a6`).
그 뒤 **사람이 (가)로 뒤집었다** — apex(`icaros.kr`)를 정식으로 정하고 코드를 apex 로 되돌렸다.
따라서 **코드가 옳고 리다이렉트 방향이 틀린 상태**이며, 남은 일은 코드가 아니라
**Vercel 대시보드에서 apex 를 primary 로 돌리는 것**이다. 그때까지 canonical·OG 는 계속 307 을 탄다.

---

## 4. 웨이브 3

### A7 — 검수·회귀

**소유 파일** — 없다. 읽기만 한다. 고칠 것이 나오면 해당 에이전트에게 되돌린다.

**할 일**

1. `npm run typecheck` · `npm run lint` — 둘 다 0.
2. 죽은 포트 빌드 (§1.4) — 통과.
3. **삭제 회귀 점검** — A1·A2·A3 이 지운 요소의 CSS 클래스가 고아로 남아 있지 않은지
   각 `.module.css` 를 대조한다. `Section.module.css` 의 헤더 그리드처럼 **칸 수를 전제한
   레이아웃**이 있으면 남은 요소가 어긋난다.
4. **접근성 회귀** — A1 이 지운 것 중 `aria-hidden="true"` 였던 것은 원래 보조기술에
   안 나갔다(`Scroll`, 섹션 번호, 인원수). 즉 **삭제로 잃는 정보가 없음**을 확인하고 적는다.
   반대로 `Crew`·`Fleet`·`Posts` 아이브로는 실제 텍스트였다 — 바로 아래 `<h1>` 이 같은 정보를
   더 정확히 준다는 것을 확인한다.
5. **`/posts` 상류 장애 경로 확인** — A3 이 지운 문구가 `communityUnavailable` 분기의
   안내와 섞이지 않았는지 코드로 확인.
6. **프리뷰 배포 확인 목록을 사람에게 넘긴다** (로컬에서 DB 를 못 읽으므로 자동화 불가):
   - 랜딩에서 `Track 01/02`·`Scroll`·섹션 번호가 사라졌는가
   - `/member` 분과 밑 숫자, `/rocket` `Fleet`·시리즈 탭 숫자가 사라졌는가
   - `/posts` 상단에 인스타 링크가 뜨고 실제로 계정으로 가는가
   - `/admin` 패널 편집에서 **새 사진 업로드 → 초점 찍기 → 저장**이 한 번에 되는가
   - 영상 패널을 하나 만들어 자동재생·루프·초점이 맞는가, 모바일에서 소리 없이 도는가
   - 각 페이지 `curl -w '%{time_starttransfer}'` 로 TTFB 재측정 (기준선은 §A6 표)

---

## 4.5 웨이브 4

### A8 — `/`·`/member` 캐시 전환 (A6 가 되돌린 것의 후속)

**소유 파일**

```
src/app/(public)/page.tsx
src/app/(public)/member/page.tsx
src/app/(public)/member/_data.ts
src/app/api/revalidate/route.ts        ← 신설
src/app/api/cron/storage/route.ts
scripts/smoke.ts
.env.example
```

#### 무엇이 실제로 됐나 — 죽은 포트 빌드 라우트 표

`DATABASE_URL=postgres://x@127.0.0.1:1/x DB_AUTH=password npm run build` → **exit 0**

```
Route (app)               Revalidate  Expire
┌ ○ /                             1m      1y      ← ƒ 였다
├ ○ /_not-found
├ ƒ /admin
├ ƒ /api/cron/storage
├ ƒ /api/media/[id]
├ ƒ /api/revalidate                                ← 신설
├ ƒ /api/upload/confirm
├ ƒ /api/upload/presign
├ ○ /member                       1m      1y      ← ƒ 였다
├ ƒ /posts
├ ● /posts/[id]
├ ● /posts/legacy/[slug]
├ ƒ /rocket
└ ● /rocket/[slug]
```

응답 헤더(로컬 `next start`, DB 를 죽인 채 실측):
`Cache-Control: s-maxage=60, stale-while-revalidate=31535940` · `x-nextjs-cache: HIT` ·
`x-nextjs-prerender: 1`. 즉 **엣지가 실제로 캐시한다.**

#### 1. 로더를 fail-safe 로 — 벽을 없앤 게 아니라 벽을 넘어가지 않게 했다

A6 의 벽은 그대로다. `/`·`/member` 는 동적 세그먼트가 없어 `revalidate` 를 주는 순간 빌드가
**반드시 한 번 프리렌더**하고, `generateStaticParams(): []` 우회는 동적 세그먼트 전용이라 못 쓴다.
바꾼 것은 그 프리렌더가 **실패해도 빌드를 죽이지 않게** 만든 것이다.

| 로더 | 어디 | 전 | 후 | 실패하면 화면 |
|---|---|---|---|---|
| `getSiteContent` | `/` 본문 + `generateMetadata` | throw | **`getSiteContentSafe`** | 카피가 전부 빈 값. 섹션은 각자의 `has*Content()` 술어에 걸려 통째로 빠진다 |
| `loadSections` | `/` (page.tsx 내부) | throw | **try/catch → `[]`** | 섹션 0개 |
| `getLandingPanelsSafe` | `/` | 이미 safe | 그대로 | 패널 0개 |
| `listMembers` | `/member` | throw | **`listMembersSafe()`** 신설 | "공개된 부원이 아직 없습니다." |
| `getSiteContent` | `Header`·`Footer` (**소유 파일 밖 — 아래 참조**) | throw | **`getSiteContentSafe`** | 내비 라벨은 `getNavItems` 의 코드 기본값, 푸터 저작권 줄은 빔 |

**`Header`·`Footer` 가 진짜 벽이었다.** 둘은 `(public)/layout.tsx` 에 있어 `/`·`/member` 의
프리렌더에 같이 들어간다. 페이지 쪽 로더를 아무리 방어해도 이 둘이 던지면 빌드는 그대로 죽는다 —
실측: `Error occurred prerendering page "/"` · `Failed query: select "key","value" from
"icaros"."site_settings"` · exit 1. A6 의 "실제 결과" 표가 원인을 `getSiteContent()` 라고만
적어 둔 것은 절반만 맞았다. **호출부가 5곳이고 그중 2곳이 레이아웃에 있다**가 전부다.

#### 2. `revalidate = 60` — 시간은 백스톱이지 신호가 아니다

CLAUDE.md 지뢰 *"ISR 로 공개 여부를 감싸지 말 것"* 은 **시간이 유일한 무효화 신호일 때**를 경고한다.
여기서는 아니다 — 공개 여부를 바꾸는 경로가 전부 `_actions` 를 지나고 거기 무효화가 걸려 있다.
60초는 "아무도 아무것도 저장하지 않았을 때의 상한"이고, 그 상황에서는 바뀐 것도 없다.

**그럼 왜 `revalidate = false`(온디맨드 전용)가 아닌가.** 아래 §4 의 빈 프리렌더가 **영구히**
박히기 때문이다. 웹훅이 조용히 실패하는 날 빈 랜딩이 캐시에 영원히 남는다.
60초는 그 하나를 위해 있다. 웹훅과 시간은 대체재가 아니라 이중화다.

**기존 `_actions/**` 배선이 실제로 이 라우트를 비우는지 확인했다** (로컬 `next start` 실측):

| 호출 | 타입 | 결과 |
|---|---|---|
| `revalidatePath('/')` — `panels.ts`×5·`scene.ts` | 기본 `'page'` | 다음 요청 `x-nextjs-cache: MISS` → **비운다** |
| `revalidatePath('/member')` — `members.ts`×3 | 기본 `'page'` | 다음 요청 `MISS` → **비운다** |
| `revalidatePath('/', 'layout')` — `landing.ts` | `'layout'` | 다음 요청 `MISS` → **비운다** |

`'page'` 로도 충분하다는 것이 실측 결과다. 다만 `landing.ts` 만 `'layout'` 인 것은 **옳다** —
`site_settings` 는 루트 레이아웃(Header·Footer·SEO)이 읽고, 그 값은 `/`·`/member` 를 넘어
모든 라우트의 껍데기에 들어간다. `'page'` 로 바꾸지 말 것.

무효화는 **purge 다(mark-stale 이 아니다)**. 부른 직후 첫 요청이 `MISS` 로 잡히고 그 요청이
DB 를 읽어 새로 렌더한다. 그래서 **stale 을 보는 방문자가 0명**이다 — 아래 창 계산의 근거다.

#### 3. `POST /api/revalidate` (신설)

배포 성공 웹훅이 친다. 하는 일은 `revalidatePath('/', 'layout')` 한 줄.

**인증 두 갈래. 둘 다 상수시간(`timingSafeEqual`), 둘 다 fail-closed.**

| 갈래 | 헤더 | 시크릿 | 쓰는 곳 |
|---|---|---|---|
| Bearer | `Authorization: Bearer …` | `REVALIDATE_SECRET` | CI(GitHub Actions)·curl |
| HMAC | `x-vercel-signature` (본문 HMAC-SHA1 hex) | `VERCEL_WEBHOOK_SECRET` | **Vercel 대시보드 웹훅** |

- **`CRON_SECRET` 을 재사용하지 않는다.** `CRON_SECRET` 은 Vercel 이 cron 요청에 자동으로
  실어 주는 값이라 우리 인프라 밖으로 나갈 일이 없다. 이 훅의 비밀은 **반대로** 파이프라인에
  사람이 붙여 넣어야 한다. 그리고 권한 크기가 다르다 — 이 훅이 새면 최악이 "캐시가 한 번 더
  지워진다"이지만 `CRON_SECRET` 이 새면 `/api/cron/storage` 를 통한 **S3 객체 삭제**가 열린다.
  하나로 묶으면 약한 쪽의 유출이 강한 쪽의 권한이 된다.
- **HMAC 갈래가 필요한 이유:** Vercel 대시보드 웹훅은 **커스텀 헤더를 붙일 수 없다.**
  Bearer 만 받으면 "대시보드에서 웹훅을 연결한다"가 애초에 불가능하다.
- **시크릿이 둘 다 없으면 503** (`not_configured`). 401 이 아닌 이유: "시크릿이 틀렸다"와
  "시크릿을 안 넣었다"가 구별되어야 한다. 이 설계의 유일한 실패 모드가 "훅이 조용히 안 온다"이므로
  로그에 그 둘이 같은 줄로 남으면 안 된다.
- `payload.target` 이 **명시적으로** `production` 이 아니면 건너뛴다(프리뷰 배포가 프로덕션
  캐시를 흔들지 않게). 본문이 없거나 모양을 모르면 무효화하는 쪽으로 넘긴다 — curl 한 줄이 막히면
  훅이 있으나 마나가 된다.
- 성공·실패를 전부 `[revalidate]` 접두사로 로그에 남긴다.

실측(로컬 `next start`):

```
인증 없음                   401
잘못된 Bearer               401
GET                         405
올바른 Bearer               200  {"revalidated":true,...}   → 직후 / 가 MISS
target=staging              200  {"revalidated":false,"reason":"not-production"}
올바른 HMAC 서명            200  {"revalidated":true,...}
변조된 서명                 401
시크릿 미설정 + 올바른 Bearer  503  {"error":"not_configured"}
```

#### 4. 빈 화면이 캐시에 박히는 창 — 실제 크기

전제: 빌드 컨테이너가 RDS 에 닿지 못하면 프리렌더가 **빈 랜딩·빈 명단**을 만들어 그것이
그 배포의 캐시 초기값이 된다. (닿으면 진짜 데이터가 프리렌더된다 — 어느 쪽인지는 배포해 봐야
안다. 첫 배포 뒤 `npm run smoke` 가 그 답을 준다.)

| 경우 | 빈 화면을 보는 방문자 |
|---|---|
| 웹훅이 정상 동작 | **0명** (엄밀히는 배포 승격 ~ 훅 도착 사이 몇 초). 무효화가 purge 라 첫 요청이 `MISS` → 그 요청이 DB 를 읽어 렌더한다 |
| 웹훅이 실패 | **최대 60초 + 백그라운드 재생성 1회분.** `s-maxage=60` 이 지나면 엣지가 stale 을 내주면서 뒤에서 다시 굽는다(SWR). 그 렌더가 끝나면 진짜 데이터로 바뀐다 |
| 웹훅도 없고 `revalidate = false` 였다면 | **영구.** 누가 `/admin` 에서 뭔가 저장할 때까지. ← 이것이 A6 이 "지금은 받아들일 수 없다"고 적은 그 상태이고, 60초가 그것을 사는 값이다 |

리전마다·배포마다 한 번씩이다. 그래서 **웹훅은 속도를, 60초는 안전을, 스모크는 관측을** 맡는다.

#### 5. `/api/cron/storage` 에 무효화 추가

정리 cron 이 실제로 지운 것이 있을 때만(`cleaned.completed + swept.orphansFound +
swept.unattachedReclaimed > 0`) `revalidatePath('/', 'layout')` 을 부른다.

원래 이 cron 이 지우는 것은 "어디서도 참조되지 않는" media 라 화면이 바뀔 리 없다.
**그 전제가 깨진 적이 있다** — `MEDIA_FK_COLUMNS` 에 `page_panels` 가 빠져 살아 있는 랜딩 사진
4장을 지웠다(D28). `force-dynamic` 이던 시절에는 "다음 요청부터 깨진 이미지"로 끝났지만
캐시가 붙은 지금은 **지워진 사진을 가리키는 HTML 이 캐시에 남는다.** `/`·`/member` 는 60초
백스톱이 낫게 하지만 `/rocket/[slug]`·`/posts/legacy/[slug]` 는 `revalidate = false` 라
**영원히 낫지 않는다.** 그래서 여기서 한 번 비운다.

어느 화면이 그 media 를 썼는지 따지지 않는다 — 그걸 세는 순간 D28 과 같은 종류의 횡단 목록이
하나 더 생긴다. 하루 한 번 돌고 평소 0건이라 비용도 없다.

#### 6. `npm run smoke` 에 본문 검사 — 이 설계의 안전망

`/`·`/member` 는 이제 **200 이면서 비어 있을 수 있다.** 헤더·푸터·폰트까지 정상이고 가운데만
없다. 상태 코드로도 사람 눈으로도 안 잡힌다.

| 경로 | 판정 | 근거 |
|---|---|---|
| `/` | `data-scrim=` **또는** `aria-labelledby=` 가 1개 이상 | 랜딩은 두 모양 중 하나로만 성립한다 — 사진 패널(`Panel.tsx` 전용 속성)이거나 레거시 섹션(`Section.tsx`·`Hero.tsx` 전용). 둘 다 없으면 그린 것이 하나도 없다 |
| `/member` | `data-reveal-item="` 1개 이상 | `MemberCard` 한 장당 하나. 명단이 비면 사라진다 |

전부 **서버 컴포넌트가 내보내는 평범한 HTML 속성**이다. CSS Modules 해시 클래스명은 빌드마다
바뀌어 못 쓰고, 카피 문자열은 팀이 `/admin` 에서 바꾸므로 못 쓴다.

밟은 함정 둘:
- 처음에 `data-section-theme=` 을 골랐다가 걸렀다. **루트 레이아웃의 `Loader` 가 그 속성을 모든
  페이지에 항상 하나 내보낸다** — 빈 랜딩도 통과했다.
- `=` 를 붙여 검사한다. `<noscript>` 안의 리빌 해제 CSS 가 `[data-reveal-item]` 처럼 **속성
  선택자**로 같은 이름을 적어 둔다. `=` 가 없으면 빈 화면이 통과한다.

스모크가 `?smoke=<ts>` 를 붙이는 것은 **엣지 캐시**를 비끼려는 것이고 **ISR 캐시는 못 비낀다** —
프리렌더 엔트리는 쿼리가 아니라 경로로 키가 잡힌다. 실측: `/?smoke=1` → `x-nextjs-cache: HIT`.
검사가 "캐시에 박힌 빈 화면"을 볼 수 있는 것이 그 덕이다.

실측(DB 를 죽인 채 로컬 서버에 스모크를 돌린 결과) — 검사가 없었으면 둘 다 조용히 통과했다:

```
✗ DB  200      4ms  /        랜딩 — 본문이 비었다 — data-scrim= / aria-labelledby= 중 아무것도 없음
✗ DB  200      4ms  /member  멤버 — 본문에 "data-reveal-item=" 없음
```

#### 7. 사람이 해야 할 것 — 이게 없으면 배포돼도 훅은 안 돈다

**(A) 시크릿 만들기**

```bash
openssl rand -hex 32      # 이 값을 REVALIDATE_SECRET 으로 쓴다
```

**(B) Vercel 환경변수** — 대시보드 → 프로젝트 → Settings → Environment Variables

| 이름 | 값 | 환경 |
|---|---|---|
| `REVALIDATE_SECRET` | (A)의 값 | Production (필요하면 Preview 도) |

넣지 않으면 `POST /api/revalidate` 는 **503 으로 닫혀 있다.** 사이트는 정상 동작하고 60초
백스톱만 남는다 — 즉 "안 넣으면 조용히 열리는" 실패는 없다.

**(C) 훅을 실제로 쏘게 하기. 둘 중 하나만 하면 된다.**

*(C-1) Vercel 대시보드 웹훅 — 코드·CI 없이 대시보드만*

1. Vercel → Team Settings → **Webhooks** → Create Webhook
2. Endpoint: `https://icaros.kr/api/revalidate`
3. Events: **Deployment Succeeded** (`deployment.succeeded`)
4. Projects: `icaros-web` 만 선택
5. 만든 직후 **한 번만** 보여 주는 시크릿을 복사한다
6. 그 값을 Vercel 환경변수 **`VERCEL_WEBHOOK_SECRET`** (Production) 으로 넣는다
7. 다음 배포 후 Vercel 로그에서 `[revalidate] '/' 이하 캐시를 비웠다 (target=production)` 을 확인한다

> 대시보드 웹훅은 커스텀 헤더를 못 붙이므로 `REVALIDATE_SECRET` 이 아니라 이 서명 경로를 탄다.
> 프리뷰 배포도 같이 오지만 `target` 이 production 이 아니면 스스로 건너뛴다.

*(C-2) GitHub Actions — 대시보드 웹훅을 못 쓰거나 안 쓸 때*

1. GitHub → 저장소 → Settings → Secrets and variables → Actions → New repository secret
   - 이름 `REVALIDATE_SECRET`, 값은 (A)와 **같은 값**
2. 워크플로 파일 하나를 추가한다 (이 저장소에는 아직 없다 — 사람이 만든다):

```yaml
# .github/workflows/revalidate.yml
name: revalidate after deploy
on:
  deployment_status:
jobs:
  ping:
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production'
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS -X POST https://icaros.kr/api/revalidate             -H "Authorization: Bearer ${{ secrets.REVALIDATE_SECRET }}"             --fail-with-body
```

**(D) 확인**

```bash
npm run smoke        # / 와 /member 가 본문 검사까지 통과하는지
```

`/` 나 `/member` 가 "본문이 비었다"로 잡히면 훅이 안 온 것이다. Vercel 로그에서 `[revalidate]`
를 찾아 (C) 를 다시 본다. 60초 뒤 다시 돌려서 통과하면 백스톱만 살아 있는 상태다.

**(E) 아직 남아 있는 대시보드 일 (W4 와 무관, §3 A6 ②에서 넘어온 것)**
apex(`icaros.kr`)를 primary 로 돌리는 것. 코드는 이미 apex 를 가리킨다.

#### 8. 하지 않은 것

- **`/rocket`·`/posts` 는 그대로 `force-dynamic`.** `searchParams`(`?series=`·`?page=`)는
  fail-safe 로 풀리는 문제가 아니다 — 정적 생성 중 `await searchParams` 가 동적 렌더로 빠진다.
  쿼리를 경로 세그먼트로 옮기는 라우트 개편이 필요하고 그건 §7 이다.
- **`src/lib/content.ts` 는 건드리지 않았다.** `getSiteContent`(throw)는 그대로 남는다 —
  `/posts` 가 여전히 그것을 쓰고, 그 라우트는 캐시 대상이 아니라 던지는 편이 옳다.
- **cacheComponents(PPR) 로 가지 않았다.** 라우트 전반의 Suspense 재설계가 필요하고,
  이 작업의 목표(TTFB)는 그것 없이 달성된다.

---

## 5. 커밋

웨이브당 1개. Claude/AI 흔적을 **넣지 않는다** (CLAUDE.md).

```
w1  랜딩·멤버·기체·포스트에서 장식 텍스트를 걷어내고 포스트에 인스타 링크를 붙인다
w2  패널 영상 업로드·재생 경로 · 공개 라우트를 온디맨드 무효화 기반 캐시로 전환
w3  (필요 시) 검수에서 나온 회귀 수정
w4  홈·멤버를 fail-safe 로더 + 60초 백스톱 캐시로 전환하고 배포 훅·스모크 본문 검사를 붙인다
```

---

## 6. 코드가 아니라 `/admin` 에서 사람이 할 것 (요구 8번의 나머지)

에이전트가 못 한다 — DB 값이다. 5분이면 끝난다.

| 어디 | 지금 값 | 왜 |
|---|---|---|
| `/admin?tab=landing` → Donate → 인용구 | `Every donation brings the next flight closer.` | 전형적인 LLM 슬로건. 실제 문장으로 바꾸거나 비운다 |
| `/admin?tab=panels` → 2번 패널 헤드라인 | `control is the harder half.` | 소문자 + 마침표 카덴스가 LLM 문장이다 |
| `/admin?tab=panels` → 각 패널 아이브로 | `Track 01 · Solid Rockets` 등 | A1 이 렌더를 지우면 화면에서는 사라진다. **값도 비워 두면** 나중에 렌더를 되살려도 안전하다 |

---

## 7. 이 문서 밖 — DB 가 필요해서 뺀 것

착수 순서대로. 각 항목은 **왜 DB 가 필요한지**까지 적어 둔다.

| # | 요구 | 필요한 DB 작업 | 견적 |
|---|---|---|---|
| 6 | 후원 차수 (`1–3차`) | `site_settings` 에 `donation.round_label` **행 1개 INSERT**. 마이그레이션은 아니지만 행이 없으면 `saveLandingCopyAction` 이 `RowsMissing` 으로 **전체 저장을 거부**한다(`_actions/landing.ts` — 잘린 폼이 카피를 날리는 걸 막는 장치다). 코드(카탈로그 필드 + `Donate.tsx` 렌더)는 30분 | 1h |
| 3 | 멤버 개인 소개글 | `members.bio_md` 컬럼 추가 | 반나절 |
| 7 | VEHICLES 개편 | `vehicle_types` 테이블 + `rocket_series.type_id` FK + `rocket_series.description_md`. 추가로 `page_panels_cta_href_ck` **CHECK 제약**이 `'/rocket'` 을 박고 있어 `PANEL_CTA_HREFS` 를 코드에서만 바꿀 수 없다 | 2일 |
| 4 | 포스트 쓰기 | DB 아님 — **`ESSENTIA_SERVICE_TOKEN` 대기.** 계약은 `DECISIONS.md` D25 에 전부 있다(`X-Service-Token`, `POST /api/forum/posts`) | 4~6h (토큰 후) |
| 9 | 포스트 PDF·영상 | `post_attachments` 원장 테이블. ESSENTIA 본문은 **원격**이라 `hasReferences()` 가 첨부를 못 본다 → 정리 cron 이 지운다. **D28 재발 경로다** | 1.5일 (4번 후) |

---

## 8. 이 문서를 만들며 확인한 사실 (재조사 금지)

- `page_panels.eyebrow` 는 `scripts/seed-panels.ts:97,111` 이 넣은 `Track 01 · Solid Rockets` /
  `Track 02 · UAV / VTVL` 이다. 화면의 그 글자가 맞다.
- `lib/panels.ts` 는 `credit: null` 을 하드코딩한다. `Panel.tsx` 의 credit 렌더는 죽은 코드다.
- 패널 **삭제·순서변경·공개토글은 이미 구현되어 있다.** 없는 것은 업로드뿐이다.
- 모든 admin mutation 에 `revalidatePath` 가 **이미 배선되어 있다.** ISR 전환을 예상하고 미리 넣어 뒀다.
- `media.mime`·`entity_type` 에 CHECK 가 없고, `media_key_prefix_ck` 는 폴더 세그먼트를 보지 않는다.
  → 영상 업로드에 마이그레이션이 필요 없다.
- 프로덕션은 `www.icaros.kr` 에서 서비스되고 `icaros.kr` 은 307 이다. 코드의 metadataBase·OG 는
  `icaros.kr` 을 가리킨다.
  → **결론(2026-09-06):** apex 를 정식으로 정했다. 코드는 apex 그대로 두고 **대시보드를 바꾼다.**
- 페리지·이노스페이스 모두 순수 `<video muted loop playsinline>` + `object-fit: cover` 다.
  라이브러리 없음. 이노스페이스 소스는 854×480.
- `npm run db:tunnel`(SSM 포트포워딩)로 로컬에서 RDS 에 붙을 수 있다 — §C4 는 08-28 해결됐다.
  단 이 문서의 작업에는 필요 없다.

### 실행하면서 새로 확인한 것 (2026-09-06, 계획에 없던 사실)

- **`revalidate` 는 그 자체로 라우트를 캐시 대상으로 만들지 못한다.** 동적 세그먼트가 있는
  라우트는 `generateStaticParams()` 가 있어야 빌드 표에서 `● (SSG)` 가 된다. 빈 배열이면 충분하고,
  없으면 `ƒ (Dynamic)` 으로 남아 **엣지 캐시가 0**이다. → §3 A6 "실제 결과" 1번.
- **동적 세그먼트가 없는 라우트에는 그 우회가 없다.** `revalidate` 를 주는 순간 빌드가
  프리렌더하고 DB 를 친다. `/`·`/member` 가 여기서 막혔다(죽은 포트 빌드 exit 1 실측).
- **`searchParams` 를 읽는 세그먼트는 캐시되지 않는다.** `/rocket`(`?series=`)·`/posts`(`?page=`)
  둘 다. 계획은 `/rocket` 만 의심했지만 `/posts` 도 같은 이유였다.
- `media.mime` 은 `page_panels` 에 종류 컬럼을 더하지 않고 사진/영상을 가르는 값으로 쓸 수 있다.
  대신 `getLandingPanels()` 가 `media.width`/`height` 중 하나라도 null 이면 그 패널을 **조용히
  버리므로**, 영상은 브라우저가 `<video>` 메타데이터에서 치수를 읽어 실어 보내야 한다.
- `confirmUpload` 은 매직 넘버로 내용을 검증한다(`sniffMime`). **mp4 판정을 같이 넣지 않으면**
  업로드가 성공한 것처럼 보이다가 확정 단계에서 객체가 지워진다. ISO BMFF 는 선두 4바이트가
  박스 크기라 `ftyp` 는 offset 4 다.
- `MAX_BYTES_BY_FOLDER` 에 새 폴더를 빠뜨리면 `confirmUpload` 의 `folderMax` 가 `0` 이 되어
  **그 종류의 확정이 전건 거부**된다. `KEY_FOLDERS` 만 늘리고 여기를 빼먹기 쉬운 자리다.
- `lib/s3/media-references.ts` 의 `MEDIA_FK_COLUMNS` 에 `page_panels.media_id` 가 **이미 있다**
  (D28 사고 후 추가). 영상도 같은 FK 를 타므로 정리 cron 이 살아 있는 영상을 지우지 않는다.
- `/api/cron/storage` 는 `media` 를 지우면서 `revalidatePath` 를 부르지 않는다. 지금은 `/` 가
  `force-dynamic` 이라 무해하지만, **`/` 를 캐시하는 순간 지워진 사진이 캐시에 남는다.**
  §3 A6 "남은 길"을 실행할 때 같이 볼 것.
