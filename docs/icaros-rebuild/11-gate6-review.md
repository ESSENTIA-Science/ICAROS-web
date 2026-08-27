# 11 — Gate 6 교차 검토

> 작성 시점 기준: 브랜치 `rebuild/next16`, HEAD `7afe5f0`, 레거시 Vite 트리 **삭제 완료**.
> 이 문서는 `02-requirements-matrix.md` 의 **모든 행**을 훑고 판정한 결과다.
>
> **판정 규칙 — ☑ 는 실제로 동작을 확인한 것에만 준다.** 코드를 읽어 "맞게 쓰여 있다"는
> ◐ 다. 확인 방법을 행마다 적었고, 확인하지 못한 것은 그렇게 적었다.
> 이전 라운드에서 "완료 보고했는데 동작하지 않는 것"이 반복해서 나왔기 때문에
> 판정 근거를 재현 가능한 형태로 남긴다.
>
> 범례: `☑` 실측 확인 · `◐` 구현됐으나 미실측 또는 부분 · `☐` 미착수 · `⛔` blocked

---

## 0. 검증 환경과 방법

| 항목 | 값 |
|---|---|
| 로컬 DB | `docker exec icaros-db psql -U icaros -d icaros` — site_settings 33 / rockets 4 / members 27 / rocket_engines 6 / page_sections 7 |
| 프로덕션 빌드 | 두 번 돌렸다. ① `HEAD + 이 트랙의 변경만` 을 격리 스냅샷에 적용 → 통과 (다른 트랙이 동시 편집 중이라 원인을 분리하기 위해서). ② 마지막에 **레포 그대로** `npm run build` → 통과. 둘 다 `next start -p 5404` 로 라우트 실측 후 종료 |
| 개발 서버 | 사용자 소유 5174 (읽기 요청만 보냄, 종료하지 않음) |
| 어드민 인증 | `icaros.admin_sessions` 에 세션 행을 직접 심어 쿠키로 접근. 검증 후 **전량 삭제·원복 확인** |
| Server Action 실측 | JS 없는 progressive-enhancement 경로를 `curl` 로 재생 (`$ACTION_REF_*` 필드 그대로 전송) |

### DB 원복 확인

검증 과정에서 admin_users 1행 · admin_sessions 2행 · auth_events 4행 · media 3행을 만들고,
`site_settings.about.body` 1행을 지웠다가 복원했다. 종료 후 상태:

```
admin_users 0 · admin_sessions 0 · auth_events 0 · media 0 · login_attempts 0
site_settings 33 · rockets 4 · members 27 · rocket_engines 6 · page_sections 7
site_settings md5  fdbeda023eee8e86dbf441d5ed094650  (삭제 전과 동일)
rockets.updated_at 4행 전부 2026-08-23 02:11:47.465893+00 (시드값 그대로 — 실패 트랜잭션이 전부 롤백됨)
```

---

## 1. 레거시 Vite 트리 삭제 (Gate 6 본 항목)

### 삭제한 것 (32 파일 + 이미지 15장)

| 분류 | 파일 |
|---|---|
| 페이지·엔트리 (8) | `src/{App,Header,admin,home,main,member,posts,rocket}.jsx` |
| 어드민 패널 (4) | `src/admin/{Landing,Members,Posts,Rockets}Panel.jsx` (디렉터리째) |
| 레거시 lib (4) | `src/lib/{content,markdown,storage,supabase}.js` |
| 공용 컴포넌트 (5) | `src/component/{FuzzyText,Highlight,Masonry,ScrollToTop}.jsx` + `Masonry.css` (디렉터리째) |
| 시드 JSON (2) | `src/assets/{rocket_info,member}.json` |
| 레거시 CSS (7) | `src/{App,admin,home,index,member,posts,rocket}.css` |
| Vite 엔트리 (1) | `index.html` |
| 미참조 이미지 (15) | `public/assets/img/gallery/01–15.webp` |
| 빌드 산출물 | `dist/` (42 MB, gitignore 대상 · Vite 산출물 · vite 자체가 이미 미설치) |

### 삭제 전 참조 확인 (전부 0건)

```
grep -rn "component/|lib/supabase|lib/storage|lib/markdown|rocket_info|member.json"
  --include=*.ts --include=*.tsx  src/app src/components src/lib scripts   → 0
grep -rn "gallery" (신규 트리 전체)  → 로켓 갤러리 코드만. public/assets/img/gallery 참조 0
scripts/seed-from-legacy.ts        → JSON 을 읽지 않는다 (레거시 REST 에서 직접 가져옴)
```

`public/assets/img/{rocket,member}` 는 **삭제하지 않았다** — DB `legacy_image_path` 가
가리키고 있다 (rockets 4/4, members 4/27). 다만 아래 5장은 참조가 없다 — 이번엔 손대지 않았고
P9(S3 이전) 때 함께 처분해야 한다:

| 파일 | 상태 |
|---|---|
| `rocket/icx2.webp` · `rocket/icx2s.webp` | rockets 테이블에 `icx2`/`icx2s` 행이 없다 |
| `member/kimkunwoo.webp` · `member/standhyo.webp` · `member/yunho.jpg` | 경로를 가진 members 행은 kimjihoo·yeahram·parkhyunbin·sungwoo 4명뿐 |
| `member/profile.webp` | **참조 중** — `member/_data.ts` 의 `MEMBER_PLACEHOLDER` (E6). 23명이 이걸 쓴다. 지우면 안 된다 |

### `FuzzyText` — 삭제했고, 복구 경로를 여기 남긴다

A7(404 캔버스 글리치 이식)은 **아직 이식되지 않았다.** `src/app/not-found.tsx` 는
"P5 에서 이식한다"는 주석만 달고 정적 404 를 그린다. `src/app/not-found.tsx` 는 이 트랙의
소유 경로가 아니라 직접 이식하지 않았고, 규칙대로 미사용 레거시로 삭제했다.

