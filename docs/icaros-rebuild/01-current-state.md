# 01 — Current State Audit

> ICAROS-web 현행 시스템 전수 감사. 작성 시점: 2026-08-23.
> 조사 범위: 전체 소스, 라이브 Supabase 데이터(anon key read-only), 배포 설정, 자산.
> Owner: Root Orchestrator (session `icaros-web-aa`).

---

## 1. 저장소 · 배포

| 항목 | 값 |
|---|---|
| Remote | `github.com/ESSENTIA-Science/ICAROS-web` |
| Branch | `main` @ `3e8595c` ("adjust cms pannal ratio") |
| 배포 | Vercel (`icaros.kr`). `vercel.json`은 rewrite 1줄만 — `/(.*)` → `/` |
| Netlify 잔재 | `public/_redirects` (`/* /index.html 200`) — 두 곳을 수동 동기화해야 하는 구조 |
| 빌드 | Vite 7, `cssCodeSplit`, esbuild minify, `react-vendor` manualChunk |
| Lint | `eslint .` — **`eslint.config.js`가 없어 ESLint 9에서 실패**. CI 없음 |
| 테스트 | 없음 (프레임워크 미설치) |

### 워킹트리 이슈 (리뉴얼 착수 전 처리 필요)
```
 D supabase/migrations/0001_cms_auth_rls.sql
 D supabase/migrations/0002_cms_content.sql
?? AGENTS.md
```
- `supabase/migrations/` 두 파일이 **이 감사 세션 도중 워킹트리에서 삭제**됨. git에는 존재 → `git restore supabase/`로 복구 가능.
  두 파일은 legacy 스키마의 유일한 문서화된 정의이며 마이그레이션 근거 자료다. **삭제 상태로 리뉴얼에 진입하면 안 된다.**
- `AGENTS.md`는 `CLAUDE.md`의 거의 복사본(Codex용). 커밋 안 됨.

---

## 2. 런타임 스택 (실측)

| 패키지 | package.json | node_modules 실제 |
|---|---|---|
| react | `^19.2.0` | **19.2.3** |
| react-dom | `^19.2.0` | **19.2.3** |
| react-router-dom | `^6.30.2` | v6 |
| vite | `^7.2.2` | 7 |
| @supabase/supabase-js | `^2.91.1` | 2.x |
| react-markdown / remark-gfm / rehype-highlight / highlight.js | — | 마크다운 렌더 체인 |

- **React 18이 아니라 React 19다.** `main.jsx`는 `createRoot` + `StrictMode`.
- 상태관리 라이브러리 없음. UI 킷 없음. TypeScript 없음 (전부 `.jsx` / `.js`).
- **Three.js / R3F / drei / GSAP 미설치.** 현재 사이트에 3D는 존재하지 않는다.
  (`public/assets/icx-2.fbx`가 있으나 코드에서 참조 0건 — 계획만 있고 미구현.)

---

## 3. 아키텍처 — "백엔드가 없다"

서버 코드가 레포에 0줄이다. Node 서버, Vercel Function, Supabase Edge Function 모두 없음.

```
브라우저 (React 19 SPA)
  └─ @supabase/supabase-js  (anon key, src/lib/supabase.js — 앱 전체에서 이 인스턴스 1개)
       └─ HTTPS → Supabase PostgREST / GoTrue Auth / Storage
            └─ Postgres RLS 정책이 public.is_admin() 호출 → 허용/거부
```

CMS "백로직"의 실제 소재지:

| 층 | 위치 | 내용 |
|---|---|---|
| 프레젠테이션 + 비즈니스 로직 | `src/admin/*Panel.jsx` (799줄) | 폼 상태, 검증, 업로드, 파생 필드 계산, 삭제 오케스트레이션 — **전부 클라이언트** |
| 서비스 래퍼 | `src/lib/` (111줄) | `supabase.js`(10) / `content.js`(24) / `storage.js`(28) / `markdown.js`(49) |
| 진짜 백엔드 | Postgres RLS | `is_admin()` security-definer 함수 + 테이블별 정책 |

