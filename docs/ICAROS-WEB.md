# ICAROS-web — 전체 구성 · 현 상태 · 문제점과 보완점

> 기준: 로컬 `main` = `91cbf0d` (2026-09-07) + 미커밋 4파일, 프로덕션 실측 **2026-09-20** (`https://icaros.kr`, GET/HEAD 만).
> 작성 방법: 서브시스템 독해 6 + 감사 렌즈 5 + 발견 항목별 독립 반박 검증 42 = 53 에이전트 병렬 실행, 총 1,400 회 도구 호출.
> 발견 72건 중 71건이 검증을 통과했고 1건은 반박돼 §6.9 에 따로 적었다. 근거는 전부 `path:line` 또는 실측값이다.
>
> 이 문서는 **설명서 + 감사 보고서**다. 결정 기록은 `docs/icaros-rebuild/DECISIONS.md`, 인프라 부채 대장은 `15-infra-debt.md` 가 정본이며 이 문서는 그것을 대체하지 않는다. 다만 §8.2 에 **정본이 실측과 어긋난 지점**을 모아 두었다.

---

## 목차

1. [30초 요약](#1-30초-요약)
2. [지금 알아야 할 사실 (실측)](#2-지금-알아야-할-사실-실측)
3. [구성요소 지도](#3-구성요소-지도)
   - 3.1 [라우트 한 장 표](#31-라우트-한-장-표)
   - 3.2 [공개 페이지 상세](#32-공개-페이지-상세)
   - 3.3 [관리 콘솔 `/admin`](#33-관리-콘솔-admin)
   - 3.4 [API 라우트](#34-api-라우트)
   - 3.5 [미디어 파이프라인](#35-미디어-파이프라인)
   - 3.6 [데이터 계층](#36-데이터-계층)
   - 3.7 [인증](#37-인증)
   - 3.8 [3D](#38-3d)
   - 3.9 [스타일 · 폰트 · 토큰](#39-스타일--폰트--토큰)
   - 3.10 [운영 — 스크립트 · 배포 · cron](#310-운영--스크립트--배포--cron)
4. [잘 되어 있는 것](#4-잘-되어-있는-것)
5. [이미지 로딩 — 원인과 보완안 (CDN 비교 포함)](#5-이미지-로딩--원인과-보완안)
6. [문제점 · 보완점 전체](#6-문제점--보완점-전체)
7. [실행 순서 제안](#7-실행-순서-제안)
8. [부록](#8-부록)

---

## 1. 30초 요약

**무엇인가.** 제주 중·고등학생 항공우주 팀 ICAROS 의 공개 기록 + 후원 창구. Next.js 16 App Router · React 19.2.8 핀 · Drizzle + `pg` · private S3 스트리밍 프록시 · 자체 Argon2id 인증. 공개 라우트 7개 + `/admin` 1개 + API 5개. 콘텐츠는 전부 DB(`icaros` 스키마 18 테이블)와 ESSENTIA Community API 에서 온다 — 코드에 카피가 없다.

**상태.** 서비스 중. 인증·DB·미디어 계층의 코드 품질은 높고(§4), 문제는 대부분 **프로세스와 배선**에 있다.

**지금 당장 (이번 주, 합쳐서 반나절):**

| # | 문제 | 왜 지금 | 근거 |
|---|---|---|---|
| 1 | **ESSENTIA 글 상세 `/posts/[id]` 가 프로덕션에서 500** — 최소 7일째 | 사이트 존재 이유(기록)의 신규 글 경로가 전부 죽어 있고 아무도 몰랐다 | §6.2-A |
| 2 | **프로덕션이 미커밋 워킹트리에서 CLI 배포된 상태** — DB 접속 경로(자체 호스팅·password·TLS)가 git 에 없다 | 다음 `git push` 한 번이 커밋본(TLS 없음·`max:5`·유휴 30s)으로 **회귀**시킨다 | §6.2-B |
| 3 | **함수 리전이 `iad1`(버지니아)** — 사용자·DB·S3 는 전부 서울 | "이미지가 늦다"의 근본 원인. CDN 미스 경로 1.3~5.3s | §5 |
| 4 | apex `icaros.kr` → www 307 이 2주째 — canonical 이 리다이렉트 주소 | 코드는 apex 를 정식으로 정했는데 대시보드가 안 바뀌었다 | §6.2-D |
| 5 | 배포 후 스모크가 수동 — 1번이 잡히지 않은 이유 | `scripts/smoke.ts` 가 정확히 그 검사를 갖고 있는데 돌린 사람이 없었다 | §6.2-E |

**이미지 CDN 결론 (§5).** 별도 이미지 CDN 은 **도입하지 않는다.** 변환은 이미 서울 엣지에서 돌고, 최적화기 캐시는 배포로 비지 않는다(문서 확인). 병목은 캐시 미스 때 **서울 → 버지니아 함수 → 서울 S3 → 버지니아 → 서울** 로 바이트가 태평양을 두 번 건너는 것이다. `vercel.json` 에 `"regions": ["icn1"]` 한 줄 + 코드 튜닝 4건이 답이고, 결정 D3/D12/D15 를 한 글자도 안 건드린다. 전제는 DB 호스트 SG 를 `ap-northeast-2` EC2 대역으로 재산출하는 것(사용자·ESSENTIA 조율).

---

## 2. 지금 알아야 할 사실 (실측)

코드를 읽기 전에 알아야 하는, 코드 밖의 사실들. 전부 2026-09-20 실측이다.

| 사실 | 값 | 함의 |
|---|---|---|
| 서빙 호스트 | `https://icaros.kr/*` → **307** → `https://www.icaros.kr/*` (전 경로, 정적 파일 포함) | 코드(`layout.tsx:36` `metadataBase`, canonical, og:url)는 apex. **양쪽이 어긋난 채 2주** |
| 엣지 / 함수 리전 | `x-vercel-id: icn1::iad1::…` — 엣지 서울, **함수 버지니아** | `vercel.json` 에 `regions` 없음 → 기본 iad1. 이미지·DB 왕복이 전부 태평양을 건넌다 |
| 프로덕션 코드 | 응답에 `x-icaros-shutter: false` 헤더 → 커밋 `91cbf0d` 가 배포됨. 그런데 **`origin/main` 은 `beb69ae`** (91cbf0d 미푸시) | 운영 빌드는 git 연동이 아니라 **로컬 워킹트리에서 CLI 로 올라간 것** — 미커밋 4파일 포함 추정 |
| 운영 DB | 미커밋 `connection.ts`·`tunnel.ts` 주석: "2026-09-06 자체 호스팅(EC2 + PgBouncer) 이전, 운영이 `password` 모드" | DECISIONS(D17/D20 "RDS + IAM")·`15-infra-debt.md`·CLAUDE.md·AGENTS.md 어디에도 없다 |
| 랜딩 모드 | 사진 패널 **5장** 공개(영상 0), 아래 `donate`·`contact` 섹션, `data-palette="mono"` | 3D 히어로·`about/vision/research/mission` 섹션은 렌더되지 않는다 |
| 캐시 | `/` HIT(revalidate 60) · `/member` HIT/STALE · `/vehicles/[slug]` HIT age 4~5일(revalidate false) · `/vehicles`·`/posts` MISS no-store · `/posts/legacy/[slug]` HIT | 2026-09-06 엣지 캐시 전환이 동작 중 |
| `/posts/[id]` | **HTTP 500** ×5 (Next 기본 500 페이지) | §6.2-A |
| 이미지 | 첫 패널 preload 있음, `fetchpriority` 없음, srcset 전부 `q=75`(코드는 `quality={82}`), alt 가 파일명(`hero-launch.webp`, UUID) | §5, §6.5 |
| 폰트 | Archivo·IBM Plex Mono preload 나감(CLAUDE.md "no-op" 서술은 낡음). Pretendard 는 preload 없음 + `max-age=0` | §6.4 |
| `robots.txt`·`sitemap.xml`·manifest | 전부 404 | §6.5 |
| 점검 셔터 | `MAINTENANCE_MODE=false` 설정됨(코드 기대값은 `on`/`off`). fail-open 이라 열려 있음 | §6.7 |
| `/assets/icx-2.fbx` | 16.9MB 원본이 공개 서빙 중 (200, 참조 0건) | §6.7 |
| 자동화 | `.github/` 없음, 테스트 0, CI 0. 마이그레이션·스모크·bootstrap 전부 노트북 수동 | §6.7 |

---

## 3. 구성요소 지도

### 3.1 라우트 한 장 표

| URL | 무엇 | 데이터 원본 | 렌더링 | 무효화 | 메타 |
|---|---|---|---|---|---|
| `/` | 사진 패널 랜딩(패널 ≥1) 또는 3D 히어로 + 섹션(패널 0) | `page_panels⋈media`, `site_settings`, `page_sections` | `revalidate = 60` | admin 액션 `revalidatePath('/')`, 배포 웹훅 `POST /api/revalidate` | og 전 키 명시(지뢰 방어) |
| `/vehicles` | 분류(rockets/satellites/uavs) → 시리즈 두 줄 탭 + 기체 카드 | `vehicle_types`, `rocket_series`, `rockets⋈media` | **`force-dynamic`** (`searchParams`) | — | 조합별 title/canonical; **og:image 누락(지뢰 밟음)** |
| `/vehicles/[slug]` | 기체 상세: 이미지·제원·Overview md·엔진 표 | `rockets⋈media⋈rocket_series`, `rocket_engines` | `revalidate = false` + `generateStaticParams(): []` | `revalidatePath('/vehicles/[slug]','page')` (rockets/series/scene 액션) | title=기체명, og:type=article, og:image=커버 |
| `/member` | 부서별 부원 카드 | `members⋈media` | `revalidate = 60` | `revalidatePath('/member')` | 정적 title; og 없음(루트 상속) |
| `/posts` | ESSENTIA Community ICAROS 글 + `legacy_posts` 19건 날짜 병합, 12건/페이지 | Community API(`no-store`) + `legacy_posts` | **`force-dynamic`** | — | canonical 없음 |
| `/posts/[id]` | Community 글 상세 | Community API | `revalidate = 300` + `generateStaticParams(): []` | 없음(시간만) | **현재 500** |
| `/posts/legacy/[slug]` | 이관 글 상세 | `legacy_posts` | `revalidate = false` | **없음** — 어드민 편집기가 없다 | title 만, description 없음 |
| `/rocket`, `/rocket/:slug` | → `/vehicles*` **308**, 쿼리 보존 | — | `next.config.ts redirects()` | — | — |
| `/admin` | 관리 콘솔(§3.3) | 전부 | `force-dynamic`, `runtime nodejs`, noindex | — | — |
| unmatched | 루트 `not-found.tsx` (헤더·푸터 없음) | — | 정적 프리렌더 | — | — |

렌더링 원칙: 모든 DB 로더는 fail-safe(`*Safe`, try/catch → 빈 값)라 **빌드가 RDS 에 닿지 못해도 죽지 않는다**(D27). 대가는 "빈 랜딩이 캐시에 박히는 창"이고, 그걸 배포 성공 웹훅 + 60초 백스톱 + `npm run smoke` 본문 검사가 닫는다.

### 3.2 공개 페이지 상세

#### 루트 레이아웃 `src/app/layout.tsx`
- `generateMetadata` 가 `getSiteContentSafe()` → `seo.title`·`seo.description`·`og.image_media_id`(UUID 면 `/api/media/{id}`, 아니면 `/og.png`). 던지지 않는 이유: DB 장애가 `/admin` 로그인 창구까지 500 으로 만들지 않기 위해.
- `metadataBase = https://icaros.kr`, `title.template = '%s · {seo.title}'`. `<html lang="ko">` + Archivo(`--font-display`, `wdth` 축)·IBM Plex Mono(`--font-mono`) 클래스.
- `<Loader />`(전면 커버, `load` 이벤트 또는 800ms 백스톱에 걷힘)와 `<QueryProvider>`(TanStack Query — **소비자 0개**, §6.4).

#### `(public)/layout.tsx`
- 스킵 링크 `#main` + `Header`(서버) + `<main id="main">` + `Footer`. Header/Footer 도 `getSiteContentSafe()`(요청당 `cache()` 1회).
- **내비 경로는 코드**(`lib/content.ts` `NAV_ITEMS`: `/#about`, `/vehicles`, `/posts`, `/member`), **라벨만 CMS**(`nav.about/rocket/posts/member`). `HeaderNav`('use client')가 햄버거·Esc·포커스 트랩·스크롤 잠금·`data-scrolled`(backdrop blur) 처리. `sim.icaros.kr` 링크는 헤더에서 **제거됨**(CLAUDE.md 서술이 낡음).
- 실측 라벨: About Us / **Rockets** / Posts / Members — `/#about` 은 패널 모드에서 착지점이 없고, `Rockets` 는 위성·UAV 까지 있는 `/vehicles` 로 간다(§6.5).

#### `/` 랜딩 `src/app/(public)/page.tsx`
두 모드를 코드가 가른다. `Promise.all([getSiteContentSafe, loadSections, getLandingPanelsSafe])` 후 `panels.length > 0` 이면:

**(a) 사진 패널 모드 (현재).** `REPLACED_BY_PANELS = {hero, about, vision, research, mission}` 을 섹션 목록에서 빼고 `<div data-palette="mono">` 로 감싼다(검정·흰색만). `donate`·`contact` 섹션은 남는다.
- `Panel.tsx`(서버): 한 장 = 사진 또는 영상 + 헤드라인/본문/CTA. 종류 판정은 `media.mime` 의 `video/` 접두사 하나(`page_panels` 에 종류 컬럼 없음).
  - 사진: `next/image` `src=/api/media/{id}` + 실측 `width/height` + `sizes="100vw"` + `priority={first}` + `quality={82}`(→ 실제 75, §6.4). 첫 장만 preload, 2~5 장 `loading="lazy"`.
  - 영상: `<video autoplay muted loop playsinline preload={first?'metadata':'none'} aria-hidden>` + 인라인 스크립트가 `prefers-reduced-motion` 이면 autoplay 해제(클라이언트 번들 0). `/api/media` 가 Range 를 S3 로 그대로 넘겨 탐색이 된다.
  - 첫 패널만 `<h1 lang="en">`, CTA 는 `next/link` `lang="ko"` 고정. CTA 허용값 `PANEL_CTA_HREFS = /vehicles|/member|/posts|#support|#contact` 가 DB CHECK 까지 박혀 있다. **`#support` 는 착지점이 없다**(섹션 id 는 `donate`).
  - `alt = media.original_filename` → 실측 `hero-launch.webp`, `e6c46022-…-04.webp`. `eyebrow` 컬럼은 admin 폼에만 있고 공개 렌더에서 제거됨(커밋 979d802).
  - 레코드 값(`focal_x/y`, `scrim` 4종, `anchor` 4종, `height` full/tall/half = 100/80/56 dvh)은 CSS 변수·`data-*` 로만 옮긴다. `panel/Reveal.tsx` 가 마운트 후 `data-reveal=pending` → IO 교차 시 `in`(900ms). `placeholder`/blur 없음 — 도착 전엔 `--n-950` 단색.
- 실측 패널 5장: 헤드라인 전부 영문("We learn from COSMOS / not only textbook" 등), CTA 전부 한국어(`기록 전체 보기→` 등), CTA href `/posts`·`/vehicles`·`/posts`·`/member`·`#contact`. 크기 1600×843 / 1600×908 / 1240×1600 / 1600×1066 / 1600×982.

**(b) 폴백 모드 (패널 0).** `Hero`(로고 h1 + `hero.tagline` + `Initials` 이니셜 강조 + `data-webgl-target` 빈 박스 + `HeroStage`) → `page_sections` 가 켠 순서대로 `Statement`(about=split+단어 리빌 / vision=center)·`Research`(3블록)·`Mission`(본문+목록)·`Donate`·`Contact`. 테마는 코드 상수 `SECTION_THEME`(hero ink / about paper / vision white / research mist / mission paper / donate graphite / contact ink). 각 섹션은 `has*Content` 술어로 빈 섹션을 통째로 건너뛴다. `npm run panels:publish -- --off` 로 여기로 돌아온다.

**공통.** `Donate`: `donation.current/goal`(콤마 허용 `toNumber`) 큰 숫자 + `role=progressbar`(실측 68%) + 사용처·인용·CTA. **결제 연동 없음** — CTA 는 `#contact` 또는 `mailto:`. 화면 숫자에 '원' 단위가 없다(aria-valuetext 에만). `Contact`: `contact.body/email/instagram`. 후원 CTA href 는 contact 섹션이 렌더되면 `#contact`, 아니면 `mailto:{contact.email}`. `<noscript><style>` 이 리빌 숨김을 해제.

`generateMetadata`: `about.body` 앞 160자를 description 으로(문장 중간에서 잘림, §6.5), openGraph **전 키 명시**해 루트 `og:image` 소실 지뢰를 홈만 피했다.

#### `/vehicles` (목록)
- `?type=<vehicle_types.id>` `?series=<rocket_series.id>`. `parseVehicleType` 은 `type` 우선, 무효면 `series` 소유 분류, 그것도 없으면 첫 분류; `parseSeries` 는 그 분류 안에서만. 기본값은 쿼리에 넣지 않아 canonical 이 하나로 모인다. `?type=bogus` → 200 기본 조합.
- 데이터: `listVehicleTaxonomy()`(types → series **순차 2쿼리**, D26 때문에 `Promise.all` 안 씀) → `listRocketsBySeries()`. 실측 웜 TTFB 0.85~0.91s, 콜드 2.1s(§6.4).
- `TabNav`(`<nav>`, `aria-current`, 항목 2개 미만이면 생략) 두 줄, 시리즈 `description_md` 는 `Prose`(react-markdown+gfm, `skipHtml`, 서버). 빈 상태 3단. **Suspense 를 일부러 두지 않는다**(스켈레톤이 크롤러에 남고 탭이 사라짐).
- `RocketCard`: `<li data-reveal-item>` + `fill` + vw `sizes` + `<dl>` 제원 3행(null 은 `—`, 문자열 `'0'` 은 그대로 → 위성·UAV 에 "최대 고도 0m" 노출, §6.5). 카드 전체 클릭은 `.link::after`.
- 이미지 두 세대 공존: `cover_media_id` → `/api/media/{id}`, 없으면 `legacy_image_path` → `/assets/img/rocket/*.webp`.

#### `/vehicles/[slug]` (상세)
- `getRocket(slug)`: published=false 또는 없음 → `notFound()`. **`loading.tsx`/Suspense 를 두면 soft-404 가 된다**는 주석 명시. 실측 `/vehicles/nope` 404.
- 이미지 `<Image fill sizes="(max-width:899px) 62vw, 26rem" priority alt="{name} 기체 외형">` 를 `[data-rocket-viewer]` 박스 안 `[data-viewer-poster]` 에 — 3D 뷰어 마운트 지점이지만 **캔버스를 붙이는 코드는 없다**.
- Overview 는 데스크톱에서만 `ScrollRegion`(클라이언트, 넘칠 때만 `role=region tabIndex=0`). `EngineTable` 은 `mode` 열이 전부 비면 열을 뺀다. 뒤로가기는 실제 소속 분류·시리즈 탭으로.
- `listPublishedRocketSlugs()` 는 호출처 없음(프리렌더 목록용으로 남김).

#### `/member`
- `listMembersSafe()`: `members⋈media`(ready·미삭제) where published, 정렬 `(sort_order, created_at, id)`. `groupBySquad()` 는 첫 등장 순, `squad null` 은 '기타' 마지막. 실측 부서: 총괄 / 비행제어부 / 추진공학부 / 전자부 / 법률·재무팀 / SW · 디자인.
- `MemberCard`: `fill` + `sizes="(max-width:599px) 44vw, (max-width:999px) 24vw, 16rem"`. 사진 우선순위 S3 → `legacy_image_path` → `/assets/img/member/profile.webp` 플레이스홀더(`alt="" aria-hidden`). 실제 사진은 `alt="{이름} 프로필 사진"`. 이름·역할·학교만(미성년자). `bio_md` 는 `skipHtml` + `disallowedElements=['img']`.
- `entity_type=member` 라 `/api/media` 는 `private, no-store` — 그런데 `next/image` 를 타므로 `/_next/image` 변형이 `public, max-age=60` 으로 엣지에 남는다(§6.8).
- 실측: 카드 29장, `/api/media/` 32건 + `/assets/img/member/` 참조 200건(플레이스홀더 공유), 소개글 있는 카드는 한 행 전체.

#### `/posts`
- `getFeed(page, 12)`: `[listIcarosPosts(0, (page+1)*12) ∥ allLegacy()]` → `published_at` 내림차순 병합(같은 날은 community 우선) → 슬라이스 → 그 페이지의 community 글만 `getIcarosPostPreviews`(상세 N회, 개별 4s, 총 예산 1.5s, 인스턴스 캐시 10분·64건) 로 썸네일·발췌 보강.
- 상류 `unreachable` 이면 레거시만 + `role=alert` 한 줄, 둘 다 비면 ESSENTIA 링크 안내. **404 로 만들지 않는다**(D23).
- `PostCard`: 우리 프록시 썸네일은 `next/image width=576 height=384`(1x/2x 두 변형만), ESSENTIA 호스트 사진은 raw `<img loading=lazy fetchPriority>`(`remotePatterns: []` 때문). `priority` 는 사진 있는 첫 카드(인덱스<3) 한 장. 발췌는 `cardExcerpt()`(마크다운·이미지 토큰·카메라 파일명·UUID 제거, 산문 아니면 빈 문자열).
- `?page=N` 은 0-기반이라 `?page=1` 이 화면 '2'. 범위 밖 `?page=99` 도 200 + 빈 목록. `data-palette="mono"` 없음(ink 테마), canonical 없음.
- 실측 1페이지: community 1건 + legacy 11건.

#### `/posts/[id]` (Community 상세)
- `getIcarosPost(id)`: UUID 형태 검사 → `GET /api/forum/posts/{id}` → `projectId` 불일치는 `bad_response`. `not_found`·`bad_response` → `notFound()`, `unreachable` → 200 + '지금 이 기록을 불러올 수 없습니다'(최대 300초 캐시되는 대가를 주석에 기록).
- 본문 `react-markdown + gfm + skipHtml`, 이미지 상대경로 `/api/forum/image/…` 는 API 호스트 절대 URL 로 치환. 하단 '목록으로' + 'ESSENTIA 커뮤니티에서 보기'.
- **현재 500** — `revalidate = 300` ISR 선언과 어댑터의 `cache: 'no-store'` fetch 충돌(§6.2-A).

#### `/posts/legacy/[slug]`
- `legacy_posts where slug and published limit 1`, 없으면 404. `react-markdown + gfm` — **`skipHtml` 없음**(신규 상세·기체 설명과 다름). 본문 이미지는 이관 때 `/api/media/{id}` 로 치환됐고 DB CHECK 가 `supabase.co` 잔존을 막는다. `data-palette="mono"`, 신규 상세와 CSS 모듈 공유.
- 무효화 경로 없음 — `/admin` 에 편집기가 없기 때문. 실측 HIT age 약 5일.

#### 에러 · 404 · 점검 셔터
- `error.tsx`('use client'): `console.error('[icaros] render error', digest ?? message)` 만, '문제가 발생했습니다' + '다시 시도'. `global-error.tsx` 없음. `src/app/admin/error.tsx` 없음(어드민 예외가 공개용 화면으로 샌다, §6.6).
- `not-found.tsx`(루트): '404 / page not found / Back to home', `data-theme=dark`, 80vh 상자. unmatched URL 에서는 헤더·푸터·스킵링크 없음; `notFound()` 를 던지는 3개 상세 라우트에서는 `(public)` 레이아웃 안에서 렌더돼 헤더·푸터가 있다(빌드 트리 확인).
- `src/middleware.ts` 점검 셔터: `MAINTENANCE_MODE` trim+lowercase `=== 'on'` 일 때만 503 + `Retry-After: 3600` + noindex HTML 을 **앱·DB 와 무관하게 직접** 낸다(rewrite 는 200 으로 고정되기 때문). fail-open. `ALWAYS_OPEN = /admin, /api/upload, /api/media, /api/cron, /api/revalidate`. `?maintenance_bypass=<MAINTENANCE_BYPASS>` → 8시간 httpOnly 쿠키(비밀값 원문 저장, §6.8). 진단 헤더 `x-icaros-shutter`. matcher 가 `_next/*`·`robots.txt`·`sitemap.xml`·정적 확장자 제외. Next 16 에서 `middleware` 규약은 deprecated(→ `proxy`).

### 3.3 관리 콘솔 `/admin`

단일 라우트. **상태는 전부 URL 쿼리** `?tab=&sub=&new=1&edit=&delete=&saved=` — 새로고침·공유·뒤로가기가 그대로 되고 탭 전환 JS 0줄. 쿼리 조립은 `_tabs.ts` `adminHref()` 한 곳(예외: `PanelRowActions`·`PanelForm` 이 문자열 직접 조립). 3분할 `_actions/`('use server') · `_data/`(server-only) · `_lib/`(form·version·media) · `_panels/` · 폼 잎만 `components/admin/*`('use client').

| 탭 | URL | 하는 일 | 폼 필드 · 규칙 |
|---|---|---|---|
| 게이트 | `/admin` | `layout.tsx` 가 세션 확인 → 미인증이면 `children` 을 트리에 넣지 않고 `LoginForm` 만(패널 DB 조회 자체가 안 일어남). `page.tsx` 가 한 번 더 확인. 비활성 계정은 별도 안내 | 로그인 실패 단일 문구, DB 기반 rate limit(5회 60s → 6회 5분 → 7회 15분 → 8회+ 1h), 잠금 중에도 더미 verify 로 시간차 제거 |
| **Posts** | `?tab=posts` | **CRUD 없음**(D1) — 안내 + ESSENTIA 커뮤니티 외부 링크 | 서비스 토큰(D25) 대기 |
| **Panels** | `?tab=panels` | `page_panels` CRUD·↑↓ 순서·공개 토글·삭제 | 배경(업로드 또는 기존 media 고르기 격자 + 초점 클릭 + 16:9/9:16 크롭 미리보기) · `eyebrow`(공개 렌더 없음) · `headline`(필수) · `body` · `scrim` · `anchor` · `height` · `ctaLabel`+`ctaHref`(함께 있거나 함께 없음). 생성은 **`published=false`**. 토글은 버전 토큰 없이 last-write-wins. 삭제해도 사진은 안 지움(cron 몫). 고르기 목록이 `entity_type`·`deleted_at` 을 안 거른다(§6.6). **액션 5개가 `if (!(await requireAdmin())) return DENIED` 패턴** — `requireAdmin()` 은 throw 하므로 도달 불가, 예외가 화면으로 샌다(§6.6) |
| **Vehicles** | `?tab=rockets` | `rockets` + `rocket_engines`(≤12) + 대표 이미지(`hero` kind) + 갤러리(`media` kind ≤12, 순서는 `site_settings` `rocket.<id>.gallery` CSV) | `id`(slug, 편집 시 readOnly) · `name` · `series`(분류별 optgroup) · `sortOrder`(편집만, `(series,sort_order)` unique) · 제원 3종 numeric · `published` · `descriptionMd`(≤20000) · 엔진 평행 배열. `FOR UPDATE` + 행 토큰 낙관적 잠금 → `CONFLICT`. 커밋 후 `retireMedia()`. `revalidatePath('/vehicles')` + `('/vehicles/[slug]','page')` |
| Vehicles › Series | `&sub=series` | `rocket_series` CRUD. 마지막 1개 삭제 거부, 로켓 남으면 FK restrict 문구 | `id`(대문자 허용, 편집 readOnly) · `label` · `typeId` · `descriptionMd` · `sortOrder` |
| Vehicles › Types | `&sub=types` | `vehicle_types` CRUD. 시리즈 액션과 같은 모양 | `id` · `label` · `sortOrder`. 설명 컬럼 없음 |
| **Members** | `?tab=members` | `members` CRUD + 프로필 사진(`member` kind 512px·1MB) | `name` · `role` · `squad`(datalist) · `school` · `sortOrder` · `imageMediaId` · `bioMd`(≤2000, 미성년자 신원 정보 금지 힌트) · `published`. `revalidatePath('/member')` |
| **Landing** | `?tab=landing` | `site_settings` 화이트리스트 **34키**(`LANDING_GROUPS`) + `page_sections` enabled/sort_order, 폼 2개 | 키가 DB 에 하나라도 없으면 폼을 막는다(F8). 저장은 카탈로그 전체를 `FOR UPDATE` + **집계 토큰 하나**(다른 칸을 고친 사람과도 충돌, §6.6). 슬로건은 `**단어**` 미리보기. `og.image_media_id` 는 UUID 직접 입력. `revalidatePath('/', 'layout')` |
| **3D Scene** | `?tab=scene` (`ADMIN_TABS` 밖, `sceneHref()`) | `rocket_models`(숫자·열거 컬럼 + `camera_presets`·`extras` jsonb) · `rocket_hotspots`(≤24) · `home_feature` 싱글턴. **3D 뷰어 없음**(F13), 임의 JS 저장 불가(G13) | GLB·포스터 media id **텍스트 직접 입력**. `verifyMediaRefs` 가 mime·ready·삭제 여부 확인(FK 없는 컬럼). 프리셋·extras 는 zod strictObject 두 단계 검증, 읽기도 같은 스키마 통과. **랜딩 `HeroStage` 는 이 데이터를 읽지 않는다**(D19, `DEFAULT_STAGE` 상수) |

공통 규약: 모든 mutation 첫 줄 `requireAdmin()`(Origin 허용목록 + 세션) → zod → `db.transaction` → 커밋 후 `retireMedia()` → `revalidatePath` → `redirect(adminHref({saved}))`. 액션은 `ActionResult`(`DENIED`/`CONFLICT`/`MALFORMED`/`fail()`)로 내려온다(Panels 제외). 삭제 확인은 `window.confirm` 이 아니라 `?delete=<id>` URL 상태. `MarkdownField` 는 공개 페이지와 같은 파이프라인으로 실시간 미리보기. `runtime='nodejs'` 는 액션 파일이 아니라 `layout.tsx`·`page.tsx` 에 선언.

없는 것: 비밀번호 변경·계정 활성화 UI(구현은 `lib/auth/account.ts` 에 있으나 호출부 0), 비공개 패널 미리보기, 공개 페이지로 가는 링크, 패널 일괄 공개/내림(스크립트만), alt 입력 칸, 어드민 전용 `error.tsx`.

### 3.4 API 라우트

| 라우트 | 인증 | 하는 일 |
|---|---|---|
| `POST /api/upload/presign` | `requireAdmin()` + 관리자별 60초/30건 쿼터(`login_attempts` 재사용) | zod + `checkUploadCandidate` → `media` 행 **pending 으로 먼저 insert** → presigned PUT(`content-type;host` 서명, 600s). Route Handler 인 이유: Server Action 은 클라이언트당 직렬이라 다중 업로드가 줄을 선다 |
| `POST /api/upload/confirm` | `requireAdmin()` | `HeadObject` 크기 실측(상한 = min(폴더 절대상한, presign 선언 크기)) → 선두 16바이트 `sniffMime`(RIFF/WEBP · glTF · ftyp) ≠ DB mime 이면 객체 삭제 + 415 → `ready`, `etag` 저장. width/height 는 서버가 디코딩하지 않는다(클라이언트 신고값) |
| `GET /api/media/[id]` | 없음(공개) | `getServableMedia`(UUID 검사 → 인스턴스 로컬 60s 캐시(캐시 가능 종류만, 256건) → DB) → `If-None-Match` 304(S3 호출 전) → S3 `GetObject` 스트리밍(Range 그대로, 206) → DB mime 강제 + `Content-Disposition`(`?download=1` 이면 attachment). 캐시 헤더 허용 목록 `rocket|landing|model|poster|post` → `public, max-age=31536000, immutable`, 그 외·null·`member` → `private, no-store`. **302 가 아니라 스트리밍**(D15) |
| `GET /api/cron/storage` | `Bearer $CRON_SECRET` 상수시간(미설정 → 항상 401) | `sweepStalePendingUploads`(pending>30분, ready·미부착>24h) → `runCleanupJobs`(attempts<10, 20건) → 포기된 잡 `console.warn` → 지운 게 있으면 `revalidatePath('/','layout')`. Vercel cron `17 3 * * *` **UTC**(KST 12:17) |
| `POST /api/revalidate` | `Bearer $REVALIDATE_SECRET` 또는 `x-vercel-signature` HMAC-SHA1(`VERCEL_WEBHOOK_SECRET`) — 둘 다 없으면 **503** | `payload.target !== 'production'` 이면 skip → `revalidatePath('/', 'layout')`. 배포 성공 직후 빈 프리렌더 캐시를 비우는 훅. 재생·연타 제한 없음 |

### 3.5 미디어 파이프라인

```
[업로드] 관리자 브라우저
  prepareUpload(file, kind)            encode.ts — canvas WebP(품질 0.85→0.60 하향 루프), GLB/MP4 는 매직넘버·치수만
  → POST /api/upload/presign           media 행 pending + presigned PUT
  → PUT S3 (브라우저 직행)              함수 본문 제한 무관
  → POST /api/upload/confirm           HeadObject 실측 + sniff → ready
  → 폼 hidden 에 media id 하나          저장 액션이 checkMediaAttachable → stampMediaEntity(entity_type/id 도장)

[서빙] <Image src=/api/media/{id}> → /_next/image?url=…&w&q=75 (Vercel 최적화기, 서울 엣지)
  캐시 미스 시 → GET /api/media/{id} (함수 iad1) → DB(60s 로컬 캐시) → S3(ap-northeast-2) 스트림
  → webp 변형 → 엣지 캐시(immutable 종류 1년; 배포로 비지 않음)

[정리] 어드민 저장/삭제 → retireMedia → deleteMedia(hasReferences 9조회 → soft delete → DeleteObject → 실패 시 storage_cleanup_jobs)
  Vercel cron 03:17 UTC → /api/cron/storage
```

- 정책 단일 원본 `src/lib/image/policy.ts`: `media` 1MB·512px / `hero` 2MB·1600px / `poster` 2MB·1600px / `glb` 8MB / `video` mp4 32MB. SVG/HTML 이중 차단. `MEDIA_ENTITY_TYPES = rocket|member|landing|model|poster|post`. 브라우저 인코더와 서버 zod 가 **같은 상수·같은 판정 함수**를 본다.
- 참조 목록 `src/lib/s3/media-references.ts`: FK 5(`rockets.cover_media_id`, `members.image_media_id`, `rocket_models.glb/poster_media_id`, `page_panels.media_id`) + 텍스트 5(`site_settings.value`, `legacy_posts.content_md`, `members.bio_md`, `rockets/rocket_series.description_md`) + FK 불가 1(`legacy_posts.cover_media_id`, text 타입). `db:verify` 가 `information_schema` 실제 FK 와 "DB 에 있는데 목록에 없는" 방향만 대조 — D28(정리 cron 이 랜딩 사진 4장을 지운 사고)의 재발 방지.
- 실제 DB FK 는 `page_panels.media_id`(restrict) 하나뿐. 나머지는 관례 참조.
- `next.config.ts images`: `remotePatterns: []`(외부 최적화 금지 — 열면 presigned URL 이 src 로 샌다), `formats: ['image/webp']`, `deviceSizes: [640, 828, 1200, 1920, 3840]`(8→5, D26), `imageSizes: [128, 256, 384]`, `qualities` 미설정(→ `[75]`).

### 3.6 데이터 계층

**하나의 DB, 두 소유자.** ICAROS 는 `icaros` 스키마만 소유. `public` 은 ESSENTIA Flyway 단독 소유(`ddl-auto: validate` 라 뭐든 만들면 상대 API 가 죽는다, D2). 런타임 role `icaros_app` 은 DML 만, `icaros_migrator` 만 DDL. 모든 테이블이 `pgSchema('icaros')` 로 한정돼 런타임 쿼리는 `search_path` 에 의존하지 않는다.

**접속 모드** `src/lib/db/connection.ts` — `DB_AUTH === 'iam'` 이면 IAM(RDS 토큰 15분, 10분 모듈 캐시, `@vercel/functions/oidc` 경유, CA `verify-full` 상당 필수·없으면 throw), 그 외 password(`DATABASE_URL`). 풀 `max:3 / idle 10s / connectionTimeout 10s`(인스턴스당, D26). `PGTUNNEL_HOST/PORT` 로 접속 주소만 바꾸고 서명·TLS 신원은 실제 호스트 유지.
- **커밋본**의 password 분기는 `max:5·idle 30s·타임아웃 없음·TLS 없음`. **미커밋본**이 POOL 통합 + password 모드 TLS(`RDS_CA_BUNDLE*` + `PGSSL_SERVERNAME`, 원격 평문 fail-closed) + `||` 보정을 추가했다. 주석: "2026-09-06 자체 호스팅 이전으로 운영이 password 모드", "PgBouncer 가 `options` startup parameter 를 버리므로 `search_path` 는 서버측 `ALTER ROLE … SET search_path`".

**테이블 18개 + 원장**

| 파일 | 테이블 | 요지 |
|---|---|---|
| `content.ts` | `site_settings` | key/value. 랜딩 카피·nav·SEO·`donation.*`. 유일 원본, 폴백 사본 없음 |
| | `page_sections` | id(hero…contact)·label·enabled·sort_order. 폴백 모드 전용. 테마 컬럼 없음 |
| | `vehicle_types` | 분류(rockets/satellites/uavs). 0007 이 `rockets` 만 삽입, 나머지는 `seed:w5` |
| | `rocket_series` | 시리즈. `type_id` FK, `description_md`. 0006 이 CHECK `in('A','B')` 를 행으로 내림 |
| | `rockets` | slug PK · `series` FK · 제원 numeric 3 · `cover_media_id`(FK 없음) · `legacy_image_path` · published. UNIQUE `(series, sort_order)` |
| | `rocket_engines` | 로켓당 엔진 행(cascade). type·thrust·burn·count·mode |
| | `members` | 이름·역할·부서·학교·`bio_md`·`image_media_id`(FK 없음)·published. 인덱스 `(sort_order, created_at)` |
| `media.ts` | `media` | bucket·key·original_filename·mime·size·etag·width·height·status(pending/ready/failed)·entity_type·entity_id·deleted_at. CHECK key 프리픽스 `icaros-web/%|forum/%`. `media_key_uq` 는 이름과 달리 **비유니크** |
| | `storage_cleanup_jobs` | 삭제 재시도 큐. attempts·last_error·completed_at |
| `auth.ts` | `admin_users` | email(lower unique)·Argon2id hash·is_active·`password_changed_at`(세션 무효화 기준) |
| | `admin_sessions` | `token_hash`(SHA-256 bytea)·expires·last_seen·revoked·ip·ua |
| | `auth_events` | 8 kind CHECK. 비밀 절대 미저장. FK 없음(계정 삭제 후 보존). 읽기 경로 없음 |
| | `login_attempts` | 범용 키 카운터(`email:`·`ip:`·`presign:`). 정리 경로 없음 |
| `three.ts` | `rocket_models` | GLB/포스터 id(FK 없음)·transform·camera·`camera_presets` jsonb·환경·`extras` jsonb. CHECK 로 임의 JS 차단 |
| | `rocket_hotspots` | 모델당 핫스팟(cascade) |
| | `home_feature` | `id='singleton'` 단일 행 |
| `panels.ts` | `page_panels` | **`media_id NOT NULL` FK restrict**(사진 없는 패널 불가). 열거값·focal·cta 짝 CHECK. 실제 media FK 는 이것 하나 |
| `posts.ts` | `legacy_posts` | 이관 19건. `cover_media_id` 는 text(FK 불가). CHECK `content_md not like '%supabase.co%'` |
| (러너) | `__drizzle_migrations` | id·hash·created_at. `migrate.ts` 가 `create table if not exists`. 주체·커밋 기록 없음 |

마이그레이션 `drizzle/0000~0007` 8개. 0006·0007 은 데이터 이동을 손편집(주석 명시). `npm run db:generate` 만 쓰고 `drizzle-kit migrate` 는 쓰지 않는다(실패를 삼키고 exit 0) — `scripts/db/migrate.ts` 가 파일당 1 트랜잭션·`CREATE SCHEMA` 스킵·`public` 테이블 수 전후 비교. `db:verify` 가 원장 행수 = 파일 수, `public` 에 우리 role 소유 0, media FK 대조.

**ESSENTIA Community 어댑터** `src/lib/community/client.ts`: `server-only`. `call()` = `fetch(cache:'no-store', timeout 8s)`; 404 → `not_found`, !ok·예외 → `unreachable`, 모양 다름 → `bad_response`. **예외 대신 값**(`CommunityResult`). `listIcarosPosts` 는 `projectId` 로 한 번 더 필터. 썸네일 출처는 API 호스트 origin 으로 제한. 쓰기 함수 없음(D1/D25 대기).

### 3.7 인증

자체 구현. 외부 SaaS 없음, 공개 가입 없음(`npm run bootstrap:admin` 으로만 발급).
- Argon2id `m=19456, t=2, p=1`, 최소 12자(코드포인트). 실패 경로마다 더미 verify(계정 열거 방지). 로그인 시 약한 파라미터면 rehash.
- 쿠키 `__Host-icaros_session`(httpOnly·secure·lax·path=/)에 원문 토큰, DB 에는 SHA-256. 절대 7일 · 유휴 8시간 · `last_seen_at` 5분 스로틀. 판정은 단일 쿼리(revoked·expires·idle·is_active·`created_at ≥ password_changed_at`) + `timingSafeEqual`.
- CSRF 3중: ① `SameSite=Lax` ② `next.config.ts serverActions.allowedOrigins`(호스트 목록) ③ `requireAdmin()` 의 명시적 Origin 검증(fail-closed). **`ADMIN_ALLOWED_ORIGINS` 를 두 곳이 다른 형식으로 읽는다** — Next 는 호스트, `guard.ts` 는 절대 URL(스킴 없으면 https 보정; 선언됐는데 전부 파싱 실패면 전건 거부).
- `changePassword()`·`setAdminActive()`(자기 자신·마지막 활성 관리자 방어) 구현돼 있으나 **UI 호출부 없음**. `deleteStaleSessions()` 도 호출처 없음.

### 3.8 3D

- `HeroStage`(패널 0일 때만 렌더): 하이드레이션 후 rAF 에서 `probe()` — 모바일(≤767px) 기본 off → WebGL2 실제 생성 → `saveData` → `deviceMemory<4`. 통과해야만 `next/dynamic(() => import('./Scene'), { ssr:false })` — **막히면 three 청크가 네트워크에 나가지도 않는다.** 실패·차단 시 포스터 `<Image fill>`.
- `Scene`: R3F `Canvas`, GLTFLoader + Meshopt, drei 없음. 캔버스는 `[data-webgl-target]` rect 를 읽기만(`trackRect`, rAF 1회/프레임, 0.5px 미만 무시). `framing.ts` 가 AABB 8꼭짓점 투영으로 카메라 거리 계산, 스크롤·커서 시차. 뷰포트 밖이면 `frameloop='never'`.
- 설정은 `DEFAULT_STAGE` 상수(`/assets/models/icx-2.glb` 2.0MB, `icx-2-poster.png`, yaw -28 / pitch 8 / fov 28). DB(`rocket_models`)를 읽지 않는다(D19). `/assets/models/*` 는 immutable 1년.
- 파이프라인 `scripts/model/`: `fbx-to-glb` → `optimize-glb`(meshopt, `--min-part`, `--simplify`) → `inspect-glb`·`verify-runtime-load` → `render-poster`(소프트웨어 래스터라이저). 입력 원본 `public/assets/icx-2.fbx` 16.9MB 가 추적·공개 서빙 중.
- 현재 프로덕션은 패널 모드라 3D 경로가 렌더되지 않는다. 다만 `HeroStage` 청크(3.3KB br)는 초기 스크립트에 실린다.

### 3.9 스타일 · 폰트 · 토큰

- `tokens.css`: `html{font-size:62.5%}`(1rem=10px), 뉴트럴 램프 `--n-0…950`, 시그널은 **무채색 먹색 `#101418`**(CLAUDE.md 의 `--sig #ff7a00` 규약은 낡음), 섹션 테마 5값 `white|paper|mist|graphite|ink`, `[data-palette='mono']` 가 `--bg:#000 / --fg:#fff / --fg-faint: white 38%` 로 잠근다(`/admin` 제외).
- `globals.css`: `:lang(ko){letter-spacing:0}` 가드(모듈 CSS 가 소스 순서로 이기므로 각 모듈에서 `:lang(ko)` 명시 필요), 리빌 상태는 데이터 속성(`[data-reveal=block]`, `[data-reveal-item]`, `[data-word]`, `[data-shown]`), `prefers-reduced-motion` 이면 초기 숨김 자체 없음.
- 폰트: Archivo(display, `wdth` 125)·IBM Plex Mono 는 `next/font/google`(preload + size-adjust Fallback **실제로 나감**). 본문 Pretendard 는 `fonts.css` 수기 `@font-face` 6개(400/500/600 × base 104KB / rest 560KB, `unicode-range` 분할) — preload 없음, Fallback 메트릭 없음, `/fonts/*` 는 `max-age=0`. `npm run fonts:subset` 은 **스텁**(exit 1, 절차는 `13-fonts.md`).
- `**단어**` 는 마크다운이 아니라 자체 표기(`Words`/`Highlight`, 같은 정규식). `Initials` 는 ICAROS 이니셜 자동 강조.

### 3.10 운영 — 스크립트 · 배포 · cron

**배포.** `main` 푸시 → Vercel(설정상). `vercel.json` 은 `framework: nextjs` + cron 1개, `regions`·`outputDirectory` 없음. `.vercel/project.json` 링크 존재. **실측상 현재 운영 빌드는 CLI 배포**(§2). 자동 게이트는 `next build` 의 typecheck 뿐 — lint·스모크는 사람.

**npm scripts** (위험도: 🔴 운영 쓰기 / 🟠 운영 읽기·조건부 / 🟢 로컬)

| 명령 | 하는 일 | 위험 |
|---|---|---|
| `dev`(5174) · `build` · `start` · `lint` · `typecheck` | 기본. `.env.local` 의 `DB_AUTH=iam` 이면 `dev` 도 원격 | 🟢 |
| `db:generate` | drizzle-kit generate(DB 미접속). 산출물 손편집 관례 있음 | 🟢 |
| `db:migrate [-- --dry]` | 자체 러너, role migrator, 파일당 1 트랜잭션, public 수 대조 | 🔴 승인 |
| `db:verify` | 원장·소유자·media FK 대조 | 🟠 |
| `db:tunnel` | `aws ssm start-session` 포트포워딩(로컬 5433). `PGHOST` 있으면 EC2 경유, 없으면 대상 인스턴스 자신(미커밋) | 🟠 |
| `db:studio` | drizzle-kit studio — **migrator role 로 원격에 붙는 편집 UI** | 🔴 |
| `db:migrate:drizzle` | `drizzle-kit migrate` — **쓰지 말라고 한 도구가 남아 있음** | 🔴 제거 후보 |
| `db:inspect-public` | public 스키마 진단(읽기) | 🟢 |
| `bootstrap:admin` | 관리자 발급·`--reactivate`·`--reset-password --generate`. `--password` 거부, TTY raw 입력, `yes` 확인 | 🔴 승인 |
| `storage:cleanup` | cron 과 같은 순서 수동 실행. `revalidatePath` 를 안 부른다. `server-only` 를 조건 재실행 없이 import(실행 여부 미확인) | 🔴 |
| `seed:panels -- --dir <dir> [--dry]` | WebP 5장 → S3(`--if-none-match`) + `media` + `page_panels`(비공개) | 🔴 |
| `panels:publish [-- --on\|--off]` | 일괄 공개/내림. 무인자면 상태만. **확인 프롬프트 없음** | 🟠 |
| `seed:w5 [-- --dry]` | `vehicle_types` satellites/uavs 삽입 + W5 전제 검증 | 🟠 멱등 |
| `smoke [origin]` | 프로덕션 GET 스모크. DB 의존/비의존 갈라 진단, 본문 검사, DYNAMIC 슬러그 발견. 순차 실행(D26) | 🟢 |
| `audit:legacy` | 레거시 글 18·이미지 38 전수 감사(하드코딩 기대값) | 🟢 |
| `migrate:posts` · `migrate:archive-images` · `migrate:legacy-posts` | 레거시 이관(완료, 일회성). macOS `sips`+`cwebp` 의존 | 🔴 재실행 시 media 중복 |
| `fonts:subset` | 스텁 — exit 1 | 🟢 |
| `infra:sg-plan [--json\|--apply --yes]` | ip-ranges.json ↔ SG 대조·적용. 롤백 파일 저장 | 🔴 승인 |
| (npm 없음) `scripts/audit-images.ts` · `check-panels.ts` · `db/fix-support-panel.ts` · `hide-duplicate-post.ts` · `restore-panel-media.ts` · `seed-from-legacy.ts`(죽은 코드) · `model/*` · `fetch-rds-ca.sh` | 일회성·진단 | 혼재 |

**환경변수** — §8.1 전체표. `.env.example` 에 **없는데 코드가 읽는 것**: `AWS_ROLE_ARN` `AWS_PROFILE` `PGUSER_MIGRATE` `DATABASE_URL_MIGRATE` `PGTUNNEL_HOST/PORT` `PGSSL_SERVERNAME` `SSM_TUNNEL_TARGET` `S3_ENDPOINT` `RDS_INSTANCE_ID` `RDS_EXTRA_SG_IDS`.

**로컬.** `compose.yaml`: postgres:17(5435, 단일 사용자 `icaros` — role 분리 없음) + MinIO(9010). `DB_AUTH=password` 로 앞에 붙여 실행.

---

## 4. 잘 되어 있는 것

감사 5개 렌즈가 "살펴봤지만 문제 아님"으로 분류한 것. 다음 감사가 같은 곳을 다시 파지 않도록 남긴다.

- **미디어 서빙**: `immutable` + ETag 304(S3 호출 전) + Range 그대로 전달 + 스트리밍(버퍼 없음). 엣지 HIT 0.13~0.15s. 캐시 헤더와 메모리 캐시가 **같은 허용 목록**을 본다. 업로드 입구에서 브라우저가 이미 WebP 1600px/2MB 로 굽는다(실측 랜딩 원본 76~272KB).
- **이미지 변환 위치**: `/_next/image` 의 `x-vercel-id` 에 함수 세그먼트가 없다 — 변환은 이미 서울 엣지. 최적화기 캐시는 배포로 비지 않는다(Vercel 문서 "Redeploying your app doesn't invalidate the image cache"). `formats` webp 단일 + `imageSizes` 3개로 팬아웃 축소 완료.
- **렌더링**: `/`·`/member`·`/vehicles/[slug]`·`/posts/legacy/[slug]` 엣지 HIT, 모든 admin mutation 에 `revalidatePath` 배선. 패널 모드에서 three 청크 0바이트(12개 청크에 `WebGLRenderer` 시그니처 없음). react-markdown 은 공개 경로에서 서버 전용. `highlight.js`·`rehype-highlight` 는 import 0 → 번들에 없음.
- **CLS**: 모든 이미지에 치수 또는 `aspect-ratio` 박스. 헤더 `fixed` + `--nav-h` 예약. 리빌은 `opacity/transform` 만. reduced-motion 3겹 + `<noscript>` 해제 + 앵커 점프 회귀 처리.
- **INP**: 스크롤 핸들러 rAF 스로틀 + passive. 공개 상호작용은 메뉴 토글뿐. `next/link` 프리페치는 동적 라우트에서 325B 셸만.
- **인증·DB**: `argon2id`, Origin 허용목록 fail-closed, `__Host-` 쿠키, IAM + verify-full, fail-closed cron 인증, 비밀 미저장 감사 로그, DB 기반 rate limit. 이전 감사(2026-09-02)도 "이 계층에 개선할 것이 없다".
- **업로드 검증**: presigned PUT 에 크기를 못 박는 대신 confirm 이 HeadObject + 매직넘버 실측. SVG/HTML 이중 차단. 원본 파일명은 키에 안 들어간다.
- **정리**: `hasReferences()` 가 11개 자리를 전부 조회하고 `db:verify` 가 FK 를 대조(D28 재발 방지). soft delete 먼저, S3 는 나중(Versioning 꺼짐 전제).
- **404**: `loading.tsx`/Suspense 를 두지 않아 `notFound()` 가 진짜 404. `/rocket` 308 + 쿼리 보존.
- **보안 헤더**: HSTS preload·nosniff·X-Frame-Options DENY·Referrer-Policy, `poweredByHeader: false`.
- **점검 셔터**: 앱·DB 와 무관하게 503 + Retry-After + noindex. fail-open 설계 근거 명시.
- **문서 문화**: 지뢰 표·사후분석이 코드 주석과 문서에 남아 있다. 이 감사의 발견 상당수가 "코드가 스스로 알고 있는 것"이었다.

---

## 5. 이미지 로딩 — 원인과 보완안

### 5.1 실측 (2026-09-20, 경기도 → icn1)

| 경로 | 결과 |
|---|---|
| 엣지 HIT (원본 `/api/media`, 최적화본 `/_next/image` 모두) | **0.13~0.17s** |
| 최적화본 MISS, 원본은 엣지 HIT | 0.35~0.70s (변환은 서울) |
| **원본 MISS** (`?v=난수` 로 CDN 우회, warm 함수) | TTFB 0.53~0.57s + **271KB 스트리밍 0.8~1.0s = 총 1.3~1.6s** |
| 원본 MISS, 유휴 후 콜드 함수 | TTFB 2.4~4.2s, **총 3.5~5.3s** |
| `member` 사진 원본(`no-store`, 캐시 불가) | **매 요청** 0.73s(warm) ~ 2.0s |
| HTML `/` | HIT 0.14s (STALE 0.8s) |

같은 시각 hero 원본과 그 변형 5종이 전부 MISS 였고 다른 랜딩 사진 3장은 HIT 였다 — **저트래픽이라 엣지 캐시가 항목을 축출**하고(1년 max-age 인데도), 코드에 purge 경로는 없다. "운영자가 며칠 만에 들어오면 첫 화면 사진이 4~5초"가 정확히 이 조합이다.

### 5.2 원인 — 지리

`x-vercel-id: icn1::iad1::…`. 요청이 **서울 엣지 → 버지니아 함수 → 서울 DB(`getServableMedia` 1쿼리) → 서울 S3(GetObject) → 버지니아 → 서울 엣지 → 사용자** 로 돈다. RTT ~180ms 왕복이 최소 3회, S3 바이트가 태평양을 **두 번** 건넌다(함수가 스트리밍하는 D15 구조상 불가피). TCP/TLS 는 각 10~30ms — 나머지는 전부 서버측이다.

- DB: `rds-db:ap-northeast-2` ARN(DECISIONS.md:428), `ap-northeast-2-bundle.pem`(connection.ts:75), SSM `--region ap-northeast-2` — **서울**. 자체 호스팅 이전 후에도 `AWS_REGION` 기본값이 `ap-northeast-2` 라 서울로 추정.
- S3: `AWS_REGION` 기본 `ap-northeast-2`(config.ts:47) — 서울.
- 함수: `vercel.json` 에 `regions` 없음 → Vercel 기본 **iad1**.
- `docs/icaros-rebuild/17-nodb-fix-plan.md:445` "함수 리전 변경 금지 — RDS 가 us-east-1" 은 **오기**다. us-east-1 은 DB SG 인바운드에 넣은 *Vercel egress 대역*이지 DB 의 위치가 아니다. 문서군 전체(D17·D20·12-oidc·16-sg)와 모순되는 유일한 줄이고, 가장 큰 개선을 문서가 금지하고 있었다.

부수 원인(작음): LCP 이미지에 `fetchpriority="high"` 없음(`priority` 는 Next 15 부터 이를 함의하지 않음), `deviceSizes` 의 1920·3840 이 원본 상한 1600px 때문에 바이트 동일한 죽은 변형(실측 208,428B == 208,428B), `quality={82}` 가 `qualities` 미설정으로 75 로 조용히 강제, blur placeholder 없음(도착 전 검정 박스).

### 5.3 보완안 비교

| 안 | 비용 | 복잡도 | D3/D12/D15 | D26 | 효과(예상) | `member`(미성년자, no-store) | 판정 |
|---|---|---|---|---|---|---|---|
| **(a) 현 구조 유지 + 함수 리전 `icn1` + 코드 튜닝** | $0 | 코드 hours + SG 조율 days | **전부 준수**(구조 불변) | 개선(쿼리당 커넥션 점유 ~200ms → ~2ms) | 원본+변형 미스 1.3~1.6s → **0.2~0.3s**, 콜드 3.5~5.3s → **1.5~2s**(콜드스타트만 남음), member 0.73s → **~0.1s** | 그대로 프록시 | **추천** |
| (b) 공개 허용목록 미디어만 CloudFront + OAC, `/api/media` 는 restricted 전용 | ≈$0(프리티어) | 배포·OAC·**공유 버킷 정책 변경(ESSENTIA 조율)**·`remotePatterns` 개방·`entity_type` 변경 시 무효화 경로 신설 | D3 가 예견한 확장(DECISIONS.md:72). D15 의 `remotePatterns: []` 근거는 presigned 누출인데 CloudFront URL 은 서명 URL 이 아니라 근거 자체는 유지 — 결정문 갱신 필요 | 개선 | 최적화기 미스 0.3~0.6s. **member 는 개선 없음** | 함수 경로 유지 | (a) 뒤 Speed Insights LCP p75 > 2.5s 면 2단계 |
| (c) Vercel Blob | 저장·전송 과금 | 스토리지 이관 | **D3 이탈**(private S3 가 원본) + `forum/` 은 ESSENTIA 버킷 | 무관 | 빠름 | private Blob 은 결국 토큰 프록시 = 지금과 동일 | 제외 |
| (d) Cloudflare Images / Bunny 등 외부 이미지 CDN | $5+/월 | 외부 계정·origin 등록 | origin 이 공개 S3(D3 위반) 또는 서명 URL 을 제3자에 등록(D15 저촉) 또는 `/api/media` 를 origin 으로 두면 미스가 그대로 iad1 → **이득 없음** | 무관 | 최적화기는 이미 icn1 — 대체 이득 없음 | 못 올림 | 제외 |
| (e) 업로드 시 정적 파생본 저장 | $0 | 서버 이미지 라이브러리 미도입 → 브라우저에서 3~4벌 인코딩 + PUT/confirm 3~4배 | 준수 | 무관 | 미스 시 변환 0.2~0.5s 만 절감, 지리 비용 그대로 | 무관 | 최적화기 과금이 문제 될 때만 |

### 5.4 추천안 실행 단계

1~4 는 코드만(합쳐 2시간), 5~8 은 인프라 조율(사용자 승인 + ESSENTIA), 9 는 후속.

1. `src/components/panel/Panel.tsx:94-102` — `priority={first}` → `preload={first}` + `loading={first ? 'eager' : 'lazy'}` + `fetchPriority={first ? 'high' : undefined}`. 같은 갭이 `vehicles/[slug]/page.tsx:139`(포스터), `PostCard.tsx:91`(`next/image` 갈래)에 있다 — 함께. 워드마크 SVG(`HeaderNav`·`Loader`·`Hero`)에는 `fetchPriority="high"` 를 **주지 말 것**(LCP 와 등급을 나눠 갖는다). 검증: `curl -s https://www.icaros.kr/ | grep -oi 'fetchpriority="high"'` 2건.
2. `next.config.ts:39` `deviceSizes: [640, 828, 1200, 1600]` — 1600 추가와 1920·3840 제거는 **같은 배포**에서(`w=1600` 은 지금 400). 주석 `:31`("배포마다 비므로")·`:36`("1920 DPR2 가 3840 을 쓴다") 정정. `17-nodb-fix-plan.md:445-446` 의 "deviceSizes 도 건드리지 마라" 도 같은 커밋에서. 절감은 사진당 변형 5→4, 데스크톱 첫 방문의 최대 변형 키가 다른 방문자와 캐시를 공유하게 되는 것.
3. `quality={82}` 정리 — prop 을 지우거나(추천, LCP 바이트 우선) `images.qualities: [82]`(75 와 병존시키면 캐시 키가 두 배). 어느 쪽이든 `qualities` 를 항상 명시해 두고 "새 quality 를 쓰면 여기 등록" 주석.
4. ~~`MemberCard` `unoptimized`~~ → **7 뒤로 옮길 것.** iad1 상태에서 먼저 넣으면 `/member` 뷰마다 카드 수만큼 `/api/media` 가 CDN 흡수 없이 iad1 함수+DB 로 가서(각 0.7s) 체감이 나빠지고 D26 방향으로 부하가 는다. §6.8 SEC-1 참고.
5. `scripts/infra/rds-sg-plan.ts:82` `VERCEL_REGION = 'ap-northeast-2'` 로 바꿔 **드라이런**(기본 읽기 전용). AWS ip-ranges `ap-northeast-2` EC2 프리픽스는 **47개**(us-east-1 은 296개, 현 SG 는 234블록 중 59개만 수용 → 2.2% 미커버가 D27 간헐 타임아웃의 원인). 47 ≤ 59 라 **전부 들어가고 D27 의 "목록 밖 인스턴스 조용한 타임아웃" 자체가 사라진다.** ⚠ 2026-09-06 DB 호스트가 바뀌었으므로(§6.2-B) 스크립트의 대상(`RDS_INSTANCE_ID` 전제)이 새 호스트의 SG 인지 먼저 확인.
6. **사용자 승인 + ESSENTIA 조율**: SG 가 만석(60/60)이면 새 SG 를 **추가 부착**(SG/ENI 쿼터 5)해 ap-northeast-2 대역을 넣고, 검증 뒤 기존 us-east-1 SG 제거. `modify-db-instance --vpc-security-group-ids` 는 목록을 **통째로 대체**한다 — 기존 ESSENTIA SG 를 함께 나열하지 않으면 그 순간 상대 API 가 끊긴다(2026-08-30 40분 장애의 재발 경로). 적용 직후 상대 헬스체크. `icn1` egress 가 ap-northeast-2 EC2 라는 것은 Vercel 리전표 기반 **추정** — 전환 직후 함수 로그의 egress IP 로 검증(`16-sg-rule-budget.md` 가 iad1 에 했던 방식).
7. `vercel.json` 에 `"regions": ["icn1"]` → 프로덕션 배포(승인). IAM·OIDC 는 리전 무관, `AWS_REGION` 그대로. Hobby 플랜이면 리전은 정확히 하나만 지정 가능(플랜 미확인).
8. `npm run smoke` + `curl -sI https://www.icaros.kr/…` 로 `x-vercel-id: icn1::icn1::…` 확인, member TTFB·`?v=` 우회 hero 총시간 재측정(apex 는 307 이라 www 를 직접 치거나 `-L`). 문서 정정: `17-nodb-fix-plan.md:445`·`:366`("엣지 HIT 만 잰 값"), `15-infra-debt.md` C4/D27, DECISIONS 에 **D29** 로 기록. 그 뒤 4번(`MemberCard`).
9. (후속) blur placeholder — `media.blur_data_url text` 컬럼 + `encode.ts` 에서 16px WebP base64(≤1KB) + `/confirm` zod(`^data:image/webp;base64,`, ≤1024) + `panels.ts` select + `Panel.tsx` `placeholder={blur ? 'blur' : 'empty'}` + `style={{ objectPosition }}`(블러 배경은 style 만 읽는다). 마이그레이션은 **지금 가능**하다(`db:tunnel`, C4 는 08-28 해결 — CLAUDE.md 서술이 낡음). 기존 5장은 `/admin` 재업로드가 백필보다 싸다. 얻는 것은 "빈 검정 → 흐린 사진"의 연속성이지 팝인 제거는 아니다.

---

## 6. 문제점 · 보완점 전체

심각도는 **반박 검증 후** 값. 검증자가 낮춘 항목은 `high→medium` 처럼 적었다. 노력: h=시간, d=일. 원 발견 ID 는 괄호.

### 6.1 우선순위표

| 우선 | 항목 | 심각도 | 노력 | 절 |
|---|---|---|---|---|
| **P0** | `/posts/[id]` 프로덕션 500 | high | 1h | 6.2-A |
| **P0** | 미커밋 DB 접속 변경 + CLI 배포 상태 — 다음 push 가 회귀 | high | 2h + 확인 | 6.2-B |
| **P0** | 함수 리전 iad1 → icn1 | high | 2h 코드 + d 조율 | §5 |
| **P1** | apex → www 307 (canonical 모순, 웹훅 엔드포인트 결합) | medium | 1h + 대시보드 | 6.2-D |
| **P1** | 배포 후 스모크 자동화 + lint 게이트 | medium | 3h | 6.2-E |
| **P1** | `/vehicles` TTFB 0.85~0.9s (force-dynamic + 순차 3쿼리) | medium | 3h | 6.4 |
| **P1** | 리빌 애니메이션이 첫 화면을 하이드레이션까지 숨김(LCP=JS) | medium | 2h | 6.4 |
| **P1** | `openGraph` 지뢰 `/vehicles` 밟음, 하위 페이지 og:url=홈, `/posts` canonical 없음 | medium | 2h | 6.5 |
| **P1** | 헤더 'About Us' `/#about` 죽은 앵커 | medium | 1h | 6.5 |
| **P1** | 패널 alt = 파일명(UUID) | medium | 10분(임시) / 반나절(컬럼) | 6.5 |
| **P1** | mono `--fg-faint` 3.39:1 이 12px 텍스트에, 푸터 3.01:1 하드코딩 | medium | 1h | 6.5 |
| **P1** | 패널 CTA 한국어가 모노·자간 0.22em | medium | 30분 | 6.5 |
| **P1** | Panels 액션 5개가 throw (DENIED 대신 공개용 에러 화면) | medium | 1h | 6.6 |
| **P1** | 패널 배경 고르기가 `entity_type`·`deleted_at` 안 거름(멤버 사진·지워진 사진 노출) | medium | 2h | 6.6 |
| **P1** | 비공개 패널 미리보기 없음, 어드민→공개 링크 0 | medium | 1h(최소) / d(draftMode) | 6.6 |
| **P1** | 비밀번호 변경·계정 활성화 UI 없음 | medium | d | 6.6 |
| **P1** | Landing 카피 집계 토큰 하나 → 충돌 시 32칸 입력 소실 | medium | d | 6.6 |
| **P1** | 저장 실패 로그가 고정 문자열, panels 는 로그 0 | medium | 2h | 6.7 |
| **P1** | AGENTS.md/CLAUDE.md 가 08-30 에서 멈춤, C4·D28 자기모순 | medium | 3h | 6.7 |
| **P1** | 마이그레이션 노트북 수동 + 미커밋 러너, 주체 기록 없음 | medium | h~d | 6.7 |
| **P1** | member 사진 `no-store` 가 `/_next/image` 층에서 `public` 캐시 | medium | 1h (7 뒤) | 6.8 |
| P2 | 나머지 32건(low) | low | — | 6.4~6.8 |

### 6.2 지금 당장

#### A. `/posts/[id]` 가 500 이다 (PERF-1 · REL-1, high)
- **증상**: `/posts` 에 있는 유일한 Community 글(`/posts/1699f250-…`)이 5회 연속 500, 가짜 UUID 도 404 가 아니라 500. `x-matched-path: /500`, `/500` 정적 자산 `age` ≈ 6.9일 → **최소 7일간 서비스됨**. 앞으로 ESSENTIA 에 올라오는 모든 글이 같은 결과.
- **원인(코드로 확정)**: 커밋 3d862a6(09-06)이 `force-dynamic` → `revalidate = 300` + `generateStaticParams(): []` 로 바꿨는데 `community/client.ts:99` 의 `cache: 'no-store'` 는 그대로. Next 16.3.2 는 ISR 렌더 중 `no-store` fetch 를 만나면 `markCurrentScopeAsDynamic` → `revalidate = 0` → 렌더 후 `app-page-runtime.js:634` 에서 `Page changed from static to dynamic at runtime`(E132) throw. React 트리 밖이라 `error.tsx` 가 못 잡는다 → Next 기본 500. 형제 라우트 `/posts/legacy/[slug]` 는 fetch 가 아니라 pg 라 멀쩡. `next dev` 에서는 `!isDev` 조건 때문에 재현 안 됨 — 이 커밋이 빠져나간 이유.
- **수정(택1)**: ① 최소 — `page.tsx:18-27` 의 `revalidate`·`generateStaticParams` 삭제 + `export const dynamic = 'force-dynamic'` 복원(D23 원문). ② 캐시 유지 — `call()` 에 캐시 옵션 인자를 추가하고 `getIcarosPost` 만 `next: { revalidate: 300 }`(목록·미리보기는 `no-store` 유지, `/posts` 가 force-dynamic 이라 무해). `catch {}` 에 `unstable_rethrow` 를 넣는 것은 **해법이 아니다**(throw 전에 `revalidate=0` 이 세팅됨). `page.tsx:12` 주석 "목록의 60초" 는 거짓 — 함께 정정.
- **검증**: `next build && next start` 또는 배포 후 `npm run smoke`(DYNAMIC 항목이 정확히 이 경로 200 을 요구).

#### B. 프로덕션이 미커밋 워킹트리에서 배포됐고, 다음 push 가 회귀시킨다 (OPS-1 ×2, high)
- **사실**: `origin/main = beb69ae`, 로컬 `main = 91cbf0d`(미푸시). 그런데 프로덕션 응답에 91cbf0d 의 `x-icaros-shutter` 헤더가 있다 → 운영 빌드는 **로컬 CLI 배포**. 미커밋 4파일(`connection.ts`·`db-config.ts`·`tunnel.ts`·`migrate.ts`, mtime 09-06 22:52~59, 커밋보다 앞)이 함께 올라갔을 가능성이 높다. 보강: `RDS_CA_BUNDLE_PATH` 의 인증서는 `O=ESSENTIA` 자기서명 사설 CA — 커밋본 HEAD 는 password 모드에 `ssl.ca` 를 넣을 코드가 없으므로 검증 TLS 가 불가능한데 `/vehicles` 는 DB 내용(0007 결과)을 정상으로 낸다.
- **위험**: 다음 `git push origin main` 이 git 연동 빌드를 타는 순간 커밋본 password 분기로 회귀 — CA 없음 → URL 에 `sslmode=require` 면 시스템 CA 가 사설 CA 를 거부해 DB 라우트 전부 500, 아니면 평문 + `max:5/idle 30s/무한대기`(D26 지뢰 값 그대로). 반대로 미커밋 diff 를 그대로 푸시했는데 Vercel env 에 `RDS_CA_BUNDLE`·`PGSSL_SERVERNAME` 이 없으면 fail-closed 가드가 풀 생성 시 throw 해 역시 DB 라우트 전부 500.
- **순서**: ① Vercel 배포 상세의 **Source(CLI vs git commit)** 와 Production env(`DB_AUTH`, `RDS_CA_BUNDLE`(서버리스라 파일 경로가 아니라 인라인 PEM), `PGSSL_SERVERNAME`)를 먼저 읽는다 — "어느 쪽이 정답인가"를 먼저 정하는 지뢰 그대로. ② 필요하면 CA·servername 을 env 에 먼저 추가. ③ 4파일 diff 를 리뷰해 커밋(91cbf0d 를 **단독으로 푸시하지 말 것**). 커밋 전 주석 두 곳 수정: `connection.ts:170-176` "`sslmode=verify-full` 로는 사설 CA 를 못 넣는다"는 부정확(`sslrootcert=` 는 파일을 읽는다 — 코드로 넣는 이유는 "servername 과 접속 주소를 가르기 위해"), `:51-52` "지우면 로컬이 조용히 public 을 본다"는 틀림(Drizzle 이 전 테이블을 `icaros.` 한정). ④ 푸시 → `npm run smoke`. ⑤ 풀 생성 시 `[db] mode=password tls=verify-full pool={…}` 한 줄 로그(호스트명 제외)로 "어느 코드가 살아 있는가"를 Vercel 로그에서 1분 안에 보게.
- **기록**: DECISIONS 에 **D29 — 자체 호스팅 이관(2026-09-06)** 항목(D17/D20 을 역사로 표시), 서버측 의존 `ALTER ROLE icaros_app SET search_path TO icaros`(PgBouncer 가 `options` 를 버림 — DB 를 다시 세울 때 빠지면 경고 없이 깨짐), 비밀번호 회전 런북(PgBouncer `auth_file` 과 서버 role 이 **둘 다** 있어 "한쪽만 바꿈" 사고가 두 겹 — 08-30 장애 원인 그대로). `15-infra-debt.md` A5(PgBouncer 보류)·B1·C4 갱신, `.env.example` 에 password 운영 블록(`DATABASE_URL_MIGRATE`·`PGSSL_SERVERNAME`·`PGTUNNEL_*`·`SSM_TUNNEL_TARGET`, "Neon" 잔재 제거). 공개 레포이므로 새 DB 호스트 별칭·EC2 이름은 옮겨 적지 말 것. 지금은 D28 도 DECISIONS 에 없다 — 같이 채운다.

#### C. 함수 리전 (IMG-1, high) → §5

#### D. apex `icaros.kr` → www 307 이 2주째 (IMG-8 · PERF-4 · SEO-1 · OPS-2 ×2, medium)
- 코드(fa4d761, 09-06)는 apex 를 정식으로 정하고 "대시보드를 바꾼다"고 다음 사람에게 넘겼다. 실측 `curl -sI https://icaros.kr/` → 307 `www`, `server: Vercel`(앱에 닿기 전). 모든 페이지의 canonical·og:url·og:image 가 리다이렉트되는 주소. `/rocket` 옛 링크는 307+308 두 번. apex 307 응답의 HSTS 는 `max-age` 만 — 앱의 `preload` 는 apex 에서 성립하지 않는다.
- **수정**: Vercel Domains 에서 `icaros.kr` primary, `www` → **308** redirect(307 이 지금 색인이 안 정리된 이유). **결합 변경 둘**: ① `deployment.succeeded` 웹훅이 `www.icaros.kr/api/revalidate` 로 등록돼 있다(`docs/.local/identifiers.md:39`) — 플립 후 www 가 리다이렉트가 되면 Vercel 웹훅이 POST 3xx 를 따르는지 **미확인** → 같은 작업에서 apex 로 옮기고 다음 배포 후 `npm run smoke` 본문 검사. ② Production env `ADMIN_ALLOWED_ORIGINS` 가 www 만이면 `guard.ts:87` 이 그 목록만 쓰므로 apex 에서 admin mutation 이 전부 403 — 확인 후 양쪽 유지. 세션 쿠키 `__Host-` 라 관리자 재로그인 1회(안내만). `preload` 는 `sim.icaros.kr` 이 HTTPS 인지 확인 전까지 빼거나, 확인 뒤 hstspreload.org 에 실제 제출.
- **재발 방지**: `scripts/smoke.ts` 의 `db: false` 정적 자산 검사(`/favicon.png`)에 `redirect: 'manual'` 을 적용해 3xx 면 실패 + `location` 출력(`/` 에 걸면 DB 장애와 섞여 진단 축이 깨진다). `audit-legacy-posts.ts:24`·`audit-images.ts:23` 기본 BASE 도 apex 로.

#### E. 스모크가 수동이라 A 가 7일간 아무도 몰랐다 (PERF-11 · OPS-3, medium)
- `scripts/smoke.ts:107` 이 정확히 A 를 잡는 검사를 갖고 있다(직접 돌려 12건 중 1건 ✗ 확인). `.github/` 없음. `15-infra-debt.md:120` 은 08-30 장애에서 "그 시간에 돌린 사람이 없었다"고 이미 적었다 — 같은 구멍 두 번째.
- **수정**: `.github/workflows/smoke.yml` — `on: deployment_status`(Vercel GitHub 앱, `state == 'success' && environment == 'Production'`, 대문자) + `schedule:`(6시간 — 08-30 형 배포 없는 장애는 deployment 트리거로 못 잡는다; 이건 `15-infra-debt.md:316` "새 모니터링 도입 안 함" 과 맞닿는 별도 결정이라 분리 제안). `npm ci` 불필요(`smoke.ts` 는 import 0 — `setup-node 22.18+` 후 `node scripts/smoke.ts`). 배포 직후 `/`·`/member` 빈 프리렌더가 60초 남을 수 있어 실패 시 60초 뒤 1회 재시도. **알림은 공짜가 아니다**: `deployment_status` 의 actor 는 `vercel[bot]` 이라 실패 메일이 사람에게 안 간다 → `if: failure()` 에서 `gh issue create`(같은 제목 열린 이슈면 코멘트). 이것이 A3(알림 채널 없음)의 첫 채널이 된다.
- **lint 게이트**: 직접 푸시 팀에서 `on: push` Actions 는 Vercel 배포와 **병렬**이라 막지 못한다(머지 1/100). 진짜 게이트는 `vercel.json` `"buildCommand": "npm run lint && next build"`(`outputDirectory` 는 건드리지 말 것). typecheck 는 이미 Vercel 빌드가 게이트한다. lint 는 `react-hooks` 규칙(rules-of-hooks·exhaustive-deps)을 포함해 런타임 버그도 잡는다. CI 에서 `npm run typecheck` 를 돌리면 fresh checkout 에서 **실패**한다(`next-env.d.ts` 가 gitignore) — `npx next typegen` 을 앞에 두거나 빼라.

### 6.3 이미지 (→ §5). 나머지 이미지 항목: IMG-2(§6.8 SEC-1), IMG-3·4·5·6·7(§5.4 단계 1·2·3·9).

### 6.4 성능 (이미지 이외)

- **`/vehicles` TTFB 웜 0.85~0.91s / 콜드 2.1s** (PERF-2, medium, 3h). `force-dynamic`(`searchParams`) + `types → series → rockets` 순차 3쿼리 + Header/Footer `site_settings`. Suspense 없음(의도)이라 그동안 HTML 0바이트. **수정**: `listVehicleTaxonomy`·`listRocketsBySeries` 를 `unstable_cache(fn, [key], { revalidate: 300 })` 로 감싼다(React `cache()` 는 바깥 유지). force-dynamic 페이지 안에서도 `unstable_cache` 는 동작한다(`unstable-cache.js:160` 은 `forceDynamic` 을 안 본다). 이미 배선된 `revalidatePath('/vehicles')`·`('/vehicles/[slug]','page')` 가 implicit tag 로 캐시 엔트리를 비우므로 **즉시 반영 유지**. `Promise.all` 은 빼라(`_data.ts:160` 이 D26 이유로 금지) — 정말 줄이려면 `vehicle_types LEFT JOIN rocket_series` 한 쿼리. `getSiteContent`(던지는 쪽)도 같은 방식으로 감싸되 **`Safe`(삼키는 쪽)를 감싸면 안 된다** — DB 장애 순간의 `{}` 가 300초 캐시에 박혀 전 라우트 title·내비·푸터가 빈다. `revalidateTag(tag)` 단일 인자는 16.3.2 에서 typecheck 를 깬다(두 번째 인자 필수) — 서버 액션은 `updateTag`, 태그 추가는 belt-and-braces. `'use cache'` 는 `experimental.useCache` 로 켤 수 있으나 loading/Suspense 정책과 충돌해 안 씀. 기대 웜 0.85 → 0.35~0.45s(`/admin` 미인증 0.33s 수준). 완료 판정: `/admin` 에서 기체 하나 비공개 저장 직후 `/vehicles` 에서 사라지는지까지.
- **리빌이 첫 화면을 하이드레이션 전까지 숨긴다** (PERF-3, medium, 2h). `globals.css:132` `[data-reveal-item]{opacity:0}` 무조건 → `/member` 카드 29장·`/vehicles` 카드가 JS 203KB br(13청크) → 하이드레이션 → IO 콜백까지 안 보임. Chrome 은 `opacity:0` 을 LCP 후보에서 빼므로 **LCP ≈ 하이드레이션 시각**. `/` 첫 패널은 SSR 에서 보이다 마운트 후 `pending` → 900ms 페이드 — 하이드레이션이 Loader 백스톱(~800ms)보다 늦을 때만 깜빡임이 보인다. **수정**: `InView` 에 `immediate` prop(SSR 에서 `data-shown` 선찍기) → `/member` 첫 부서, `/vehicles` 격자, `[slug]` Overview 에 적용(애니메이션을 남기려면 시간 기반 CSS 키프레임 — JS 없이 첫 페인트부터). `panel/Reveal` 에 `skip` → 첫 패널은 감싸지 않음. `RocketCard` 첫 행 `priority`. `animation-timeline: view()` 는 **드롭인이 아니다**(스크롤 스크럽형 — 되감기 없음 원칙·Firefox 미지원과 충돌) — 폐기.
- **Pretendard** (PERF-5, low, 1h). preload 없음(요청 시작이 CSS 파싱 뒤) + `/fonts/*` `max-age=0`(재방문마다 파일당 ~55ms 304). **수정**: `layout.tsx` 에서 `react-dom` `preload('/fonts/pretendard-400-base.woff2', { as:'font', type:'font/woff2', crossOrigin:'anonymous' })`(첫 화면 한국어는 `.body` 400 뿐; 헤드라인이 한글이 되면 500-base), `next.config.ts headers()` 에 `/fonts/:path*` immutable — **전제조건**: `fonts:subset` 이 해시 파일명 + 매니페스트를 내야 한다(같은 이름으로 재생성하면 재방문자가 옛 base 를 1년 쓰고 새 글자만 시스템 폰트로 떨어진다 — `fonts.css:12` 가 막으려던 실패). Fallback 메트릭 오버라이드는 **보류** — fontTools 실측 Pretendard 0.864em vs Apple SD Gothic Neo 0.865em 동일, line-height 전부 명시라 Apple 에서 CLS 기전이 성립하지 않고, `next/font/local` 이 만드는 `src: local(Arial)` 폴백은 한글 글리프가 없어 적용조차 안 된다. Windows/Android 는 미측정. CLAUDE.md:126 "next/font preload no-op" 은 실측과 다르다 — 갱신.
- **TanStack Query 소비자 0** (PERF-6, low, 30분). `useQuery` 등 사용처 0, 모든 페이지에 8.3KB br. 도입 커밋 82f7a50 스스로 "당장은 순수 비용". **수정**: `QueryProvider`·`lib/query/` 삭제, `layout.tsx:71` `{children}`, `npm uninstall @tanstack/react-query highlight.js rehype-highlight drizzle-zod`(전부 import 0). `Hero` 를 동적 import 로 가르는 것은 **동작하지 않는다**(스크래치 앱 실측: App Router 가 비동기 엣지까지 클라이언트 참조를 라우트 엔트리에 넣는다) — 폐기.
- **`/posts` 매 요청 레거시 DB + 상류 상세 ≤12건** (PERF-10, low, 1h). 목록 `no-store` 는 D23 유지. `allLegacy` 를 `unstable_cache(…, { revalidate: 3600 })`(쓰기 경로 없는 고정 아카이브), `loadPreview(id)` 를 `unstable_cache(…, { revalidate: 600 })` 로 바꾸고 인스턴스 `Map` 캐시 제거(Fluid Compute 에서 적중률 낮음). 기대 웜 0.55 → 0.35~0.4s.
- **Loader 가 `window.load` 까지 가림** (PERF-15, low). 800ms/62% 백스톱을 500ms/40% 로, 신호를 첫 패널 `decode()`/`DOMContentLoaded + fonts.ready` 로. 실기기에서 커버 해제 시각과 LCP 를 같이 찍은 뒤 값 결정.
- **헤더 `backdrop-filter` 전환** (PERF-14, low, 추정). `transition` 목록에서 `backdrop-filter` 를 빼거나 블러를 `(hover: hover) and (pointer: fine)` 안으로. CPU 4x 스로틀 프로파일로 확인 후.
- **16.9MB `icx-2.fbx` 공개 서빙** (PERF-9 · DX-2, low). 런타임 참조 0. `git rm --cached public/assets/icx-2.fbx && mv … asset/models/`(`git mv` 를 gitignore 폴더로 쓰면 **계속 추적된다**), `scripts/model/{fbx-to-glb,inspect-fbx}.ts` 기본 경로 4곳 변경 + 없을 때 "팀 드라이브/S3 raw" 안내로 실패. filter-repo 는 하지 말 것(공개 레포 `main` 재작성). `src/assets/fonts/woff2/*` 는 **옮기지 말 것**(13-fonts.md 가 재생성 소스로 명시, 배포에 안 실림). `src/assets/down.png`(참조 0)만 삭제. 부수 관찰: D3 는 GLB 를 `/api/media` 프록시로 두기로 했는데 히어로 GLB 는 `public/` 직접 서빙 — 별도 기록.
- **문서 3곳 실측 불일치** (PERF-13, low) → §8.2.

### 6.5 SEO · UX · 접근성 · 콘텐츠

- **`openGraph` 지뢰 실제 발생** (SEO-3, medium, 2h). `/vehicles` 가 `openGraph: { title, url }` 만 줘서 og:image·site_name·type 없음, twitter:card `summary` (카톡·인스타 DM 썸네일 없음). `/member`·`/posts`·레거시 글은 openGraph 자체가 없어 og:url·og:title 이 **홈 값**, `/posts` 는 canonical 없음, 레거시 글 description 은 사이트 기본 문구. **수정**: `src/lib/seo.ts`(server-only) `ogFor()` 헬퍼 — 기본 og:image 는 `/og.png` 하드코딩이 아니라 `getSeo(...).ogImage`(CMS `og.image_media_id`, F10). 적용 6곳: `vehicles/page.tsx:94`, `member/page.tsx:32`, `posts/page.tsx:29`(+ canonical), `posts/legacy/[slug]:62`(description 은 `cardExcerpt(contentMd, 160)`, 빈 문자열이면 `undefined` 로 상속), `vehicles/[slug]:71-77`(siteName + images 폴백), `posts/[id]:31-39`. 홈 `page.tsx:120` 의 `/og.png` 하드코딩도 헬퍼로. `smoke.ts` 에 `property="og:image"` contains 검사(치환 지뢰 전용이라는 주석과 함께).
- **'About Us' 죽은 앵커** (UX-1, medium, 1h). `NAV_ITEMS[0] = /#about` 인데 패널 모드에서 `about` 섹션이 빠져 `id="about"` 0건. Next 16 은 hash 대상이 없으면 스크롤을 전혀 하지 않는다 — 하위 페이지에서 누르면 홈이 그 오프셋 그대로 열린다. **수정**: `{ href: '/#donate', key: 'nav.support', fallback: 'Support' }` — `admin/_data/landing.ts:48` 의 폼 필드 키도 함께(안 바꾸면 "라벨은 CMS" 전제 붕괴). 앵커는 반드시 `#donate`(`#support` 는 어디에도 없다 — 어드민 CTA 드롭다운의 `#support` 도 죽은 앵커, 이건 DB CHECK 마이그레이션이라 별건). `donate` 는 `REPLACED_BY_PANELS` 밖이라 양 모드에서 유효하나 `page_sections.donate` 를 끄면 같은 종류가 된다 — 주석으로 전제 명시. `02-requirements-matrix.md:14` A2 행·`Header.tsx:5` 주석 갱신.
- **패널 alt = 파일명** (A11Y-1 · ADM-10, medium). 스크린리더가 첫 화면부터 UUID 를 글자 단위로 읽는다(WCAG 1.1.1). **즉시(10분)**: `panels.ts:71` select 줄 삭제 + `:88` `alt: DEFAULT_ALT`('') — 임시라는 점을 주석에. **제대로(반나절)**: `page_panels.alt text`(nullable) 마이그레이션 + `components/admin/PanelForm.tsx`(경로 주의 — `_panels/` 아님)에 '사진 설명(비우면 장식)' 필드 + `_actions/panels.ts`·`_data/panels.ts` 배선. 기존 5행은 마이그레이션 직후 장식으로 떨어지고 팀이 `/admin` 에서 채운다.
- **mono 팔레트 대비** (A11Y-3, medium, 1h). mono `--fg-faint` = white 38% = **3.39:1** 이 12px 텍스트에: `TabNav .tab`(시리즈 탭 — 유일한 분류 내비), `Contact .label`, `Donate .goal`(발견이 빠뜨린 곳, 같은 파일 `.round` 주석은 이미 같은 이유로 `--fg-muted`), 레거시 글 `.meta/.back`. primary 탭(16px)도 4.5:1 대상. 푸터 `.copy` 는 토큰이 아닌 하드코딩 `rgb(255 255 255 / 0.34)` 10.5px = **3.01:1**(규약 위반 겸). **수정**: 사용처별 `--fg-muted`(mono 7.85:1)로 교체(토큰 자체를 0.52 로 올리면 장식 마크까지 밝아진다). 푸터는 `data-theme="dark"` 라 `--fg-faint`(5.00:1)도 통과 — "조용한 푸터" 의도면 그쪽, 크기는 `--fs-mono-s`. `/posts` 목록·ESSENTIA 상세는 ink(4.75:1)라 **통과** — 발견 범위에서 제외. `Header .link` 0.72 white 는 10.5:1 로 문제 없음.
- **패널 CTA 한국어가 모노·0.22em·uppercase** (UX-2, medium, 30분). `.cta` 에 `:lang(ko)` 재설정이 없고 `Panel.tsx:128` 이 `lang="ko"` 고정. computed: IBM Plex Mono 폴백, 11px, letterSpacing 2.42px → `기 록  전 체  보 기`. **수정**: `Donate.module.css:186` 패턴 그대로 `.cta:lang(ko){ font-family: var(--ff-body); font-size: var(--fs-body-s); font-weight: var(--fw-medium); letter-spacing: 0; text-transform: none }` + `.headline:lang(ko){ letter-spacing:0; text-transform:none }`(잠재) + `lang={textLang(panel.ctaLabel)}`/`textLang(panel.headline)`(영문 라벨이면 모노 유지). 11→14px 로 버튼 높이 ~3px 변동 — ko/en 라벨 혼재 시 `min-height`. `Header .link` 도 같은 구조라 예방 차원에서 `lang` + `.link:lang(ko)`.
- **헤더에 `<nav>` 랜드마크·`aria-current`·`lang` 없음** (A11Y-2, low, 30분). `<div id="nav-menu">` → `<nav aria-label="주 메뉴">`(ref 타입 `HTMLElement`, `aria-controls` 유지), `aria-current`는 hash 없는 href 만(`/#…` 은 제외 — 아니면 홈에서 브랜드와 About 두 곳), `lang={textLang(item.label)}`.
- **404 (unmatched URL 한정)** (UX-3, low). 헤더·푸터·스킵링크 없음 + 80vh 상자 아래 밝은 띠. `notFound()` 라우트는 `(public)` 레이아웃 안에서 렌더돼 문제 없음. **제안된 fix 를 그대로 하면 회귀** — 루트 `not-found.tsx` 에 Header/Footer 를 넣으면 `(public)` 세그먼트가 같은 파일을 쓰므로 상세 404 에서 헤더 2겹·`id="main"` 중복. 권장: `(public)/not-found.tsx` 신설(본문만, 빌드 후 로더 트리에서 우선 확인) + 루트는 unmatched 전용으로 셸 조립 + `min-height: 100dvh`. 캐치올 `[...rest]` 는 비권장(봇 404 마다 DB 렌더 — D26 역행). `loading.tsx` 금지 유지.
- **robots.txt·sitemap.xml 없음** (SEO-2, low, 1h). 30~40 URL 규모라 크롤 예산은 변수가 아니고 부재 = 전부 허용이라 손실 없음. 다만 apex 플립 뒤 sitemap 이 canonical 을 두 신호로 겹쳐 준다. `robots.ts` 정적(`Disallow: /api/upload, /api/cron, /api/revalidate` — `/api/media`·`/_next/image` 는 절대 막지 말 것, og:image 가 그것), `sitemap.ts` 는 `force-dynamic`(빌드가 DB 를 치지 않게, D27) + 집합별 fail-soft, `listIcarosPosts` 는 throw 안 하고 `CommunityResult` 반환이니 `ok` 분기. 호스트는 `metadataBase` 하나에서 파생(세 번째 하드코딩 금지). **호스트 불일치(D)를 먼저** — 지금 내면 sitemap 의 모든 URL 이 리다이렉트.
- **`/vehicles?type=uavs` title 'UAVs · UAVs'** (SEO-4, low). 시리즈 1개이고 이름이 분류와 같으면 분류 라벨만. `[slug]` eyebrow 도.
- **JSON-LD 0** (SEO-5, low). 루트에 `Organization`+`WebSite`(CMS 값, `sameAs` 인스타), 기체 상세 `BreadcrumbList`, 글 `Article`. `JSON.stringify().replace(/</g,'\\u003c')`.
- **아이콘·매니페스트·세로형 og:image** (SEO-6, low). `/favicon.ico`·`/apple-touch-icon.png`·manifest 404 → `src/app/icon.png`(512²)·`apple-icon.png`(180²)·`manifest.ts` + `viewport.themeColor`. 기체 og:image 가 720×1600 세로 → `height > width` 면 `/og.png` 폴백(간단) 또는 `opengraph-image.tsx` 로 1200×630 합성(권장).
- **`/posts` 페이지 번호 0-기반, 범위 밖 200** (UX-4, low). `?page=1` 이 화면 '2'. 1-기반으로 + `totalPages` 로 범위 밖은 redirect 또는 '이전' 유지.
- **내비 'Rockets' → Vehicles, `/posts` h1 만 한국어, `/posts` 만 mono 아님** (CONTENT-1, low). ① `/admin` Landing 에서 `nav.rocket` 값 변경(코드 무관). ② `posts/page.tsx:87` `<h1 lang="en">Posts</h1>` 로 통일. ③ `data-palette="mono"` 추가는 A11Y-3 와 함께(ink 4.75 → mono 3.39).
- **위성·UAV '최대 고도 0m·페이로드 0kg', 후원 금액 단위 없음** (CONTENT-2, low). `vehicles/_data.ts` DTO 에서 `'0'`·`'0.0'` → null 정규화(뷰 두 곳 동시 해결) 또는 RocketForm '모르면 비워 두세요' + 0 검증. `Donate` 에 실제 텍스트 `<span>원</span>`(CSS content 금지 — 복사·리더 모드에서 사라짐).
- **홈 description 이 문장 중간 '…', 패널 카피 voice** (CONTENT-3, low). `page.tsx:109` `c['seo.description'] ?? toDescription(about.body)`(자를 땐 `. ` 경계). 카피는 `/admin` 에서: 'We learn from COSMOS / not only textbook' 문법, 패널 2 본문이 RAON 사출 오작동·정점 미달을 생략(voice "실패도 실패로") — 팀이 정하되 Posts 톤에 맞출 것.
- **어드민 eyebrow 필드가 공개에 안 나감, CTA `#support` 착지점 없음** (ADMIN-1, low). eyebrow 필드·zod 항목 제거(되살릴 거면 `Panel.tsx` 에 렌더). `PANEL_CTA_HREFS` 에 `'#donate'` 먼저 추가 → `UPDATE … SET cta_href='#donate' WHERE cta_href='#support'` → `'#support'` 제거의 2단계(스키마 주석 절차). 드롭다운 라벨을 '후원 섹션'·'연락처 섹션' 으로.

### 6.6 관리 콘솔

- **Panels 액션 5개가 `if (!(await requireAdmin())) return DENIED`** (ADM-1, medium, 1h). `requireAdmin()` 은 실패 시 throw 하므로 이 `if` 는 도달 불가 — 세션 유휴 8h 만료 뒤 저장·토글·이동·삭제를 누르면 예외가 루트 `error.tsx`(공개용 검정 화면 "문제가 발생했습니다")로 떨어지고 폼 입력도 사라진다. 다른 6개 액션 파일은 전부 `try { await requireAdmin() } catch { return DENIED }`. `togglePanelPublished`·`deletePanel` 은 DB 호출도 try/catch 밖(53300 같은 DB 오류도 같은 화면). **수정**: 5곳 통일 + toggle/delete try/catch(`redirect()` 는 try 밖) + `src/app/admin/error.tsx`(loading 아니라 404 지뢰 무관; "다시 로그인"은 `reset()` 이 아니라 `<a href="/admin">` 풀 내비 — `page.tsx:35` 가 `null` 을 돌려주므로). 재발 방지는 `tryRequireAdmin()` 헬퍼를 `_lib/` 또는 `guard.ts` 에(`_actions/` 에 두면 Server Action 엔드포인트가 된다). type-aware lint 는 비용이 커서 헬퍼가 더 싸다.
- **패널 배경 고르기 목록이 `entity_type`·`deleted_at` 을 안 거른다** (ADM-4, medium, 2h). `listPanelMediaChoices()` where 는 `status='ready'` 하나 — 멤버 프로필(미성년자, `private, no-store` 로 서빙되는 이유)·기체 갤러리·포스터가 전부 후보로 뜨고, 24h 뒤 `reclaimUnattachedUploads` 가 지운 행(`deleted_at` 만 찍히고 `status` 는 `ready`)이 깨진 썸네일로 남아 고르면 저장은 되는데 `getLandingPanels()` 가 걸러 **랜딩에서 조용히 사라진다**. 관리 목록 `listPanels()` 는 `deletedAt` 을 안 봐서 운영자 화면엔 정상. 패널만 `checkMediaAttachable()` 을 안 부른다. **수정**: where `and(ready, isNull(deletedAt), eq(entityType,'landing'))` — **목록만 좁히면 화장**, `createPanel`/`updatePanel` 에 서버 검증(패널용 변형: `ready + deleted_at IS NULL + entity_type='landing'`, `entity_id` 소유권 검사는 빼야 한다 — 패널은 사진 공유가 정상). `.limit(60)` 은 편집 중 패널의 사진이 밖이면 미리보기가 통째로 사라지니 두지 말 것. `listPanels()` 에 `deletedAt` select → "사진 삭제됨" 배지. cleanup 의 `status` 는 건드리지 말 것(주석이 이유를 적어 둠). 배포 전 `entity_type IS NULL` 초기 행 수 확인.
- **미리보기 없음, 공개 페이지 링크 0** (ADM-2, medium). 패널 크롭 미리보기는 사진만(스크림·앵커·헤드라인 없음), `getLandingPanels()` 는 `published=true` 만 → 공개해서 확인하는 것이 유일한 수단(코드가 "가장 되돌리기 어려운 사고"라 적은 것). 저장 배너 "공개 페이지에 반영되었습니다"는 비공개 행에도 뜨고 링크 없음. **최소(1h)**: 배너에 `/vehicles/<id>`(published 일 때만)·`/member` 새 탭 링크, Panels 헤더에 `/` 링크. **제대로(d)**: `draftMode()` — `/api/preview`(GET, `getAdminSession()` 필수, `ALWAYS_OPEN` 에 넣지 말 것) → `enable()` → `/`. 판정은 `panels.ts` 안이 아니라 `page.tsx` 에서 읽어 `getLandingPanels({ includeDrafts })` 로(Safe 가 예외를 삼키면 빌드 프리렌더에서 빈 배열). `revalidate = 60` 은 `__prerender_bypass` 쿠키가 우회하므로 추가 배선 불필요. `disable()` 경로와 "미리보기 모드" 배너를 반드시. `Panel.tsx` `<section>` 에 `id` 추가해야 `/#panel-<id>` 가 된다.
- **비밀번호 변경·계정 활성화 UI 없음** (ADM-5, medium, d). `changePassword()`·`setAdminActive()`·`AccountError` 소비자 0. `layout.tsx:59` "다른 관리자에게 활성화를 요청" 안내가 있는데 그 화면이 없다. 06-auth-plan:298 은 본인 변경 UI 를 전제. **수정**: `ADMIN_TABS` 에 `account` 탭 + `_panels/AccountPanel.tsx`(내 비밀번호 변경 · 관리자 목록 활성/비활성) + `_actions/account.ts`(두 함수 다 내부에서 `requireAdmin()` 재호출·throw 하므로 try/catch 는 호출 전체, `isAccountError` 로 문구, `redirect` 는 try 밖) + `_data/admins.ts`(`passwordHash` 절대 select 금지). 비활성 확인은 `?remove=` URL 상태. **범위를 정직하게**: "비밀번호 분실"은 타 관리자 재설정 함수가 없어(`changePassword` 는 본인 현재 비밀번호 요구) 여전히 `bootstrap:admin --reset-password` — 강제 변경 컬럼은 마이그레이션이라 1차에서 제외.
- **Landing 집계 토큰 하나 → 충돌 시 32칸 소실** (ADM-6, medium, d). A 가 슬로건, B 가 후원 문구를 고쳐도 늦게 저장하는 쪽은 반드시 `CONFLICT`. **발견보다 나쁨**: React 19 는 액션 반환 직후 `form.reset()` 을 하므로 입력 손실은 새로고침이 아니라 **CONFLICT 가 돌아오는 순간**(34키 중 제어 입력 슬로건 2개 빼고 32개가 낡은 서버 값으로). **수정(추천, F8 "Save All 유지" 준수)**: 키별 hidden `orig.<key>` 를 함께 보내 서버가 `changedByMe = submitted≠orig`, `changedByOther = row≠orig` 를 계산 — **둘 다 참인 키가 있을 때만** 충돌(키 목록 반환), 남이 바꾼 키는 건너뛰고 내가 바꾼 키만 UPDATE 하는 3-way 병합. 원본값 없이 "불일치 키는 건너뛴다"로 완화하면 lost update. `CONFLICT` 상수는 건드리지 말고 `conflict({...})` 팩토리 신설, 결과에 `submitted` 도 실어 `defaultValue` 로 다시 그린다. `LandingCopyForm.tsx:146` "26키" → 34키.
- **세션 만료 뒤 입력 손실·기본 탭 복귀** (ADM-3, low). 트리거는 "점심 뒤"가 아니라 서버 요청 0인 8h 이상(밤새 탭). 지금도 다른 탭 로그인 → 원래 탭 재저장이 동작한다(안내만 없음). `LoginForm` 에 hidden `next`(`usePathname+useSearchParams`, `startsWith('/admin')` 검증), `ActionNotice` 가 DENIED 일 때 "새 탭에서 로그인"(bad_origin 과 문구 공유하니 조건부), `beforeunload` 는 `<Link>` 내비에서 발화하지 않으니 dirty 상태 Link onClick 가로채기까지 — 대상 폼 9개.
- **순서 변경 UX 탭마다 다름** (ADM-7, low, d). `movePanel` 트랜잭션을 `_lib/reorder.ts` 로 일반화해 기체·멤버에 ↑↓.
- **일괄 공개/내림은 스크립트만** (ADM-8, low, 1h). `PanelsPanel` 헤더에 "전부 내리기/공개"(`?confirm=all-off` URL 확인) + `setAllPanelsPublished(on)`.
- **`?saved=` 반사·잔류** (ADM-9, low, 1h). Panels 는 문장 자체를 URL 에 싣고 그대로 렌더(이스케이프라 XSS 아님, 사회공학 문구 주입). `parseSaved()` 열거형 + 마운트 시 `history.replaceState` 로 제거. Vehicles 문구는 `published` 여부로.

### 6.7 운영 · DX

- **저장 실패 로그가 고정 문자열** (OPS-5, medium, 2h). 14곳 `console.error('[admin] … 실패')` 인자 없음, `panels.ts` 3곳은 로그 **0**, members·landing 은 `pgError` 매핑도 없음. 5bcfd25 "패널 저장이 막히던 버그"는 CONFLICT 가 로그 0줄이라 DB 를 직접 읽어서야 알았다. **수정**: `_lib/form.ts` `logActionFailure(scope, err)` — `pgError(err).{code,constraint}` + `err.constructor.name` 만. **절대 `err.message` 금지**(`DrizzleQueryError.message` 가 `Failed query: <SQL> params: <바인딩 값>` — 행 값·세션 해시가 로그에 남는다). 17곳 교체 + CONFLICT 경로 카운트 한 줄. `src/instrumentation.ts` `onRequestError` 는 부가(미처리 예외만 — `fail()` 로 삼키는 경로는 못 잡는다; 헤더 찍지 말 것 — 세션 토큰 원문). Next 는 이미 미처리 렌더 에러를 digest 와 함께 찍으므로 "대조 불가" 서술은 빼라. "새 모니터링 도입 안 함" 결정과 충돌 없음(console 한 줄).
- **AGENTS.md/CLAUDE.md 가 08-30 에서 멈춤** (DX-1, medium, 3h). 9월 커밋 **7건**이 어느 쪽에도 없고(`db:tunnel`·`MAINTENANCE_MODE`·`/api/revalidate`·`/vehicles` 각 0건), CLAUDE.md 가 D28 을 인용하는데 DECISIONS 에 D28 없음, C4 는 CLAUDE.md "경로 없음" vs `15-infra-debt.md:222` "✅ 해결(08-28)". "AGENTS.md 먼저" 규칙은 9월 이전부터 안 지켜졌다(e55e4ae). **수정**: CLAUDE.md 를 `.gitignore` 에서 빼고 AGENTS.md 로 합친 뒤 CLAUDE.md 는 `@AGENTS.md` 한 줄 — 도메인 맥락의 학생 이름·학교·이메일은 이미 공개 페이지에 노출 중이라 새로 새는 것 없음(미성년자 실명이라 병합 시 한 번 더 볼 것). 9월 변경 서술 원본은 `17-nodb-fix-plan.md` — 요약 + 링크만. D28 항목 작성, `15-infra-debt.md` 헤더 날짜(실제 마지막 커밋 08-30). CI 경고 검사 대상 경로에 `src/middleware.ts`·`src/app/api/`·`package.json` 포함(누락 3건 전부 거기서).
- **마이그레이션 수동 + 미커밋 러너 + 주체 기록 없음** (OPS-6, medium). 원장은 `id·hash·created_at` 뿐. **즉시 완화**: 점검 셔터를 이용한 "셔터 → migrate → push → 해제" 순서를 AGENTS.md 명령 절에 적으면 순서 어긋남 창은 지금 닫힌다. **단기**: B 커밋, `db:migrate:drizzle` 삭제(`DECISIONS.md:579` 의 "의도적으로 남김" 줄도 갱신), `migrate.ts` 가 원장에 `alter table … add column if not exists applied_by text, git_sha text`(drizzle 파일 아니라 러너 자리에서) + `git status --porcelain drizzle/ scripts/db/ scripts/lib/` 가 비어 있지 않으면 non-dry 거부 또는 `<sha>-dirty`(지금 상태에서 sha 만 남기면 거짓 기록). `applied_by` 는 이메일 대신 `username@hostname`. **중기 CI `workflow_dispatch migrate`**: GitHub-hosted runner 는 Azure 대역이라 SG 에서 못 붙는다 — GHA OIDC → `ssm:StartSession` role → 포트포워딩 → migrate(ESSENTIA 계정 IAM 신뢰 정책 변경 = 승인 + 조율). `DATABASE_URL_MIGRATE` 는 이제 장기 비밀번호라 public 레포 Secrets 에 두려면 `environment: production` + required reviewers + 로테이션 절차.
- **스모크 진단 축이 09-06 캐시 이후 성립 안 함** (OPS-4, low, 30분). `/admin` 은 쿠키 없으면 DB 를 전혀 안 치는데 `db: true` → `dbFailed === dbTotal` 불가능 → 힌트 두 줄이 절대 안 나온다. `/admin` 을 `db: false` 로(`15-infra-debt.md:417` 표도 함께). `/`·`/member` 는 fail-safe 라 DB 장애 ≤60초 뒤 **빈 페이지가 캐시를 덮어** 본문 검사가 잡는다 — 분류에서 빼지 말고 `db: 'lagged'` 의미로. `/api/media/<id>` 도 lagged 쪽. 판정 완화(`>= 1`)는 오진 — 유지.
- **정리 큐 방치·cron 실행 여부가 `console.warn` 뿐** (OPS-7, low, 2h). 어드민에 "저장소 상태" 카드(open/abandoned 잡 수, 오래된 pending 수) + cron 이 `site_settings` `storage.cron_last_ok` 에 마지막 성공 시각 → 48h 넘으면 빨간불. 문서의 cron 시각에 `(UTC, 12:17 KST)`.
- **점검 셔터가 환경변수 → 재배포 필요, 운영 값 `false`** (OPS-8 · REL-2, low, d). 장애 한복판에 빌드를 기다려야 하고 그 빌드가 DB 를 치는 라우트 때문에 실패할 수 있다. 운영 값 `false` 는 코드가 아는 값(`on/off/unset`)이 아니다(fail-open 이라 열림; `true` 로 바꿔도 여전히 열림). **당장**: `isShutterDown()` 이 `on|true|1` 을 받고 헤더도 정규화. **다음**: Vercel Global Config(구 Edge Config)에서 `maintenance` 키를 먼저 읽고 실패 시 env 폴백(fail-open 유지) — 대시보드에서 수 초 반영.
- **죽은 코드·잔재** (DX-2, low, 30분). `vite.config.js`(설치 안 된 `vite` import), `icx-2.fbx`, `db:migrate:drizzle`, `supabase/.temp/`, `seed-from-legacy.ts`(현 스키마와 정합 미확인·파괴적), `sg-rollback-1787887025.json`, `docs/technical-debt/`(이전 감사 6파일 미추적 — 커밋하거나 `docs/.local/`), `.agents/`·`.claude/`·`skills-lock.json` → `.gitignore`.
- **의존성 정책** (DX-3, low, 30분). `.github/dependabot.yml`(weekly, react/react-dom ignore, minor-patch 그룹) + AGENTS.md 에 핀 해제 조건(`npm view @react-three/fiber peerDependencies.react` 가 `<19.3` 아닐 때, `next` minor 마다 `serverActions.allowedOrigins` 위치 재확인).

### 6.8 보안 · 신뢰성

- **member 사진 `no-store` 가 `/_next/image` 층에서 `public` 캐시** (SEC-1 · IMG-2, medium, 1h — **§5.4 단계 7 뒤에**). `/api/media/<member>` 는 `private, no-store` 지만 `MemberCard` 가 `next/image` 를 타므로 브라우저가 받는 `/_next/image?url=…&w=384` 는 `public, max-age=60` + HIT, 실측 `age: 837` 까지 계속 서빙(60초가 아니다 — "상한 미확인(수십 분 이상)"으로 적을 것). 메커니즘: `image-optimizer.js:848-862` 가 `s-maxage/max-age` 만 읽고 `private/no-store` 는 처리하지 않으며 `:1207` 이 무조건 `public` 으로 낸다 → `minimumCacheTTL` 로 못 고친다. 새 노출은 없다(URL 이 공개 HTML 에 있고 인증 없음) — 깨진 것은 `media.ts:217` "삭제 즉시 반영" 과 I17(⛔ 사용자 결정 대기)이 기대는 "CDN 사본 없음" 전제. **수정**: `/api/media/` 경로일 때만 `unoptimized`(`lib/image/contract.ts` 에 `isMediaUrl()` — 레거시 `/assets/img/member/*` 1건·`sungwoo.webp` 995KB 는 원본이 그대로 나가니 구분). 허용목록 판정을 `lib/image/policy.ts`(순수)로 옮기고 `media.ts` 는 re-export(`isCacheableEntityType` 은 `server-only`+db import 라 컴포넌트 트리로 DB 모듈이 딸려 온다). 비용: `/member` 뷰당 함수 호출 +4·DB +4(`member` 는 메모리 캐시도 제외) — icn1 전환 후엔 각 ~0.1s. `member` 를 허용목록에 넣는 반대 방향은 I17 결정 전 금지. `/_next/image?url=…<member-id>` 직접 호출은 여전히 가능 — 완전 차단은 URL 계약 변경(별개 과제, `15-infra-debt.md` 잔여 리스크로). `media.ts:216-217`·`15-infra-debt.md:71-72` 문장 정정.
- **next@16.3.2 에 critical 권고 2건** (SEC-2, low, 30분). GHSA-p293-qw3h-jr36(Windows RCE)·GHSA-2xp9-vwfh-vxw4(이미지 최적화기 AVIF RCE), sharp<0.35.4 high. **이 배포에서 도달 경로 없음**: Vercel 플랫폼 최적화기가 처리해 번들 sharp 가 안 돌고(`must-revalidate` 부재로 확인), `remotePatterns: []`, `/api/media` 는 `requireAdmin()` 뒤. 다만 관리자 업로드 AVIF 는 `sniffMime` 이 `ftyp` 만 보고 `video/mp4` 로 판정해 통과하고 내장 최적화기(`next start`)는 바이트로 AVIF 를 인식한다. **수정**: `package.json` `next` → `16.3.5` 직접 수정(`npm audit fix --force` 금지 — 핀이 stated range 밖이라 다른 패키지까지 건드린다), `npm ls sharp` 단일 해석 확인, react 핀·overrides 그대로(16.3.5 peer 도 `^19.0.0`). `sniffMime` 은 allowlist 가 아니라 **denylist**(major brand 8~11 바이트가 `avif|avis|heic|heix|hevc|hevx|mif1|msf1` 면 null) — 정상 영상 브랜드를 다 열거 못 하면 조용히 거부된다. `npm audit` 은 배포 차단 게이트가 아니라 리포트 잡으로.
- **스크립트 DB 쓰기가 캐시를 안 비움** (REL-1, low, 30분). `publish-panels.ts`·`hide-duplicate-post.ts` 등 6개가 `revalidate` 0건. `/`·`/member` 는 60초 백스톱, `/posts/legacy/[slug]`·`/vehicles/[slug]` 는 `revalidate=false` 라 영구. 현재 낡은 페이지는 **0장**(중복 글 내림은 캐시 전환 이전에 실행, 재실행은 skip) — 잠재 위험. **수정**: `scripts/lib/revalidate.ts` 가 `POST /api/revalidate`(Bearer) 를 치되 기본 origin 을 **www**로 또는 `redirect: 'manual'`(apex 307 에서 undici·curl 모두 `Authorization` 을 버려 401) — 우선 `publish-panels.ts`(재사용되는 유일한 도구) 하나면 충분, 나머지는 파일 머리 주석. `migrate.ts` 끝에도 검토(0006·0007 이 데이터 이동). `revalidate = 3600` 대안은 시간 기반 공개 여부 무효화라 **지뢰와 정면 충돌** — 금지.
- **`middleware` 규약 deprecated** (REL-3, low). Next 16 이 `proxy` 로 옮기라 경고. 규약이 제거되면 셔터가 **조용히** 사라진다(fail-open). `npx @next/codemod@canary middleware-to-proxy .` 를 SEC-2 업그레이드와 한 PR 에. `smoke.ts` 에 `x-icaros-shutter` 헤더 존재 검사.
- **셔터 우회 쿠키에 비밀 원문** (SEC-3, low, 30분). `MAINTENANCE_BYPASS` 원문이 8시간 쿠키(`__Host-` 없음)에 — 링크 받은 사람이 개발자도구에서 읽는다. `constantTimeEqual` 주석 "길이가 다른 문자열을 이른 return 으로 가르지 않는다" 는 코드와 반대. 쿠키 값을 `SHA-256('bypass-v1:' + secret)` hex 로, 이름 `__Host-…`, 주석 정정.
- **CSP·Permissions-Policy 없음** (SEC-4, low, d). XSS 표면은 작다(`skipHtml`, `dangerouslySetInnerHTML` 은 상수뿐, 외부 이미지 없음). 1단계 `Content-Security-Policy-Report-Only`(`'unsafe-inline'` 허용, three 워커·blob 확인) + `Permissions-Policy: camera=(), microphone=(), geolocation=()`. 2단계 proxy 에서 nonce.
- **`/api/revalidate` 재생·연타 제한 없음** (REL-4, low, 1h). 서명에 타임스탬프·nonce 없음 → 유효 요청 하나로 무한 재생 = 전 라우트 캐시 반복 폐기. `login_attempts` 에 `revalidate:global` 60초/5회 + Vercel 갈래는 `payload.deployment.id` 를 키로 1회만. 라우트 주석의 "최악은 한 번 더 지워진다" 정정.

### 6.9 반박된 항목

- **PERF-7 "패널 `100dvh` 가 모바일 주소창 개폐마다 CLS"** — 인용 코드는 정확하나 핵심 주장이 틀렸다. 주소창 개폐에 따른 `dvh` 변화는 사용자 스크롤에 의한 것이라 CLS 의 입력 면제(500ms) 대상이고, `Hero` 는 이미 `svh`. 조치 없음.

---

## 7. 실행 순서 제안

시간은 한 사람 기준. 승인·조율이 필요한 것은 ⚠.

**1일차 (3~4시간) — 회귀 막고 500 끄기**
1. ⚠ Vercel 배포 상세 Source + Production env(`DB_AUTH`, `RDS_CA_BUNDLE`, `PGSSL_SERVERNAME`, `ADMIN_ALLOWED_ORIGINS`) 읽기 — 10분. (§6.2-B)
2. 미커밋 4파일 리뷰(주석 2곳 수정) → 커밋 → 91cbf0d 와 함께 푸시 → `npm run smoke` — 1시간.
3. `/posts/[id]` 수정(택1) → 배포 → `npm run smoke` 에서 해당 항목 ✓ 확인 — 1시간. (§6.2-A)
4. `vercel.json` `buildCommand: "npm run lint && next build"` — 10분.
5. 코드만 되는 이미지 튜닝 3건(`fetchPriority`·`preload`, `deviceSizes` 1600, `quality` 정리) + `QueryProvider` 제거 + `next` 16.3.5 — 2시간. (§5.4 1~3, §6.4, §6.8)

**1주차 (하루) — 배선 맞추기**
6. ⚠ Vercel Domains apex 플립(308) + 웹훅 엔드포인트 apex 로 + `ADMIN_ALLOWED_ORIGINS` 양쪽 확인 → smoke — 1시간. (§6.2-D)
7. `.github/workflows/smoke.yml`(deployment_status + schedule + 실패 시 issue) — 2시간. (§6.2-E)
8. `/vehicles` `unstable_cache`, 리빌 `immediate`/`skip`, `/posts` 캐시 — 반나절. (§6.4)
9. Panels 액션 5개 try/catch + `admin/error.tsx`, 배경 고르기 필터 + 서버 검증, 저장 실패 로그 헬퍼 — 반나절. (§6.6, §6.7)
10. og 헬퍼 6곳, `/#donate`, alt 임시 `''`, 대비·CTA `:lang(ko)`, `<nav>` — 반나절. (§6.5)

**1달 안 — 지리와 기록**
11. ⚠ SG 재산출(`rds-sg-plan.ts` 드라이런 → 새 SG 추가 부착 → ESSENTIA 조율) → `regions: ["icn1"]` 배포 → 재측정 — 조율 포함 며칠. (§5.4 5~8)
12. 그 뒤 `MemberCard` `unoptimized` + `member` 문서 정정. (§6.8)
13. DECISIONS D28·D29 작성, AGENTS.md ← CLAUDE.md 병합, `15-infra-debt.md`·`17-nodb-fix-plan.md:445`·`.env.example` 정정 — 반나절. (§6.7, §8.2)
14. 마이그레이션 1건으로 묶기: `page_panels.alt`, `media.blur_data_url`, 원장 `applied_by/git_sha`, `#support`→`#donate` 데이터 이동 — 셔터 → migrate → push → 해제 순서. (§5.4 9, §6.5, §6.7)
15. Account 탭, Landing 3-way 병합, draftMode 미리보기 — 각 하루. (§6.6)

**이후** — robots/sitemap/JSON-LD/아이콘, Global Config 셔터, proxy 전환 + CSP report-only, 정리 큐 상태 카드, 죽은 코드 정리, dependabot.

---

## 8. 부록

### 8.1 환경변수 전체

| 변수 | 읽는 곳 | 역할 | `.env.example` |
|---|---|---|---|
| `DB_AUTH` | connection.ts, db-config.ts, drizzle.config.ts | `iam` 이면 IAM, 그 외 password | ○ |
| `DATABASE_URL` | connection.ts(password), db-config.ts | 접속 문자열. 미커밋본: 원격이면 CA+servername 없이는 throw | ○ |
| `DATABASE_URL_UNPOOLED` | db-config.ts, drizzle.config.ts | 스크립트 직결 URL(주석은 Neon 잔재) | ○ |
| `DATABASE_URL_MIGRATE` | db-config.ts(미커밋) | password 모드 migrator role URL | **✗** |
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` | connection.ts(iam), db-config.ts, tunnel.ts | IAM 엔드포인트·토큰 서명·TLS servername. tunnel 은 `PGHOST` 유무로 SSM 문서 분기 | ○ |
| `PGUSER_MIGRATE` | db-config.ts, drizzle.config.ts | 기본 `icaros_migrator` | ✗ |
| `PGSSL_SERVERNAME` | connection.ts, db-config.ts(미커밋) | password 모드 원격 TLS 검증 이름 | ✗ |
| `RDS_CA_BUNDLE` / `_PATH` | connection.ts, db-config.ts, drizzle.config.ts | CA PEM 본문/경로. 서버리스는 본문 | ○ |
| `PGTUNNEL_HOST` / `PGTUNNEL_PORT` | connection.ts, db-config.ts, tunnel.ts | SSM 터널 입구(접속 주소만). `\|\|` 로 빈 값 = 안 씀 | ✗ |
| `SSM_TUNNEL_TARGET` | tunnel.ts | 대상 인스턴스 id | ✗ |
| `AWS_REGION` | connection.ts, s3/config.ts, tunnel.ts, rds-sg-plan.ts | IAM 서명·S3 리전(기본 ap-northeast-2)·SSM | ○ |
| `AWS_PROFILE` | db-config.ts, drizzle.config.ts(기본 essentia), tunnel.ts, sg-plan | 로컬 aws CLI | ✗ |
| `AWS_ROLE_ARN` | connection.ts, s3/client.ts | Vercel OIDC 역할 수임(DB·S3 둘 다). 기본 체인은 Vercel 에서 안 붙는다 | ✗ |
| `S3_BUCKET` `S3_PREFIX` `S3_ENDPOINT` | s3/config.ts, seed-panels.ts | 버킷(없으면 호출 시 503)·키 루트(기본 icaros-web)·MinIO | ○ ○ ✗ |
| `ADMIN_ALLOWED_ORIGINS` | next.config.ts(호스트), guard.ts(절대 URL) | mutation Origin 허용목록. 기본 `icaros.kr,www.icaros.kr` | ○ |
| `ESSENTIA_API_BASE` | community/client.ts, export-posts.ts | 기본 `https://api.essentia-sci.org`, 서버 전용 | ○ |
| `CRON_SECRET` | api/cron/storage | Bearer. 미설정 → 401 = 큐 미처리 | ○ |
| `REVALIDATE_SECRET` / `VERCEL_WEBHOOK_SECRET` | api/revalidate | Bearer / HMAC-SHA1. 둘 다 없으면 503 | ○ |
| `MAINTENANCE_MODE` / `MAINTENANCE_BYPASS` | middleware.ts | `on` 이면 셔터 / 우회 토큰(비면 우회 없음) | ○ |
| `RDS_INSTANCE_ID` / `RDS_EXTRA_SG_IDS` | rds-sg-plan.ts | SG 계획 대상 | ✗ |
| `LEGACY_SUPABASE_URL` / `_ANON_KEY` | export-posts.ts, seed-from-legacy.ts | 레거시 export 전용 | ○ |
| `NODE_ENV` | db/index.ts, HeroStage, Scene | dev 에서 풀 globalThis 캐시·3D 경고 | — |

### 8.2 정본 문서가 실측·코드와 어긋난 지점

| 문서 | 문장 | 실제 |
|---|---|---|
| CLAUDE.md:24, AGENTS.md | "로컬 RDS 접속 차단(C4, 다음 마이그레이션 경로 없음)" | `15-infra-debt.md:222` C4 ✅ 해결(08-28, `db:tunnel`). 0007 이 그 경로로 적용됨 |
| CLAUDE.md:20 / :134 | "D1~D27" / "D28" 인용 | DECISIONS.md 에 D28 항목 없음 |
| CLAUDE.md:23, DECISIONS D26 | "PgBouncer 는 보류" | 미커밋 코드: 2026-09-06 자체 호스팅 + PgBouncer 운영 중 |
| CLAUDE.md, AGENTS.md, DECISIONS D17/D20 | "배포는 RDS IAM 인증" | 미커밋 코드: 운영이 password 모드 |
| CLAUDE.md:126, AGENTS.md:98 | "`next/font` preload — Turbopack 이 안 내보낸다. 현재 no-op" | 16.3.2 에서 `<link rel=preload as=font>` 2건 실제로 나감 |
| CLAUDE.md 규약 | "`--sig`(#ff7a00) 는 마크 전용" | `tokens.css` 시그널은 무채색 `#101418`, 오렌지 제거됨 |
| CLAUDE.md:157 | "`sim.icaros.kr` 은 헤더에서 링크만" | `Header.tsx:5-7` 에서 제거됨 |
| CLAUDE.md:75 | "cron 매일 03:17" | UTC 03:17 = KST 12:17 |
| CLAUDE.md, AGENTS.md | `db:tunnel`·`MAINTENANCE_MODE`·`/api/revalidate`·`/vehicles` | 각 0건 언급 — 9월 커밋 7건 미반영 |
| `17-nodb-fix-plan.md:445` | "함수 리전 변경 금지. RDS 가 us-east-1" | **오기** — DB·S3 는 ap-northeast-2. us-east-1 은 SG 에 넣은 Vercel egress 대역 |
| `17-nodb-fix-plan.md:366` | "이미지: 엣지 캐시 HIT 170ms — 정상" | HIT 만 잰 값. 미스·no-store 경로 1.3~5.3s |
| `17-nodb-fix-plan.md:732` | 웹훅 엔드포인트 `https://icaros.kr/api/revalidate` | 실제 등록은 www(`identifiers.md:39`); apex 는 307 |
| `next.config.ts:31` | "최적화기 캐시는 배포마다 비므로" | Vercel 문서: 배포로 비지 않는다. D26 의 "배포 ±8분 스파이크" 관측 자체는 유효(원인은 다른 것) |
| `next.config.ts:36` | "1920 화면 DPR2 가 3840 을 실제로 쓰고 손실이 보인다" | 원본 상한 1600px 이라 1920·3840 바이트 동일 — 손실 없음 |
| `15-infra-debt.md:71-72`, `media.ts:216` | "`member` 는 CDN 사본이 없다" | `/_next/image` 변형이 `public` 으로 엣지 캐시 |
| `15-infra-debt.md:7` | "최종 갱신 08-28" | §6 은 08-29, 마지막 커밋 08-30 |
| `15-infra-debt.md:417`, `smoke.ts:93` | `/admin` DB ○ | 쿠키 없으면 DB 안 침 |
| `posts/[id]/page.tsx:12` | "목록(`/posts`)의 60초보다 길게" | `/posts` 는 force-dynamic |
| `Panel.tsx:101` | `quality={82}` | `qualities` 미설정 → 75 |
| `PanelForm.tsx:47-49` | "`listPanelMediaChoices()` 는 mime 을 select 하지 않으므로" | select 한다(`_data/panels.ts:105`) |
| `PanelForm.tsx:377`, `LandingCopyForm.tsx:146` | eyebrow "작게 넓은 자간으로 나갑니다" / "26키" | 공개 렌더 없음(979d802) / 34키 |
| `connection.ts`(미커밋):170, :51 | "`sslmode=verify-full` 로 사설 CA 못 넣음" / "지우면 로컬이 public 을 본다" | `sslrootcert=` 는 파일을 읽음 / Drizzle 이 전 테이블 `icaros.` 한정 |
| `seed-panels.ts:14` vs `archive-legacy-images.ts:22` | Versioning 꺼짐 / 켜짐 | 모순, 실제 미확인 |
| `middleware.ts:60-65` | "길이가 다른 문자열을 이른 return 으로 가르지 않는다" | 첫 줄이 정확히 그렇게 한다 |
| `api/revalidate/route.ts:30` | "새면 최악은 캐시가 한 번 더 지워진다" | 재생으로 지속 폐기 가능 |

### 8.3 미확인 (코드·GET 실측으로 판정 못 한 것)

- Vercel Production env 실제 값(`DB_AUTH`, CA, `PGSSL_SERVERNAME`, `ADMIN_ALLOWED_ORIGINS`, `CRON_SECRET`, `REVALIDATE_SECRET`, `AWS_ROLE_ARN`)과 배포 Source(CLI/git), Git 연동·GitHub Deployments 설정, 플랜(리전 개수 제한).
- 자체 호스팅 DB 의 실제 리전·SG 구성(us-east-1 대역이 옮겨졌는지), S3 버킷 CORS·Versioning 상태.
- `/api/revalidate` 웹훅이 실제로 오는지(Vercel 로그 `[revalidate]`), Vercel 웹훅 발신기가 POST 3xx 를 따르는지.
- DB 실제 행수(`site_settings` 값, `rocket_models`·`home_feature` 유무, `media.entity_type IS NULL` 행, 정리 큐 잔량).
- 브라우저 계측 LCP/CLS/INP(curl 타이밍만), Windows/Android 한글 폰트 메트릭, 저사양 모바일 스크롤 프로파일.
- Vercel CDN HIT 경로의 Range 응답이 206 이 아니라 200+Content-Range 로 나오는 원인과 `<video>` 탐색 영향(현재 영상 패널 0).
- `npm run storage:cleanup` 이 `server-only` 모듈을 조건 재실행 없이 import 한 채 실제로 도는지.
- `/_next/image` 가 `Accept: */*` 에 5장 중 3장을 `image/jpeg` 로 돌려준 이유.