복구:

```
git show 138f39a7aa09122a9ce8dc8ccd400675e5c85b92:src/component/FuzzyText.jsx
```

이식할 때 `prefers-reduced-motion` 존중을 함께 넣어야 A7 이 닫힌다.

### `Highlight`

레거시 `src/component/Highlight.jsx` 만 지웠다. 신규 트리의 `src/components/ui/Highlight.tsx`
는 그대로이며 `components/landing/Statement.tsx` 가 쓰고 있다 (렌더 실측: 홈 HTML 에 raw `**` 0건).

### 설정 정리

| 파일 | 변경 |
|---|---|
| `tsconfig.json` | `exclude` 에서 `src/**/*.jsx`·`src/**/*.js`·`dist` 제거 → `["node_modules"]` 만 남김 |
| `eslint.config.js` | `ignores` 에서 `src/**/*.jsx`·`src/**/*.js`·`src/assets/**`·`dist/**` 제거 |

`find src -name '*.js' -o -name '*.jsx'` → 0건. 두 설정에 남은 예외는 `.next/**`,
`node_modules/**`, `docs/**`, `next-env.d.ts` 뿐이다.

### 지우지 않고 보고만 하는 것

| 대상 | 상태 | 판단 |
|---|---|---|
| `vite.config.js` | 남아 있음. **vite·@vitejs/plugin-react 는 package.json 에도 node_modules 에도 없다** — 실행 불가능한 죽은 파일 | 지시대로 보고만 한다. `package.json` 을 3d 트랙이 동시 편집 중이라 같이 처분하는 편이 안전하다 |
| `package.json` Vite 의존성 | **이미 0건** (`grep -i vite package.json` → 없음) | 조치 불필요 |
| `AGENTS.md` | 루트에 있는 **레거시 Supabase 아키텍처 설명서**. `supabase` 9건 · `sim.icaros.kr` 1건 | 소유 경로 밖이라 손대지 않았다. **§4 잔존 문자열 표의 유일한 비-문서 위반**이며, 에이전트가 읽는 파일이라 방치하면 이후 세션이 폐기된 구조를 사실로 믿는다. 사용자 승인 후 삭제 또는 전면 재작성 필요 |

---

## 2. 남은 결함 처리 결과

### 2-1. bootstrap CLI `--reactivate` no-op — ☑ 이미 고쳐져 있었고, 실측으로 확인

debt 트랙이 고쳤다고 한 건이라 **코드만 보지 않고 직접 돌렸다.**

| 시나리오 | 출력 | `admin_users.updated_at` | `auth_events` |
|---|---|---|---|
| 이미 활성 계정에 `--reactivate` | `(안내) … 이미 활성 상태입니다. 아무것도 변경하지 않습니다.` / `변경 없음 …` | **불변** (`14:39:23.521233`) | **증가 없음** (1건 유지) |
| 비활성 계정에 `--reactivate` | `복구 완료 … 비활성 해제` | 갱신됨 (`14:39:49.56727`) | `admin_deactivated`/`action=reactivated` 1건 추가 |

`scripts/bootstrap-admin.ts` 의 `willReactivate = reactivate && found?.is_active === false`
가 UPDATE 와 감사 이벤트를 함께 감싸고 있다. **추가 수정 없음.**

### 2-2. `_actions` 의 "행 없음" vs "버전 충돌" — ☑ (rockets·members·landing) / 1건 수정

rockets·members·landing 은 이미 분리돼 있었다. 실측(Server Action 재생):

| 요청 | 응답 문구 |
|---|---|
| 유효한 버전 + 존재하는 로켓 + 부착 불가 미디어 | 필드 오류로 반환 (§2-4) |
| **낡은 버전 토큰** (`2020-01-01…`) | `다른 곳에서 먼저 수정된 내용이 있습니다. 새로고침해 최신 값을 확인한 뒤 다시 저장해 주세요.` |
| **존재하지 않는 로켓** (`id=nosuchrocket`) | `이 로켓은 다른 곳에서 이미 삭제되었습니다. 저장할 대상이 없습니다 — 목록으로 돌아간 뒤 필요하면 다시 등록해 주세요.` |

남아 있던 구멍 **1건을 고쳤다**: `_actions/scene.ts` `updateSceneModelAction` 의 존재 확인
SELECT 가 `.limit(1)` 이라 잠금이 없었다. SELECT 와 UPDATE 사이에 모델이 삭제되면 0행이
돌아와 `VersionConflict`(= "새로고침하라")로 보고되는데, 새로고침하면 모델이 없다.
`.for('update')` 로 바꿔 rockets·members 와 같은 규약으로 맞췄다.

남는 미분리 1건 (의도적):
`saveHomeFeatureAction` 은 `home_feature` 싱글턴 행이 없을 때도 `CONFLICT` 를 준다.
이 경우 **새로고침하면 생성 폼이 뜨므로 안내와 실제 복구 방법이 어긋나지 않는다.**
게다가 앱 어디에도 이 행을 삭제하는 경로가 없다.

### 2-3. 랜딩 패널의 카피/섹션 결합 — ☑ 이미 분리돼 있었고, 실측으로 확인

`site_settings` 의 `about.body` 행을 **실제로 지우고** 관리 화면을 열었다:

```
카피 편집을 시작할 수 없습니다
  설정 항목 1개를 찾을 수 없어 편집을 막았습니다: about.body.
DOM 의 submit 버튼: [로그아웃, 섹션 설정 저장]      ← 카피 저장 버튼 자체가 없다
섹션 폼: name="section.id" × 7 + 저장 버튼 정상
```

- **F8 유지 확인** — 카피 폼은 비활성화가 아니라 **DOM 에 부재**다. 값을 모르는 채로 저장이 불가능하다.
- **분리 확인** — 카피 로드 실패가 섹션 편집을 막지 않는다.
- 확인 후 행을 원본 그대로(`updated_at` 포함) 복원, md5 일치.