### 이 구조의 구조적 한계 (리뉴얼의 근거)
1. **트랜잭션 없음** — Storage 삭제와 row 삭제가 별개 요청. 중간 실패 시 불일치.
2. **파생 필드가 클라이언트 책임** — `posts.cover_url` / `posts.summary`를 `PostsPanel.jsx:95-99`가 계산. DB에 직접 쓰면 어긋남.
3. **서버 검증 없음** — `series`, 숫자 범위, 필수 필드 전부 JS에서만. DB CHECK 제약 0개 → PostgREST로 직접 쏘면 우회됨.
4. **비즈니스 로직 둘 자리 없음** — 결제, 메일 발송, 웹훅을 붙일 지점이 아예 없다.
5. **낙관적 잠금 없음** — `updated_at` 컬럼은 있으나 미사용. 동시 편집 시 마지막 저장이 이김.

---

## 4. 인증 · 권한 (현행)

- **Auth**: Supabase GoTrue 이메일/비밀번호. `/admin`에서 `signInWithPassword`. 공개 가입 비활성(Dashboard 설정). 세션은 supabase-js가 localStorage에 보관, `onAuthStateChange` 구독.
- **Authorization**: `public.admins` 테이블(`user_id` → `auth.users.id`) + `public.is_admin()` (`security definer`, `stable`, `search_path = public`). `authenticated`와 `anon` 모두에 execute 권한.
- **게이트 위치**: 실질 게이트는 각 테이블/버킷의 RLS 정책. `admin.jsx`의 `supabase.rpc('is_admin')`은 **콘솔 UI 표시 여부만** 결정(우회해도 DB가 거부).
- `VITE_ADMIN_PW`는 폐기됨. `service_role` 키는 앱에 없음.

### 환경변수
`.env.local` (VITE_ prefix, 클라이언트 노출): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
**`.env.local`이 `.gitignore`에 없다.** 커밋 여부 확인 필요 — 리뉴얼 시 반드시 정리.

---

## 5. 데이터 모델 (Supabase, 라이브 실측)

모든 테이블 공통 RLS 패턴: `select using (true)` 공개 읽기 + `is_admin()` 쓰기.

| 테이블 | 행 수 | 비고 |
|---|---|---|
| `posts` | **20** | `content_md`(Markdown) + 비정규화 `cover_url` / `summary` |
| `rockets` | **4** | PK = text slug. `engines` jsonb 배열 |
| `members` | **27** | PK = uuid |
| `site_content` | **18 keys** | key/value 문자열 쌍. ⚠ 마스터 프롬프트·초기 감사의 "22개"는 오류 |
| `admins` | **조회 불가** | RLS가 에러가 아니라 **HTTP 200 + 빈 배열**을 반환. anon으로는 존재 여부조차 확인 불가 → `service_role` 덤프 필수 |

### `posts`
`id uuid` · `title` · `content_md` · `cover_url` · `summary` · `created_at`
- 목록은 경량 컬럼만 select + `range()` 페이지네이션(12개). 모달 열 때 `content_md` 개별 fetch.
- **`created_at`을 CMS에서 지정할 수 없다** → 과거 활동 기록 10건이 전부 `2026-01-24`로 뭉쳐 있고 실제 타임라인이 왜곡됨.
- **`summary`가 20건 중 13건에서 낡음.** 원인: `0001`의 SQL backfill이 마크다운 기호는 제거하지만 개행을 합치지 않아 raw `\n` + 공백이 남음. 이후 CMS로 저장된 행만 `buildSummary()`의 올바른 결과를 가짐. → **이전 시 복사하지 말고 재계산.**
- `cover_url`은 20건 전부 본문 첫 이미지와 동일 — 안전하지만 중복 필드.
- `content_md` 총 7,860자, 본문 이미지 참조 49개.