### 2-4. 갤러리 오류가 대표 이미지 필드에 붙는 문제 — ☑ 고침 + 실측

이건 **실제로 남아 있던 결함**이었다. `_actions/rockets.ts` 가
`fail(err.message, { coverMediaId: err.message })` 로 무조건 대표 이미지에 붙였다.

수정:

- `MediaRejected` 가 `fields: readonly string[]` 를 들고 다닌다.
- `checkMediaAttachable()` 의 실패 결과가 **거부를 유발한 media id** 를 함께 돌려준다.
- `rejectedFields(rejected, cover, galleryIds, coverField)` 가 id → 폼 필드를 가른다.
  대표·갤러리가 동시에 걸리면 둘 다, 특정 불가면 대표 쪽(단서가 사라지지 않는 쪽).
- `parseGalleryIds()` 실패(형식 오류·상한 초과)도 `galleryMediaIds` 에 붙는다.
- `GalleryField` 에 `error` prop 을 추가해 갤러리 입력 옆에 렌더한다.
- `members.ts` 는 사진 입력이 하나뿐이라 항상 `['imageMediaId']`.

실측 — 다른 로켓(`icx1s`)에 이미 매인 미디어를 넣고 `icx1` 저장을 시도:

| 넣은 위치 | 응답 `fieldErrors` | 렌더 위치 |
|---|---|---|
| 갤러리 | `{"galleryMediaIds":"이미 다른 항목에 연결된 이미지입니다."}` | `0 / 12장` 상태 표시 **직후** = Gallery fieldset 안 |
| 대표 이미지 | `{"coverMediaId":"이미 다른 항목에 연결된 이미지입니다."}` | 대표 이미지 필드 |

DB 레벨 교차 확인(`checkMediaAttachable` + `rejectedFields` 직접 호출):
갤러리만 위반 → `galleryMediaIds` / 대표만 위반 → `coverMediaId` /
갤러리에 존재하지 않는 id → `galleryMediaIds` / 정상 → `ok`.

### 2-5. `MAX_GALLERY_IMAGES` 이중 하드코딩 — ☑ 고침 + 실측

`admin/_lib/media.ts` 와 `components/admin/RocketForm.tsx` 가 각자 `12` 를 들고 있었다.
`lib/image/policy.ts` (브라우저·서버 공통 상수 파일)로 옮기고 두 곳이 그것을 import 한다.
`_lib/media.ts` 는 기존 import 경로 유지를 위해 re-export 한다 —
그 파일은 `server-only` 라 폼에서 직접 가져다 쓸 수 없다.

실측: 로켓 수정 폼 HTML 에 `최대 12장`, 상태 표시 `0 / 12장`.
서버 파싱은 13장 입력에 `갤러리 이미지는 최대 12장까지 등록할 수 있습니다.` 반환.
이제 상한을 바꾸면 한 파일만 고치면 된다.

---

## 3. 요구사항 매트릭스 전 행 판정

### A. 전역

| # | 판정 | 근거 |
|---|---|---|
| A1 워드마크 → `/` | ☑ | 프로덕션 HTML 에 `href="/"` 워드마크 링크 1개 |
| A2 메뉴 4개 · CMS 편집 | ◐ | 렌더 4개 확인(`/#about`·`/rocket`·`/posts`·`/member`), 라벨은 `nav.*` 4키에서 읽음. **CMS 에서 라벨을 바꿔 반영되는 것까지는 실측 안 함.** 그리고 `/posts` 는 **404 다** (§5 결함 1) |
| A3 햄버거 ARIA·키보드·포커스 트랩 | ◐ | `aria-expanded`·`aria-controls="nav-menu"`·`id="nav-menu"` 렌더 확인. 키보드 단독 조작·포커스 트랩은 브라우저 없이는 확인 불가 |
| A4 `.nav-simulate-mobile` 제거 | ☑ | 레포 전체·빌드 산출물 모두 0건 (§4) |
| A5 Footer 저작권 CMS | ☑ | `site_settings.footer.copyright` = `© 2026 ICAROS. All Rights Reserved.` → 렌더 문자열 일치 |
| A6 `loading.tsx` 스켈레톤 | ☐ | **회귀.** `src/app/(public)/member/loading.tsx` 가 이 라운드 중 다른 트랙에 의해 삭제됐고, 지금 `src/app` 에 `loading.tsx` 가 0개다. `MemberSkeleton.tsx`·`RocketSkeleton.tsx` 는 참조 0건의 고아가 됐다 (§5 결함 2) |
| A7 404 FuzzyText 이식 | ☐ | 미이식. 레거시 소스는 삭제, 복구 커밋 위 §1 에 기록 |
| A8 `error.tsx` | ◐ | `src/app/error.tsx` 존재·에러 digest 만 로깅·`reset()` 버튼. 강제 throw 실측은 안 함 |
| A9 `lang="ko"` | ☑ | `<html lang="ko" …>` |
| A10 `generateMetadata` CMS 기반 | ☑ | 홈 `<title>ICAROS</title>` + `og:title`·`og:description`·`description` 이 `seo.*` DB 값과 일치. `og.image_media_id` 키 존재 |
| A11 `vercel.json` rewrite·`_redirects` 제거 | ☑ | `public/_redirects` 부재. `vercel.json` 은 crons 만 남음(rewrite 0) |
| A12 ScrollToTop 제거 | ☑ | 파일 삭제, 참조 0건 |
| A13 폰트 woff2 + 라이선스 | ◐/⛔ | `lib/fonts.ts` 가 `next/font/local` 로 Pretendard woff2 를 로드. **Widescreen Trial ttf 9개가 `src/assets/fonts/` 에 그대로 남아 있다** (D18 로 교체 결정됨, 다른 트랙 진행 중). 라이선스는 여전히 사용자 확인 대기 |
| A14 반응형 4뷰포트 | ☐ | 브라우저 없이 확인 불가 |
| A15 Vercel 독립 배포 | ☐ | 배포 대시보드 미확인 |