### `rockets`
`id text PK` · `name` · `img` · `series` · `max_altitude_m` · `size_m` · `payload_kg` · `engines jsonb` · `sort_order` · `created_at`
- `series`: `'A'` = ICX 1/2 계열, `'B'` = ICX MV 계열. **CHECK 제약 없음.**
- 현재 4기: `icx1`(ICX-IA, A) · `icx1s`(ICX-Is, A) · `icxmv1`(ICX MV-I, B) · `icxmv1lr`(ICX MV-I LR, B)
- `engines[]` 요소 형태: `{type, thrust_n?, burn_time_s?, count?, mode?}`
- 마이그레이션 시드에 있던 `icx2` / `icx2s` / `icxmv1mirv`는 **라이브에서 삭제됨**. 시드 JSON은 신뢰 불가.

### `members`
`id uuid PK` · `name` · `role` · `school` · `image` · `sort_order` · `created_at`
- 27명. 부서 어휘: `추진공학부` / `전자부` / `비행제어부` / `SW, 디자인` / `법률·재무팀`, 그리고 `주관 · 전 부분 총괄 설계`(김지후), `부주관 · 전자부장`(박현빈).
- **`sort_order` 중복**: 값 `5`가 3개 행에 존재 → 정렬이 비결정적(tie-break 없음).
- **`school`은 DB·CMS에 있으나 공개 페이지에서 렌더되지 않음.**
- 이미지 보유 4명(김지후·박현빈·이성우·백예람), 나머지 23명은 `profile.webp` 플레이스홀더.

### `site_content` — 18 keys
```
about.slogan / about.body
vision.slogan / vision.body
research.uav.title / research.uav.body
research.control.title / research.control.body
research.rocketry.title / research.rocketry.body
mission.body / mission.list
donate.intro / donate.usage_title / donate.usage_list
donation.goal / donation.current
contact.body
```
위 = **18개 키**. `LandingPanel.jsx`의 SECTIONS 합계(About 2 + Vision 2 + Research 6 + Mission 2 + Donate 5 + Contact 1 = 18)와 정확히 일치.
리뉴얼 시 **누락 없이 전수 이전** 대상.
- 슬로건은 `**단어**`를 하이라이트로 렌더(`src/component/Highlight.jsx` 자체 미니 파서 — 마크다운 아님).
- 본문 줄바꿈은 `\n` 저장 + CSS `white-space: pre-line`.
- 리스트형(`mission.list`, `donate.usage_list`)은 `\n` split.

---

## 6. Storage (현행)

- 단일 공개 버킷 `post-img`, 폴더로 구분: `posts/` · `rockets/` · `members/`
- 오브젝트 키: `${folder}/${crypto.randomUUID()}.${ext}` — 원본 파일명 미사용(좋음)
- 정책: 공개 read / `authenticated` + `is_admin()` insert·delete. **update 정책 없음** (`upsert:false`라 현재는 무해)
- 실측: `posts/` **52 objects / 90,881,239 B (86.67 MiB)**, `rockets/` 0, `members/` 0
- `posts.content_md`가 참조하는 Storage URL **49개** → **고아 오브젝트 3개**
- **로켓/멤버 이미지는 Storage가 아니라 레포의 로컬 경로**(`/assets/img/rocket/*.webp`)를 DB에 저장 중 → S3 이전 시 별도 경로 필요
- 로컬 레포 경로를 쓰는 DB 값 **8개**(로켓 4 + 멤버 4) — 8개 파일 전부 `public/` 에 실재 확인됨
- **깨진 참조 0건** (DB가 가리키는데 Storage에 없는 오브젝트 없음)
- **크기 분포가 심각**: 52개 중 **21개가 2 MiB 초과, 최대 9.7 MiB**, 파생본(썸네일·webp 변환) **0개**. 현재 Posts 카드가 원본 풀사이즈를 그대로 로드 중 → 리뉴얼 시 파생 생성 파이프라인 필수
- 오브젝트 2개가 대문자 확장자 `.PNG` — **S3 키는 대소문자 구분**, 이전 스크립트에서 정규화 필요
- 고아 3개 중 1개는 참조된 오브젝트와 **eTag 바이트 동일 중복**

### ⚠ 개인정보 판단 필요
멤버 프로필은 **미성년자의 얼굴 사진**이다(중·고등학생 팀). 현행 `post-img` 버킷은 public read.
S3 이전 시 "private 버킷 + CloudFront/presigned"라는 마스터 프롬프트의 기본 방침이 **보안 요구가 아니라 개인정보 요구**가 된다. `essentia_infra`에 공개 전달 방식을 물을 때 이 맥락을 명시해야 하며, 멤버 사진의 공개 범위는 사용자 결정 사항이다.

---

## 7. 공개 페이지 전수 (기능·요소)

### 전역
- Header: 워드마크 SVG(→ `/`), 햄버거 토글(`aria-expanded`/`aria-controls`), 메뉴 5개 — About Us(`#about`) · Rockets · Posts · Members · **Simulate(→ `sim.icaros.kr`)**
- 모바일 전용 Simulate 버튼 1개 추가 (`.nav-simulate-mobile`)
- Footer: `© 2026 ICAROS. All Rights Reserved.` (하드코딩)
- `ScrollToTop`: 라우트 변경 시 `scrollTo(0,0)`
- 404: `FuzzyText` 캔버스 글리치("404" / "page not found", hover 시 intensity 0.18→0.5) + "Back to home"
- 라우팅: `BrowserRouter`, 5개 페이지 전부 `lazy()`, **Suspense fallback = `null`** (로딩 중 빈 화면 — UX 결함)
- 폰트: `WdscnUEx` (Trial, 9 weight, **ttf만** — woff2 없음) + `Pretendard` (9 weight, woff/woff2)
- 메타: `lang="ko"`, `<title>ICAROS</title>`, description, OG(title/description/type/url/image=`og.png`), favicon. **전부 index.html 하드코딩 — 페이지별 메타 없음**

### `/` 홈 — 섹션 7개
1. **Hero** — 흰 로고, `Intelligent Creative Astronautics & Rocketry Organization of Students`(이니셜만 하이라이트), 스크롤 화살표 → `#about`
2. **About us** — 슬로건 + 본문. *데스크탑/모바일 슬로건을 둘 다 DOM에 렌더하고 CSS로 토글*
3. **Vision** — 슬로건 + 본문 (중앙 정렬)
4. **Research Areas** — 3블록 (UAV / Flight Control & Data / Rocketry & Propulsion)
5. **Mission** — 본문 + `주요 활동은 다음과 같습니다.`(하드코딩) + 5줄 리스트
6. **Donate** — 소개문, 사용처 제목 + `<ul>`, 인용구(하드코딩), 현재액/목표액(`Intl.NumberFormat('ko-KR')`), 진행률 바 + %, **`후원 문의하기` 버튼 → `alert("후원 페이지 준비 중 입니다")` 후 `#contact`**, 마무리 문구(하드코딩)
7. **Contact** — 본문 + 카드 2개 (`mailto:air091226@naver.com`, Instagram `@icaros_aerospace`)

데이터 흐름: `DEFAULTS`(home.jsx 하드코딩) 위에 DB `site_content`를 오버레이. 빈 값·null은 무시.
**⚠ `DEFAULTS`는 이미 라이브 DB와 어긋나 있다** (슬로건 강조 범위, `research.uav.body` 문구, 후원 금액, `donate.usage_list`).

### `/rocket`
- 시리즈 탭 2개(활성 탭 `disabled`), 카드 그리드(이미지 + 이름), `Loading...`
- 클릭 → 모달: 큰 이미지, 이름, `최대 고도 / 길이 / 페이로드`, 엔진 목록, `닫기`. 오버레이 클릭으로 닫힘
- 없음: 검색·필터, **개별 로켓 URL(딥링크 불가)**, ESC 닫기, 상세 설명, 갤러리, 3D

### `/posts`
- 카드 그리드 12개씩 `range()` 페이지네이션, `더 보기` 버튼
- 카드: 커버(없으면 `logo_black.svg`), 날짜(`en-CA` → `YYYY-MM-DD`), 제목, 요약(160자)
- 클릭 → 모달: **본문을 그때 개별 fetch** → `react-markdown` + `remark-gfm` + `rehype-highlight`
- 없음: **개별 포스트 URL**, 태그·카테고리, 검색, 정렬, ESC 닫기