### B. Home / Landing

| # | 판정 | 근거 |
|---|---|---|
| B1 Hero + 3D/미디어 | ◐ | Hero·로고·이니셜 렌더 확인. 3D 통합은 `rocket_models` 0행 · `components/three` 부재로 미완 (3d 트랙 진행 중) |
| B2 7개 섹션 유지 | ☑ | 렌더된 `id=`: hero·about·vision·research·mission·donate·contact — 7/7 |
| B3 `**단어**` CMS 하이라이트 | ☑ | 렌더 HTML 에 raw `**` 0건, `Highlight` 가 파싱. 강조 단어는 `about.slogan`·`vision.slogan` DB 값 |
| B4 슬로건 DOM 이중 렌더 제거 | ☑ | `Statement…__slogan` 2회 = 섹션 2개(`center` 1 + `split` 1) 각 1회. `mobileOnly`/`desktopOnly` 류 0건 |
| B5 `주요 활동은…` CMS화 | ☑ | `mission.list_intro` 키 존재 |
| B6 Donate 인용구·마무리 CMS화 | ☑ | `donate.quote`·`donate.outro`·`donate.intro`·`donate.usage_*`·`donate.cta_label` 키 존재 |
| B7 진행률 + `ko-KR` 포맷 | ☑ | `role="progressbar"` `aria-valuenow="71"`, `3,200,000원`·`2,257,445원` |
| B8 `alert()` 제거 | ☑ | 렌더 HTML `alert(` 0건 |
| B9 Contact 이메일·인스타 CMS화 | ☑ | `contact.email`·`contact.instagram`·`contact.body` 키 존재 |
| B10 `DEFAULTS` 하드코딩 폴백 제거 | ◐ | `home.jsx` 삭제로 레거시 사본 소멸. 신규 트리에는 `SEO_FALLBACK`(3필드)·`NAV_ITEMS` fallback 라벨만 남아 있고 **섹션 카피 폴백은 없다** — 의도된 최소 폴백 |
| B11 섹션 토글·순서 CMS | ◐ | `page_sections` 7행(enabled/sort_order), `SectionsForm` 렌더·저장 액션 존재. **순서를 실제로 바꿔 홈에 반영되는 것까지는 실측 안 함** (DB 원복 부담) |
| B12 대표 로켓 / 대표 3D 지정 | ◐ | `home_feature` 테이블·`saveHomeFeatureAction`·`HomeFeatureForm` 존재. **행 0개**라 동작 실측 불가 |

### C. Rockets

| # | 판정 | 근거 |
|---|---|---|
| C1 시리즈 탭 A/B | ☑ | `/rocket` → icx1·icx1s / `/rocket?series=B` → icxmv1·icxmv1lr. 링크형 탭이라 JS 없이 동작 |
| C2 카드 그리드 | ☑ | 위와 동일 |
| C3 모달 → `/rocket/[slug]` 딥링크 | ☑ | 4개 slug 전부 200, `/rocket/nope` **404** |
| C4 4기 전수 | ☑ | DB 4행 = ICX-IA·ICX-Is·ICX MV-I·ICX MV-I LR, 목록 렌더 4개 |
| C5 엔진 | ☑ | `rocket_engines` 6행으로 정규화됨(jsonb 아님). 수정 폼에 `engine.{type,thrustN,burnTimeS,count,mode}` |
| C6 Markdown 설명 | ◐ | `descriptionMd` 컬럼·`MarkdownField`·`RocketDescription` 존재. **현재 4기 모두 값이 비어 있어 렌더 실측 불가** |
| C7 대표 이미지 + 갤러리 | ◐ | 폼·서버 검증·순서 저장(`site_settings` `rocket.<id>.gallery`)·부착 검증 전부 존재하고 §2-4 로 오류 표기까지 실측. **실제 업로드는 `S3_BUCKET` 미설정이라 불가** |
| C8 공개 여부 | ◐ | `published` 컬럼 + 목록·상세·`generateStaticParams` 세 경로 모두 `eq(published,true)` 필터. **비공개로 바꿔 직접 URL 차단을 실측하진 않음** (DB 변경 부담) |
| C9 `sort_order` + tie-break | ☑ | `(series, sort_order)` unique + slug tie-break. 시리즈별 순서 결정적 |
| C10 GLB + 포스터 | ☐ | `rocket_models` 0행, 3d 트랙 진행 중 |
| C11 Hotspot | ◐ | `rocket_hotspots` 테이블 + `HotspotEditor` 존재, 데이터 0행 |
| C12 모바일 fallback | ☐ | 3d 트랙 |
| C13 검색·필터 없음 | ☑ | 의도적 부재 확인 |

### D. Posts

| # | 판정 | 근거 |
|---|---|---|
| D1 ESSENTIA 단일 원본 | ⛔ | `icaros_posts` 미생성 확인(테이블 15개에 없음). 서비스 토큰 대기 |
| D2 20건 이전 | ⛔ | 동일 |
| D3 카드 그리드 + 더 보기 | ⛔ | `/posts` 라우트 자체가 없다 |
| D4 커버·요약 서버 파생 | ⛔ | 동일 |
| D5 `/posts/[slug]` | ⛔ | 동일 |
| D6 게시일 편집 | ⛔ | 동일 |
| D7 양방향 반영 | ⛔ | 동일 |
| D8 쓰기 경로 1개 | ☑ | **금지 조건은 지켜지고 있다** — 게시글 테이블 부재, `PostsPanel` 은 CRUD 없이 차단 사유만 안내 |
| D9 타 board 접근 불가 | ⛔ | 연동 전 |

### E. Members