### `/member`
- 카드 그리드: 프로필(없으면 `profile.webp`), 이름, 역할. `sort_order` 오름차순
- **`school` 미표시**

### `/admin`
게이트 3단계 (세션 확인 → 로그인 폼 → `is_admin()` 검사) 후 탭 4개.

| 탭 | 기능 |
|---|---|
| Posts | 제목 / 마크다운 툴바(H1·H2·H3·B·I·인용·link·**다중 이미지 업로드**·inline code, 커서 삽입 + 선택 래핑) / textarea / **실시간 미리보기** / Create·Update·Cancel / 목록(제목·날짜·Edit·Delete) / Refresh. 저장 시 `cover_url`·`summary` 자동 파생. 삭제 시 `confirm` → 본문 이미지 Storage 정리 → row 삭제 |
| Rockets | id(slug, 수정 시 잠김)·이름·시리즈 select·정렬순서·최대고도·길이·페이로드 / 이미지 업로드+미리보기 / **엔진 리스트 동적 추가·삭제**(type·thrust_n·burn_time_s·count·mode) / 목록(이름 + 시리즈 배지 + 요약 스펙) / Delete(이미지 동시 삭제) |
| Members | 이름·역할·학교·정렬순서 / 원형 프로필 업로드 / 목록(이름 / 역할 · 학교) / Delete(이미지 동시 삭제) |
| Landing | fieldset 6개(About·Vision·Research·Mission·Donate·Contact), **22개 필드**, `Save All` 일괄 upsert |

---

## 8. 확인된 결함 (리뉴얼에서 반드시 해소)

| # | 심각도 | 결함 | 위치 |
|---|---|---|---|
| 1 | **높음** | `fetchSiteContent`가 실패 시 `{}` 반환 → LandingPanel이 전 필드를 `""`로 초기화하고 에러를 표시하지 않음 → 사용자가 `Save All`을 누르면 **랜딩 카피 22개 키 전체가 공백으로 덮어써짐** | `lib/content.js:11`, `LandingPanel.jsx:67,76` |
| 2 | 중 | 이미지 교체 시 이전 Storage 오브젝트 미삭제 / 업로드 후 저장 취소 시 고아 발생 (현재 고아 3개) | `RocketsPanel.jsx:68`, `MembersPanel.jsx:39`, `PostsPanel.jsx:49` |
| 3 | 중 | 게시글 발행일 지정 불가 → 타임라인 왜곡 (10건이 한 날짜에 압축) | `PostsPanel.jsx:95` |
| 4 | 중 | `members.sort_order` 중복(값 5가 3행) + tie-break 없음 → 순서 비결정적 | `MembersPanel.jsx:24`, `member.jsx` |
| 5 | 중 | **`posts` 테이블 CREATE 문이 마이그레이션에 없음** (`0001`은 `alter table`만) → 새 환경 재현 불가 | `supabase/migrations/` |
| 6 | 낮 | DB CHECK 제약 0개 (`series`, 숫자 범위, 필수 필드) | 스키마 |
| 7 | 낮 | 저장 성공해도 이전 `error` 문자열이 남음 | Rockets/MembersPanel |
| 8 | 낮 | Suspense fallback `null` → 페이지 전환 시 빈 화면 | `App.jsx` |
| 9 | 낮 | 디스플레이 폰트가 ttf만(woff2 없음) + `Trial` 라이선스 — **상용 라이선스 확인 필요** | `App.css:10-18` |

---

## 9. 죽은 코드 · 미사용 자산 (이전 대상 아님)