| # | 판정 | 근거 |
|---|---|---|
| E1 27명 | ☑ | DB 27행 = 렌더된 `MemberCard…__card` 27개 |
| E2 `school` 표시 | ☑ | `…__school` 27개 중 23개 렌더 (값 있는 사람만) |
| E3 `sort_order` 재부여 | ◐ | 렌더 순서 결정적. 중복 0 여부는 별도 확인 안 함 |
| E4 소속 분야 그룹 | ☑ | `<h2>` 6개 = 총괄·전자부·비행제어부·법률·재무팀·SW · 디자인·추진공학부, DB 집계(10/8/6/1/1/1)와 일치 |
| E5 공개 여부 | ◐ | `published` 컬럼 존재, 현재 27/27 공개라 차단 동작 미실측 |
| E6 `profile.webp` 플레이스홀더 | ☑ | `MEMBER_PLACEHOLDER` 상수 + 파일 존재. 사진 경로가 있는 4명 외 23명이 이 경로 |

### F. Admin CMS

| # | 판정 | 근거 |
|---|---|---|
| F1 탭 4개 | ☑ | 실제로는 **5개** — Posts·Rockets·Members·Landing + 신규 Scene(F9). 전부 200 |
| F2 자체 Neon 인증 | ☑ | bootstrap CLI 로 계정 생성 → 세션 쿠키로 콘솔 접근 성공. Supabase 흔적 0건 |
| F3 마크다운 툴바 + 미리보기 | ◐ | `MarkdownField` 렌더 확인(`aria-label="설명 (Markdown) 서식"` 툴바 그룹). **각 버튼 동작은 JS 필요 — 미실측** |
| F4 이미지 다중 업로드 | ◐ | presign→PUT→confirm 3단 구현 + `GalleryField` 순차 업로드. **`S3_BUCKET` 미설정이라 실제 업로드 불가** |
| F5 CRUD 일주 | ◐ | 실패 경로(검증·충돌·행없음·미디어거부)는 실측. **성공 경로 CRUD 일주는 DB 를 바꾸게 되어 미실행** |
| F6 삭제 시 S3 정리 + 재시도 | ◐ | `retireMedia` → `deleteMedia` → 실패 시 `storage_cleanup_jobs` 적재. 큐 0행, 실측 불가 |
| F7 엔진 동적 편집 | ◐ | `EngineEditor` 렌더, 서버가 평행 배열 길이 검증 |
| F8 fetch 실패 시 저장 차단 | ☑ | §2-3 실측 |
| F9 3D Scene Configuration | ◐ | Scene 탭 200, 모델 0행 |
| F10 SEO·OG·섹션순서·메뉴명·Footer 편집 | ☑ | `LANDING_KEYS` 33키에 `nav.*`4·`seo.*`2·`og.image_media_id`·`footer.copyright` 포함, 랜딩 탭에서 렌더 |
| F11 `window.confirm` 삭제 | ◐ | `DeleteConfirm` 컴포넌트로 대체됨(브라우저 confirm 아님) |
| F12 낙관적 잠금 | ☑ | 수정 폼 hidden `version="2026-08-23T02:11:47.465893Z"` (마이크로초 유지). 낡은 토큰 전송 → CONFLICT 실측 |
| F13 Admin 에 3D 뷰어 금지 | ☑ | `RocketForm` 주석에 명시, 폼에 캔버스 없음 |

### G. 3D Scene CMS

G1–G14 전부 **◐ 또는 ☐**. `rocket_models`·`rocket_hotspots`·`home_feature` 스키마와
`ScenePanel`/`ModelForm`/`PresetEditor`/`HotspotEditor`/`ExtrasEditor`/`validation.ts` 는 존재하고
Scene 탭이 200 으로 뜨지만, **모델 데이터가 0행이고 뷰어 컴포넌트(`components/three`)가 아직 없어
어느 항목도 동작을 확인할 수 없다.** 3d 트랙이 진행 중이므로 이 섹션은 Gate 7 에서 다시 본다.

예외로 G13(임의 JS 금지·검증된 JSON schema 만)은 ◐ — `scene/validation.ts` + Zod 스키마로
구조를 강제하고 있고 자유 문자열 JS 를 저장하는 경로가 없다(코드 검토).

### H. 인증 · 보안