| 항목 | 상태 |
|---|---|
| `src/component/Masonry.jsx` + `Masonry.css` | import 0건 |
| `public/assets/img/gallery/01~15.webp` (15장) | 참조 0건 |
| `public/assets/icx-2.fbx` | 참조 0건 — 3D 계획 흔적. **리뉴얼 3D의 소스 후보이나 웹 적합성 미검증(FBX → GLB 변환 필요)** |
| `public/assets/img/member/{kimkunwoo,standhyo,yunho}.*` | DB 참조 없음 |
| `public/assets/img/rocket/{icx2,icx2s}.webp` | 해당 로켓 DB에서 삭제됨 |
| `src/assets/rocket_info.json`, `member.json` | 구 시드 — 라이브와 불일치(로켓 7 vs 4, `ICX-I` vs `ICX-IA`, 구 부서명) |
| `src/index.css` | 0 바이트 |
| `src/posts.css` | `.gallery-modal*` / Masonry 잔여 규칙 다수, 일부 주석 인코딩 깨짐 |
| `supabase/functions/admin-posts/` | 이미 삭제됨 (CLAUDE.md 설명이 낡음) |

---

## 10. 외부 의존 지점 (Simulate 제거 대상 포함)

| 링크 | 위치 | 리뉴얼 처리 |
|---|---|---|
| `https://sim.icaros.kr/` | `Header.jsx` 2곳 (데스크탑 메뉴 + 모바일 버튼) | **전면 제거** (도메인·프로젝트 자체는 유지) |
| `.nav-simulate` / `.nav-simulate-mobile` | `Header.jsx`, `App.css` | **제거** |
| `mailto:air091226@naver.com` | `home.jsx` Contact | 유지 (CMS화) |
| `https://www.instagram.com/icaros_aerospace/` | `home.jsx` Contact | 유지 (CMS화) |

제거 후 잔존 검사 문자열: `simulate`, `sim.icaros.kr`, `nav-simulate-mobile`

---

## 11. 도메인 컨텍스트 (콘텐츠 판단 근거)

- **ICAROS** = Intelligent Creative Astronautics & Rocketry Organization of Students. 제주 중심 중·고등학생 항공우주 팀. 대학 랩도 회사도 아님 — 예산이 작고, 기체는 3D 프린팅, 발사는 빌린 땅에서 한다.
- 리드 김지후(표선고), 부리드 박현빈(남녕고). 27명.
- **두 트랙**: ① 고체연료 사운딩 로켓(KNSB 모터, 블랙파우더 사출, 캔셋, 낙하산 회수, TMS 정적연소) ② UAV/VTVL(EDF TVC 호버 기체, STOL RC 고정익, 비행제어·센서 데이터)
- **타임라인**: 2025-12 첫 모터 TMS + 발사대 제작 → 2026-01 ICX-I 완성, EDF TVC 설계 → 2026-06/07 TVC 호버 테스트 → **2026-07-18 첫 고체연료 발사**(ICX-1A, 알뜨르 비행장, 회수 성공) → **2026-08-17 RAON 발사**(금악 사유지, 테일핀 제어 성공·회수 성공, **사출장치 오작동으로 목표 고도 미달**)
- 기체 명명: `series A` = ICX 1/2 계열, `B` = ICX MV 계열. `RAON`은 ICX-II 기체의 고유명.
- Posts는 **실패를 실패로 적는** 공개 로그다. 리뉴얼 카피도 이 톤을 유지해야 한다.
- Donate는 실제 모금(목표/현재액 CMS 편집). **결제 연동 없음.**
- 보이스: 영문 섹션 헤딩 + 영문 슬로건(하이라이트 단어 1개) + 한국어 본문. 마케팅 과장 없음.

---

## 12. Gate 1 잔여 항목

- [ ] `git restore supabase/` — 삭제된 마이그레이션 복구 (사용자 확인 필요)
- [ ] `.env.local` 커밋 이력 확인
- [ ] `WdscnUEx` Trial 폰트 라이선스 확인 (상용 배포 가능 여부)
- [ ] `icx-2.fbx` 웹 적합성 평가 (폴리곤 수, 머티리얼, GLB 변환 가능성)
- [ ] Desktop / Mobile 스크린샷 캡처 (사용자 브라우저 사용 승인 필요)
- [ ] `essentia_infra` 응답 수신 → Gate 2 진입