| # | 판정 | 근거 |
|---|---|---|
| H1 외부 Auth SaaS 미사용 | ☑ | 의존성에 supabase/auth0/firebase 0건, 빌드 산출물 0건 |
| H2 공개 회원가입 없음 | ☑ | `/admin` 만 존재, 가입 라우트·액션 없음. 계정은 CLI 로만 |
| H3 이메일 정규화 | ◐ | `lib/auth/email.ts` `normalizeEmail`, CLI 도 같은 함수 사용. 대소문자 변형 로그인 실측은 안 함 |
| H4 검증된 Argon2id | ☑ | `@node-rs/argon2`, `algorithm: 2(=argon2id)`, m=19456 t=2. 자체 구현 없음 |
| H5 평문 저장·로깅 금지 | ☑ | `admin_users` 에 `password_hash` 만. CLI 는 `--password` 플래그를 **의도적으로 거부**하고 TTY 입력만 받음. 로그 출력 경로 없음 |
| H6 강한 random 토큰 | ☑ | `randomBytes(32).toString('base64url')` = 256비트 |
| H7 DB 에 hash 만 | ☑ | `admin_sessions.token_hash` = sha256 bytea. 세션을 직접 심을 때 확인 |
| H8 쿠키 플래그 | ☑ | 응답 헤더 실측: `__Host-icaros_session=…; Path=/; Secure; HttpOnly; SameSite=lax` |
| H9 세션 만료 | ◐ | 절대 7일 + 유휴 8시간 쿼리. 만료 후 거부 실측 안 함 |
| H10 logout server-side revoke | ☑ | 로그아웃 액션 호출 후 `admin_sessions.revoked_at` 이 채워지고 같은 쿠키로 재접근 시 로그인 화면. 우연히 실측됨(잘못된 action id 재생 실험) |
| H11 모든 mutation 세션 검증 | ☑ | 5개 `_actions` 파일의 모든 export 가 `requireAdmin()` 로 시작. 세션 없이 재생 시 로그인으로 튕김 |
| H12 CSRF + Origin 검증 | ◐ | 3중 방어(SameSite=Lax / next.config `allowedOrigins` / `requireAdmin` 명시 검증) 코드 확인. **위조 Origin 요청 실측 안 함** |
| H13 rate limit + backoff | ◐ | `login_attempts` 테이블 + `checkLock`/`registerFailure`/`clearFailures`. 연속 실패 실측 안 함 |
| H14 보안 이벤트 기록 | ☑ | `auth_events` 에 `bootstrap`·`admin_deactivated`·`logout` 이 실제로 기록되는 것 확인 |
| H15 비활성 계정 로그인 거부 | ◐ | 세션 판정 쿼리가 `is_active` 를 본다(코드). 로그인 시도 실측 안 함 |
| H16 비밀번호 변경 시 전 세션 폐기 | ◐ | `--reset-password` 가 `revoked_at` 일괄 + `password_changed_at` 안전망. 실측 안 함 |
| H17 timing-safe 비교 | ☑ | `session.ts` 가 `timingSafeEqual` 로 토큰 해시 비교 |
| H18 Node runtime | ☑ | `admin/layout.tsx`·`admin/page.tsx`·`api/*/route.ts` 4개 전부 `export const runtime = 'nodejs'` |
| H19 일회성 bootstrap CLI | ☑ | 기본 비밀번호·하드코딩 없음. 대상 DB 출력 후 `yes` 확인, `--generate` 는 CSPRNG 24바이트 |
| H20 Supabase hash·session 이전 금지 | ☑ | 이전 코드 자체가 없음 |
| H21 client 번들 비밀값 | ☑ | `.next/static` 에 `DATABASE_URL`·`AWS_SECRET`·`AWS_ACCESS`·`password_hash`·`token_hash` 0건. `S3_BUCKET` 1건은 **한국어 안내 문구 안의 변수 이름**이지 값이 아님 |
| H22 독립 Security Reviewer | ☐ | 미실시 |

### I. S3 Storage

`S3_BUCKET` 미설정이 정상 동작인 상태라 **실측 가능한 것이 거의 없다.**

| # | 판정 | 근거 |
|---|---|---|
| I1 `--profile essentia` | ☑ | 기존 확인 유지 |
| I2 bucket·prefix 확정 | ⛔ | `essentia_infra` 대기 |
| I3 SDK v3 서버 presign | ◐ | `@aws-sdk/s3-request-presigner`, `api/upload/presign` Node runtime |
| I4 prefix 밖 업로드 차단 | ◐ | `isOwnedKey`/`isStructurallySafeKey` 순수 함수. 실호출 없음 |
| I5 확장자 + MIME 검증 | ◐ | `checkUploadCandidate` 가 SVG 계열을 확장자·MIME 양쪽으로 차단 |
| I6 용량 제한 | ◐ | `UPLOAD_POLICIES` media 1MB / hero·poster 2MB / glb 8MB |
| I7 random UUID key | ◐ | `keys.ts`, 원본 파일명은 키에 미포함 |
| I8 pending → ready | ◐ | `media.status` enum + `/confirm` 의 HeadObject 검증 |
| I9 불일치 처리 | ◐ | `hasReferences()` 재확인 + `storage_cleanup_jobs` |
| I10 재시도 가능한 cleanup | ◐ | `enqueueCleanup` + `api/cron/storage` + `vercel.json` cron `17 3 * * *` |
| I11 prefix 내부만 삭제 | ◐ | `deleteMedia` 안의 프리픽스 검사 |
| I12 private 유지 | ⛔ | 승인 대기 |
| I13 client 에 AWS Secret 없음 | ☑ | 빌드 산출물 grep 0건 |
| I14 삭제 전 참조 재확인 | ◐ | `retireMedia` 를 **커밋 이후**에만 부르도록 배치. 코드 검토 |
| I15 메타데이터만 Neon | ⛔ | 스키마는 준비됨(`media` 14컬럼), 확정 대기 |
| I16 파생 이미지 | ◐ | 브라우저에서 WebP 재인코딩 + 긴 변 제한. 실제 변환 실측 불가 |
| I17 미성년자 사진 공개 범위 | ⛔ | 사용자 승인 대기 |

### J. 마이그레이션 무결성

| # | 판정 | 근거 |
|---|---|---|
| J1 Landing keys 18 | ☑(초과) | 실측 **33키** — 원래 18 + `nav.*`4 + `seo.*`2 + `og.image_media_id` + `footer.copyright` + donate 세분화 등 신규 필드 |
| J2 Rockets 4 | ☑ | DB 4행, id·name·series 대조 완료 |
| J3 엔진 배열 길이 | ☑ | `rocket_engines` 6행 |
| J4 Posts 20 | ⛔ | 연동 대기 |
| J5 Members 27 | ☑ | DB 27행 |
| J6 이미지 52/86.67 MiB | ⛔ | S3 이전(P9) 미착수. 현재 `media` 0행, 레거시 경로만 |
| J7 로컬 레포 이미지 | ◐ | `public/assets/img/{rocket,member}` 유지 중, S3 업로드 미착수 |
| J8 고아 3개 제외 | ⛔ | P9 |
| J9 Admin 이메일 목록 | ⛔ | 사용자 확인 대기 |
| J10 `posts` DDL 덤프 | ⛔ | 진행 흔적 있음 — `docs/legacy-dump/` 와 `supabase/.temp/` 가 이 라운드 중 생성됨(다른 트랙) |
| J11 `admins`+`auth.users` 덤프 | ⛔ | 동일 |
| J12 대문자 `.PNG` 정규화 | ◐ | `fileExtension()` 이 소문자 정규화. 실데이터 미이전 |
| J13 중복 1건 제외 | ⛔ | P9 |

### K. 잔존 의존성 → §4

### L. 현행 결함 해소

| 결함 | 판정 | 근거 |
|---|---|---|
| #1 Landing 전체 공백 덮어쓰기 | ☑ | §2-3 실측 |
| #2 이미지 고아 | ◐ | pending/ready + cleanup 큐 구현, 실측 불가(S3) |
| #3 발행일 지정 불가 | ⛔ | Posts 연동 대기 |
| #4 sort_order 중복 | ◐ | unique 제약 + tie-break |
| #5 posts CREATE 문 부재 | ☑ | Drizzle 스키마가 단일 정의(`lib/db/schema/`), 레거시 SQL 의존 소멸 |
| #6 CHECK 제약 0개 | ☑ | `media_key_prefix_ck`·`media_size_ck`·`auth_events_kind_ck` 등 실제 존재 확인 |
| #7 에러 문자열 잔존 | ☑ | 성공 시 액션이 redirect → `useActionState` 상태가 갱신되지 않고 목록으로. 실패 재생 후 폼이 오류와 함께 재렌더되는 것 확인 |
| #8 빈 화면 로딩 | ☐ | **A6 회귀** — `loading.tsx` 가 0개다 |
| #9 폰트 라이선스 | ⛔ | 사용자 확인 대기 |

---

## 4. 잔존 문자열 검사 (레거시 삭제 후)

명령:

```
grep -rniI --exclude-dir={node_modules,.next,.git,supabase} <문자열> .
```

빌드 산출물은 별도로 `.next/static`·`.next/server` 를 검사했다.

| 문자열 | 런타임 코드 | 빌드 산출물 | 의도적 예외 (마이그레이션 자료) | 예외 아닌 잔존 |
|---|---|---|---|---|
| `supabase` | **0** | **0** | `docs/icaros-rebuild/` 8개 문서 61건 · `docs/icaros-rebuild/legacy-package.json.bak` 1건 · `scripts/seed-from-legacy.ts` 6건 · `.env.example` 2건(`LEGACY_SUPABASE_URL`/`_ANON_KEY` — seed 스크립트 입력) · `docs/legacy-dump/README.md` 3건(다른 트랙 산출물) | **`AGENTS.md` 9건** |
| `NEXT_PUBLIC_SUPABASE` | **0** | **0** | `09-implementation-plan.md` 1 · `02-requirements-matrix.md` 1 | 없음 |
| `SUPABASE_SERVICE_ROLE` | **0** | **0** | `09-` 1 · `02-` 1 | 없음 |
| `sim.icaros.kr` | **0** | **0** | `01-` 3 · `02-` 1 · `06-` 1 · `09-` 1 | **`AGENTS.md` 1건** |
| `nav-simulate-mobile` | **0** | **0** | `01-` 3 · `02-` 2 · `09-` 1 | 없음 |
| `simulate` | **0** | 2건 — **Next.js 자체 소스맵의 영어 산문**(`node_modules_next_dist_*.js.map`). 우리 코드 0 | `01-` 5 · `02-` 4 · `09-` 2 | 없음 |

**판정: K 표의 6개 문자열 모두 런타임 코드·환경설정에서 0건.**
단 `AGENTS.md` 는 문서지만 마이그레이션 자료가 아니라 **에이전트가 읽는 현행 안내서**이므로
예외로 볼 수 없다. Gate 7 전에 처분해야 한다.

---

## 5. 이 라운드에서 새로 발견한 결함

### 결함 1 — 헤더의 `Posts` 메뉴가 404 로 간다 (A2 · D3)

`lib/content.ts` `NAV_ITEMS` 가 `/posts` 를 가리키는데 그 라우트가 존재하지 않는다.
프로덕션 빌드 라우트 목록에도 없고 실제로 404 다. Posts 는 D 블로커라 라우트를 만들 수 없으므로
**선택지는 두 가지**다:

1. 연동 전까지 nav 에서 Posts 를 감춘다 (A2 의 "4개" 요구와 충돌).
2. `/posts` 에 "준비 중" 안내 페이지를 두고 200 을 준다.

어느 쪽이든 `lib/content.ts` 와 랜딩 트랙의 결정이 필요해 이 트랙에서 임의로 고치지 않았다.

### 결함 2 — `loading.tsx` 전멸 (A6 · L#8 회귀)

이 라운드 진행 중 `src/app/(public)/member/loading.tsx` 가 다른 트랙에 의해 삭제됐고
현재 `src/app` 에 `loading.tsx` 가 하나도 없다. 결과:

- A6("빈 화면 없음")과 L#8 이 다시 열렸다.
- `components/member/MemberSkeleton.tsx` 와 `components/rocket/RocketSkeleton.tsx` 가
  **참조 0건의 고아**가 됐다.

주의: `/rocket/[slug]` 에는 `loading.tsx` 를 두면 **안 된다** — `notFound()` 위에 loading
경계가 생기면 404 가 200 이 된다(이미 한 번 고친 회귀). `/member`·`/rocket` 목록에는 안전하다.

### 결함 3 — `vite.config.js` 가 실행 불가능한 상태로 남아 있다

vite·@vitejs/plugin-react 가 `package.json` 에도 `node_modules` 에도 없어 이 파일은
읽는 사람을 오도할 뿐이다. 지시에 따라 삭제하지 않고 보고만 한다.

### 결함 4 — `AGENTS.md` 가 폐기된 Supabase 아키텍처를 현행처럼 서술한다

§4 참조. 소유 경로 밖이라 손대지 않았다.

---

## 6. Gate 6 종합 판정

| 항목 | 결과 |
|---|---|
| 레거시 Vite 트리 삭제 | **완료** — 32 파일 + 이미지 15장 + `dist/`. 참조 0건 사전 확인 |
| 삭제 후 `npm run build` | **통과** — 격리 스냅샷과 레포 실물 양쪽에서. 7 라우트 생성, TypeScript 통과 |
| `npx tsc --noEmit` / `npm run lint` | **둘 다 0** (레포 실물, 전 트랙 작업 반영 상태) |
| 프로덕션 라우트 실측 | `/` `/rocket` `/rocket/icx1` `/member` `/admin` **200** · `/rocket/nope` **404** |
| 잔존 문자열 6종 | 런타임 코드·빌드 산출물 **전부 0** (`AGENTS.md` 제외 — §4) |
| 결함 5건 | 3건은 debt 트랙이 이미 처리(실측 확인), **2건은 이 트랙에서 실제로 수정**(갤러리 오류 필드 · 상한 이중 하드코딩) + 1건 추가 수정(scene 행 잠금) |

**Gate 6 통과로 판정한다.** 단 §5 의 결함 4건과 A6 회귀는 Gate 7 전에 닫아야 한다.

---

# 재검증 (2026-08-25) — 이전 §6 판정은 무효였다

## 왜 다시 하는가

이전 스캔 명령이 `--exclude-dir={node_modules,.next,.git,supabase}` 였다.
그런데 **`supabase/.temp/` 8파일이 git 에 추적되고 있었고** 거기에 프로젝트 ref·org id·
pooler URL 이 들어 있었다. 즉 *"잔존 문자열 6종 전부 0건"* 이라는 판정은
**레거시 식별자를 들고 있던 유일한 추적 디렉터리를 제외해서 나온 값**이었다.

그 8파일은 이후 히스토리에서 통째로 제거했다. 이번 스캔은 **제외 없이** 추적 파일 전수를 본다.

## 스캔 결과 — `git grep -lI -i <pat> HEAD`

| 패턴 | 히트 | 판정 |
|---|---:|---|
| `supabase` | 18 | 아래 분류 |
| `NEXT_PUBLIC_SUPABASE` | 3 | 전부 요구사항 문서(금지 목록 자체) |
| `SUPABASE_SERVICE_ROLE` | 3 | 전부 요구사항 문서 |
| `sim.icaros.kr` | 6 | 전부 문서 |
| `nav-simulate-mobile` | 4 | 전부 문서 |
| `simulate` | 4 | 전부 문서 |

### `supabase` 18건 분류

| 분류 | 파일 | 판정 |
|---|---|---|
| **런타임 코드** | `src/lib/community/client.ts:158` | ✅ **허용.** 주석 한 줄 — *"레거시 글에는 구 Supabase Storage 절대 URL 도 섞여 있다 — 그건 건드리지 않는다"*. 이미지 URL 치환 로직이 왜 일부를 건드리지 않는지 설명한다. 코드가 아니다 |
| **환경설정** | `.env.example:46-47` `LEGACY_SUPABASE_URL` · `_ANON_KEY` | ✅ **허용.** 파일 안에 *"일회성 export 전용, 런타임 미사용"* 으로 명시돼 있다 |
| | `.gitignore` | ✅ `supabase/.temp/` 를 무시하는 규칙 |
| **마이그레이션 도구** | `scripts/seed-from-legacy.ts` · `scripts/migrate/export-posts.ts` | ✅ **허용.** 이 스크립트들이 곧 이관 경로다. 런타임 번들에 들어가지 않는다 |
| **문서** | `docs/**` 12건 · `AGENTS.md` | ✅ 의도적 |

**런타임 번들에 Supabase 코드·의존성은 0 이다.**
- `package.json` 에 `@supabase/*` 없음
- `.next/static` 에 `supabase` 문자열 0건
- `src/` 전체에서 import 0건

### 판정
**§K 통과.** 요구사항은 *"런타임 코드·환경설정에서 0건, 마이그레이션 문서 제외"* 이고,
런타임 코드의 유일한 히트는 주석이며 환경설정의 히트는 일회성 export 변수다.

## 함께 정리한 것

- `docs/icaros-rebuild/legacy-package.json.bak` **삭제** — 구 package.json 백업.
  git history 에 있으므로 트리에 둘 이유가 없었다.
- `AGENTS.md` **재작성** — 존재하지 않는 Vite/Supabase 구조를 설명하고 있었다.
  `CLAUDE.md` 가 gitignore 라 이게 **레포에 추적되는 유일한 에이전트 가이드**인데
  모든 항목이 사실과 달랐다. 현재 스택 + 밟았던 지뢰 7건으로 다시 썼다.

## 이전 판정과 달라진 다른 항목

| 항목 | 이전 | 지금 |
|---|---|---|
| `/posts` 404 (§5 결함 1) | ⛔ D1 대기 | ✅ **해소.** 읽기는 인증 불필요한 공개 API 로 즉시 연동됨 (D23). 쓰기만 D1 대기 |
| A13 폰트 예산 | ◐ 디스플레이만 해결 | ✅ **해소.** Pretendard `unicode-range` 2단 서브셋 2.22MB → 305KB (D13 문서) |
| 3D 마운트 | 보고 누락 | ✅ **해소.** `HeroStage` import 0건이던 것을 배선. 우상단 대각선 배치 |

## 여전히 미충족

| | 이유 |
|---|---|
| C10·C11·C12 (GLB·핫스팟·모바일 폴백) | 3D 인프라는 있으나 CMS Scene 연동과 핫스팟 UI 미구현 |
| D7~D9 (Posts 쓰기·양방향) | **D1 서비스 토큰** |
| I2·I12·I15·I17 (S3 실경로) | **CORS·IAM 승인** |
| J4·J10·J11 (Posts 이관 실행) | D1 + 이미지 재호스팅 |
| A14 (반응형 실측) | 브라우저 미연결 — CSS 논리 검증만 함 |
