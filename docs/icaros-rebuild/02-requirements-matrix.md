# 02 — Requirements Matrix

> 현행 기능 전수 × 리뉴얼 처분(keep / change / drop / new) × 검증 방법.
> Gate 6·7에서 이 표를 회귀 체크리스트로 그대로 사용한다.
> 상태 범례: `☐` 미착수 · `◐` 진행 · `☑` 완료·검증됨 · `⛔` blocked

---

## A. 전역 (Global)

| # | 현행 | 처분 | 리뉴얼 요구사항 | 검증 | 상태 |
|---|---|---|---|---|---|
| A1 | 워드마크 → `/` | keep | 동일 | 클릭 → `/` | ☐ |
| A2 | Header 메뉴 5개 | **change** | Simulate 제거 → **4개** (About Us · Rockets · Posts · Members). **메뉴명 CMS 편집 가능** | 렌더 4개, CMS에서 라벨 변경 반영 | ☐ |
| A3 | 모바일 햄버거 + ARIA | keep | `aria-expanded`/`aria-controls` 유지, 키보드 조작·포커스 트랩 추가 | 스크린리더 + 키보드 단독 통과 | ☐ |
| A4 | `.nav-simulate-mobile` 버튼 | **drop** | 완전 제거 | 문자열 검색 0건 | ☐ |
| A5 | Footer 저작권 하드코딩 | **change** | **CMS 편집 가능** | CMS 수정 → 반영 | ☐ |
| A6 | Suspense fallback `null` (빈 화면) | **change** | `loading.tsx` — 스켈레톤 또는 로고 로더 | 느린 네트워크에서 빈 화면 없음 | ☐ |
| A7 | 404 `FuzzyText` 캔버스 | keep | `not-found.tsx`로 이식. `prefers-reduced-motion` 존중 | 404 접근 + reduced-motion 확인 | ☐ |
| A8 | 에러 화면 없음 | **new** | `error.tsx` | 강제 throw → 복구 UI | ☐ |
| A9 | `lang="ko"` | keep | 동일 | HTML 속성 | ☐ |
| A10 | 메타·OG `index.html` 하드코딩 | **change** | `generateMetadata`로 **CMS 기반**, 페이지별 title/description/OG | 각 라우트 OG 태그 확인 | ☐ |
| A11 | `vercel.json` rewrite + `_redirects` 이중 관리 | **drop** | Next.js 라우팅이 대체. 두 파일 제거 | 파일 부재 | ☐ |
| A12 | ScrollToTop 수동 구현 | **drop** | Next App Router 기본 동작이 대체 | 라우트 전환 시 상단 | ☐ |
| A13 | 폰트 ttf만 (Trial 라이선스) | **change** | woff2 서브셋 + `next/font`. **라이선스 확인 선행** | 로드 용량 · 라이선스 문서 | ⛔ |
| A14 | 반응형 | keep | 375 / 768 / 1280 / 1920 검증 | 4개 뷰포트 | ☐ |
| A15 | Vercel 독립 배포 | keep | **ESSENTIA와 별개 Vercel 프로젝트 유지** | 배포 대시보드 | ☐ |

---

## B. Home / Landing

| # | 현행 | 처분 | 리뉴얼 요구사항 | 검증 | 상태 |
|---|---|---|---|---|---|
| B1 | Hero: 로고 + ICAROS 이니셜 전개 + 스크롤 화살표 | keep+ | 유지 + Vast식 3D/미디어 통합 | 시각 검토 | ☐ |
| B2 | About / Vision / Research / Mission / Donate / Contact | keep | **7개 섹션 전부 유지** | 섹션 존재 | ☐ |
| B3 | 슬로건 `**단어**` 하이라이트 | keep | 강조 단어 CMS 편집 | CMS 수정 → 강조 반영 | ☐ |
| B4 | 데스크탑/모바일 슬로건 DOM 이중 렌더 | **change** | 단일 렌더 + CSS | DOM에 1개만 | ☐ |
| B5 | `주요 활동은 다음과 같습니다.` 하드코딩 | **change** | CMS화 | CMS 편집 | ☐ |
| B6 | Donate 인용구·마무리 문구 하드코딩 | **change** | CMS화 | CMS 편집 | ☐ |
| B7 | 진행률 바 + `Intl.NumberFormat('ko-KR')` | keep | 동일 | 금액 포맷 · 0/100 clamp | ☐ |
| B8 | `후원 문의하기` → `alert()` | **change** | `alert()` 제거. Contact 앵커 또는 CMS 지정 URL | alert 미발생 | ☐ |
| B9 | Contact 이메일·Instagram 하드코딩 | **change** | CMS화 | CMS 편집 | ☐ |
| B10 | `DEFAULTS` 오버레이 폴백 (DB와 이미 어긋남) | **drop** | 서버에서 DB 직접 조회. **하드코딩 폴백 사본 제거** | 코드에 카피 상수 없음 | ☐ |
| B11 | — | **new** | 섹션 **활성화 토글 + 순서 변경** CMS | 순서 바꿔 반영 | ☐ |
| B12 | — | **new** | **대표 로켓 / 대표 3D 모델** 지정 | CMS에서 교체 → 홈 반영 | ☐ |

---

## C. Rockets

| # | 현행 | 처분 | 리뉴얼 요구사항 | 검증 | 상태 |
|---|---|---|---|---|---|
| C1 | 시리즈 탭 A/B | keep | 유지 (CMS 시리즈 값 기반) | 탭 전환 | ☐ |
| C2 | 카드 그리드 (이미지 + 이름) | keep | 유지 | 4기 렌더 | ☐ |
| C3 | 모달 상세 (고도·길이·페이로드·엔진) | **change** | **모달 → `/rocket/[slug]` 전용 페이지**. 딥링크 가능 | URL 직접 접근 | ☐ |
| C4 | 4기 데이터 | keep | ICX-IA · ICX-Is · ICX MV-I · ICX MV-I LR **전수 이전** | 4행 일치 | ☐ |
| C5 | 엔진 jsonb 배열 | keep | 정규화 검토(`icaros_rocket_engines`) 또는 jsonb 유지 | 엔진 수·값 일치 | ☐ |
| C6 | — | **new** | Markdown 설명 | CMS 입력 → 렌더 | ☐ |
| C7 | — | **new** | 대표 이미지 + **갤러리** | 다중 업로드 | ☐ |
| C8 | — | **new** | **공개 여부** 플래그 | 비공개 → 목록·직접URL 모두 차단 | ☐ |
| C9 | `sort_order` | keep | 유지 + tie-break | 순서 결정적 | ☐ |
| C10 | — | **new** | **GLB 모델 + 포스터 이미지** | 업로드 → 렌더 | ☐ |
| C11 | — | **new** | **Hotspot**(위치·제목·본문·부품 강조) | 클릭 → 설명 표시 | ☐ |
| C12 | — | **new** | **모바일 fallback**(포스터, WebGL 미강제) | 모바일 실기 | ☐ |
| C13 | 검색·필터 없음 | keep(없음) | 4기 규모에선 불필요 | — | ☐ |

---

## D. Posts (⚠ 최대 리스크 영역)

| # | 현행 | 처분 | 리뉴얼 요구사항 | 검증 | 상태 |
|---|---|---|---|---|---|
| D1 | Supabase `posts` 테이블 | **drop** | **ESSENTIA Community의 ICAROS 게시판이 단일 원본**. `icaros_posts` 생성 금지 | 별도 테이블 부재 | ⛔ |
| D2 | 20건 | keep | 전수 이전, 제목·본문·이미지·**게시일**·작성자 보존 | 20건 대조 | ⛔ |
| D3 | 카드 그리드 12개 + `더 보기` | keep | 유지 | 페이지네이션 | ☐ |
| D4 | 커버·요약 클라이언트 파생 | **change** | 서버 파생 또는 DB 트리거. **기존 `summary` 13/20건이 낡았으므로 이전 시 복사 금지·재계산** | 직접 INSERT 후에도 일관 / 20건 요약 재생성 확인 | ☐ |
| D5 | 모달 상세 | **change** | **`/posts/[slug]` 전용 페이지** | URL 직접 접근 | ☐ |
| D6 | 발행일 지정 불가 | **change** | CMS에서 게시일 편집 → **기존 10건의 뭉친 날짜 교정** | 타임라인 순서 | ☐ |
| D7 | — | **new** | ICAROS CMS 작성 → ESSENTIA 노출 / ESSENTIA 수정 → ICAROS 즉시 반영 | 양방향 실측 | ⛔ |
| D8 | — | **new** | 중복 row 없음, dual-write·cron sync 금지 | 쓰기 경로 1개 | ⛔ |
| D9 | — | **new** | ICAROS 게시판 **외** 접근 불가 | 타 board id 시도 → 거부 | ⛔ |

---

## E. Members

| # | 현행 | 처분 | 리뉴얼 요구사항 | 검증 | 상태 |
|---|---|---|---|---|---|
| E1 | 27명 카드(이미지·이름·역할) | keep | 전수 이전 | 27행 | ☐ |
| E2 | `school` 미표시 | **change** | 표시 여부 결정 후 일관 적용 | 렌더 확인 | ☐ |
| E3 | `sort_order` 중복(값 5 ×3) | **change** | 이전 시 재부여 + tie-break | 중복 0, 순서 결정적 | ☐ |
| E4 | — | **new** | **소속 분야**(부서) 구조화 필드 | 부서별 그룹 렌더 | ☐ |
| E5 | — | **new** | **공개 여부** | 비공개 → 미노출 | ☐ |
| E6 | 프로필 없으면 `profile.webp` | keep | 유지(23/27명이 해당) | 플레이스홀더 | ☐ |

---

## F. Admin CMS

| # | 현행 | 처분 | 리뉴얼 요구사항 | 검증 | 상태 |
|---|---|---|---|---|---|
| F1 | `/admin` 탭 4개 | keep | Posts · Rockets · Members · Landing 유지 | 탭 4개 | ☐ |
| F2 | 로그인 + 권한 검사 | **change** | Supabase Auth → **자체 Neon 인증** (§09) | 로그인 플로우 | ☐ |
| F3 | 마크다운 툴바 + 실시간 미리보기 | keep | 동일 기능 유지 | 각 버튼 동작 | ☐ |
| F4 | 이미지 다중 업로드 | keep | S3 presigned로 재구현 | 다중 선택 | ☐ |
| F5 | Create · Update · Cancel · Delete | keep | 전 엔티티 | CRUD 일주 | ☐ |
| F6 | 삭제 시 Storage 정리 | **change** | S3 정리 + **실패 시 재시도 가능한 cleanup** | 삭제 후 객체 부재 / 실패 재시도 | ☐ |
| F7 | 엔진 동적 추가·삭제 | keep | 유지 | 엔진 편집 | ☐ |
| F8 | Landing **18**필드 `Save All` | **change** | 유지하되 **fetch 실패 시 저장 차단**(현행 결함 #1) | 네트워크 차단 후 Save 불가 | ☐ |
| F9 | — | **new** | 3D Scene Configuration (§08) | 아래 G | ☐ |
| F10 | — | **new** | SEO·OG·섹션 순서·메뉴명·Footer 편집 | 각 필드 반영 | ☐ |
| F11 | `window.confirm` 삭제 | keep | 유지 가능(접근성 개선 권장) | — | ☐ |
| F12 | 낙관적 잠금 없음 | **change** | `updated_at` 기반 충돌 감지 검토 | 동시 편집 | ☐ |
| F13 | — | — | **Admin은 WebGL보다 생산성·안정성 우선** — 관리 화면에 3D 뷰어 강제 금지 | 설계 검토 | ☐ |

---

## G. 3D Scene CMS (전부 신규)

| # | 요구사항 | 검증 | 상태 |
|---|---|---|---|
| G1 | GLB 업로드 / 교체 | 교체 후 렌더 | ☐ |
| G2 | 포스터 이미지 | WebGL off 시 표시 | ☐ |
| G3 | 연결 로켓 지정 | 링크 동작 | ☐ |
| G4 | scale · position · rotation | 값 변경 반영 | ☐ |
| G5 | camera position · target | 값 변경 반영 | ☐ |
| G6 | **스크롤별 camera preset** | 스크롤 구간별 전환 | ☐ |
| G7 | lighting · environment | 값 변경 반영 | ☐ |
| G8 | auto rotation | 토글 | ☐ |
| G9 | animation clip 선택 | 클립 재생 | ☐ |
| G10 | Hotspot 위치·제목·본문 | 추가/편집/삭제 | ☐ |
| G11 | 부품 강조 | 강조 동작 | ☐ |
| G12 | Desktop / Mobile 개별 활성화 | 뷰포트별 | ☐ |
| G13 | **임의 JS 저장 금지 — 검증된 JSON schema만** | 스키마 위반 입력 거부 | ☐ |
| G14 | 모델 교체 후 framing 파손 방지 | 다른 GLB로 교체 후 확인 | ☐ |

---

## H. 인증 · 보안 (전면 재구현)

| # | 요구사항 | 검증 | 상태 |
|---|---|---|---|
| H1 | 외부 Auth SaaS 미사용 (Supabase/Auth0/Firebase 금지) | 의존성 검사 | ☐ |
| H2 | 공개 회원가입 없음 — `/admin` 전용 | 가입 경로 부재 | ☐ |
| H3 | 이메일 정규화 | 대소문자/공백 변형 로그인 | ☐ |
| H4 | **검증된 Argon2id 구현**으로 해싱 (자체 암호 알고리즘 금지) | 코드 검토 | ☐ |
| H5 | 비밀번호 평문 저장·로그 출력 금지 | DB·로그 grep | ☐ |
| H6 | 강한 random opaque session token | 엔트로피 검토 | ☐ |
| H7 | DB에는 token **hash** 저장 (원문 금지) | 스키마 검토 | ☐ |
| H8 | Cookie `HttpOnly` + `Secure` + 적절한 `SameSite` | 응답 헤더 | ☐ |
| H9 | session 만료 | 만료 후 거부 | ☐ |
| H10 | logout → **server-side revoke** | 쿠키 재사용 시 거부 | ☐ |
| H11 | 모든 CMS mutation에서 세션 검증 | 미인증 mutation 시도 | ☐ |
| H12 | CSRF 방어 + **Origin 검증** | 위조 Origin 요청 | ☐ |
| H13 | 로그인 rate limit + 실패 기반 backoff | 연속 실패 | ☐ |
| H14 | 보안 이벤트 기록 (`icaros_auth_events`) | 로그인/실패/로그아웃 기록 | ☐ |
| H15 | 관리자 비활성화 | 비활성 계정 로그인 거부 | ☐ |
| H16 | 비밀번호 변경 시 **기존 세션 전부 폐기** | 타 세션 무효화 | ☐ |
| H17 | timing-safe 비교 | 코드 검토 | ☐ |
| H18 | 인증 Action/Handler는 **Node runtime** | 런타임 지정 확인 | ☐ |
| H19 | 초기 관리자 = 일회성 bootstrap CLI | 기본 비밀번호·하드코딩 부재 | ☐ |
| H20 | 기존 Supabase 비밀번호 hash·session **이전 금지** — 계정 재발급 절차만 | 절차 문서 | ☐ |
| H21 | Client bundle에 비밀값 없음 | 번들 grep | ☐ |
| H22 | 독립 Security Reviewer 검토 | 리뷰 산출물 | ☐ |

---

## I. S3 Storage

| # | 요구사항 | 검증 | 상태 |
|---|---|---|---|
| I1 | 모든 로컬 AWS CLI에 `--profile essentia` | 명령 로그 | ☑ (`sts get-caller-identity` 완료 — Account `009144422504`, `ap-northeast-2`) |
| I2 | bucket·prefix는 `essentia_infra` 확인 후 확정 | 응답 수신 | ⛔ |
| I3 | AWS SDK v3, 서버에서 presigned 생성 | 코드 검토 | ☐ |
| I4 | 허용된 bucket·prefix 밖 업로드 차단 | 타 prefix 시도 | ☐ |
| I5 | 확장자 + MIME 검증 | 위조 MIME | ☐ |
| I6 | 이미지·GLB 용량 제한 | 초과 업로드 | ☐ |
| I7 | 파일명 미신뢰 · random UUID key | 키 형식 | ☐ |
| I8 | 업로드 완료 검증 (pending → ready) | 중단된 업로드 | ☐ |
| I9 | DB row ↔ S3 object 불일치 처리 | 고아 탐지 | ☐ |
| I10 | 삭제 실패 재시도 가능한 cleanup | 실패 주입 | ☐ |
| I11 | S3 delete는 ICAROS prefix 내부만 | 범위 밖 삭제 시도 | ☐ |
| I12 | private bucket 유지, 공개 전달은 승인된 CloudFront/presigned | 직접 URL 접근 | ⛔ |
| I13 | Client에 AWS Secret 미노출 | 번들 grep | ☐ |
| I14 | 삭제 전 연결 entity 재확인 | 참조 중 삭제 시도 | ☐ |
| I15 | Neon에 메타데이터만 저장(bucket·key·filename·MIME·size·checksum·w/h·entity·created_at·deleted_at) | 스키마 | ⛔ |
| I16 | **파생 이미지 생성**(썸네일·webp) — 현행 52개 중 21개가 2 MiB 초과, 최대 9.7 MiB, 파생본 0개 | 카드 뷰 전송량 측정 | ☐ |
| I17 | **멤버 프로필은 미성년자 얼굴 사진** — 공개 전달 방식이 개인정보 결정 사항 | 공개 범위 사용자 승인 | ⛔ |

---

## J. 마이그레이션 데이터 무결성

| # | 대상 | 기대값 | 검증 | 상태 |
|---|---|---|---|---|
| J1 | Landing keys | **18** (마스터 프롬프트의 "22"는 오류 — 실측 18) | 키 대조 | ☐ |
| J2 | Rockets | **4** | id·name·series·스펙 대조 | ☐ |
| J3 | Rocket engines | 로켓별 배열 길이 일치 | 값 대조 | ☐ |
| J4 | Posts | **20** | 제목·본문·게시일·작성자 | ⛔ |
| J5 | Members | **27** | 이름·역할·학교·순서 | ☐ |
| J6 | 이미지 | Storage 52 obj / 86.67 MiB 중 참조 49 | checksum·개수 | ☐ |
| J7 | 로컬 레포 이미지(로켓 4·멤버 4) | S3 업로드 필요 | 존재 확인 | ☐ |
| J8 | 고아 3개 | **이전 제외** | 목록 확정 | ☐ |
| J9 | Admin 이메일 목록 | 확인만, 재발급 | 목록 | ☐ |
| J10 | `posts` 테이블 DDL | **레포·git history 어디에도 없음** → Supabase 폐기 전 `pg_dump --schema-only` (service_role 필요) | 덤프 파일 존재 | ⛔ |
| J11 | `admins` + `auth.users` | anon으로 조회 불가(200 + 빈 배열). **폐기 전 service_role 덤프 필수** — 안 하면 "이전 성공했는데 아무도 로그인 못 함"이 에러 없이 발생 | 덤프 파일 존재 | ⛔ |
| J12 | 대문자 `.PNG` 오브젝트 2개 | S3 키 대소문자 구분 → 정규화 | 키 규칙 검사 | ☐ |
| J13 | 고아 3개 중 1개는 참조본과 바이트 동일 중복 | 이전 제외 | 목록 | ☐ |

---

## K. 잔존 의존성 최종 검사 (Gate 7)

런타임 코드·환경설정에서 아래 문자열 **0건**이어야 한다 (마이그레이션 문서 제외).

| 문자열 | 상태 |
|---|---|
| `supabase` | ☐ |
| `NEXT_PUBLIC_SUPABASE` | ☐ |
| `SUPABASE_SERVICE_ROLE` | ☐ |
| `sim.icaros.kr` | ☐ |
| `nav-simulate-mobile` | ☐ |
| `simulate` | ☐ |

---

## L. 현행 결함 해소 확인 (01-current-state §8)

| 결함 | 해소 방법 | 상태 |
|---|---|---|
| #1 Landing 전체 공백 덮어쓰기 | fetch 실패 시 저장 차단 + 서버 검증 | ☐ |
| #2 이미지 고아 | pending/ready + cleanup job | ☐ |
| #3 발행일 지정 불가 | CMS 게시일 필드 | ☐ |
| #4 sort_order 중복 | 이전 시 재부여 + tie-break | ☐ |
| #5 posts CREATE 문 부재 | Drizzle schema가 단일 정의 | ☐ |
| #6 CHECK 제약 0개 | Drizzle 제약 + Zod 서버 검증 | ☐ |
| #7 에러 문자열 잔존 | 폼 상태 초기화 | ☐ |
| #8 빈 화면 로딩 | `loading.tsx` | ☐ |
| #9 폰트 라이선스 | 확인 후 결정 | ⛔ |

---

## 블로커 요약

| 블로커 | 대기 대상 | 영향 범위 |
|---|---|---|
| Neon 스키마·Community 테이블·board id·migration ownership | `essentia_infra` | D 전체, J4, 11장 DB 설계 |
| S3 bucket·prefix·CloudFront·IAM | `essentia_infra` | I2·I12·I15, 10장 |
| 폰트 상용 라이선스 | 사용자 | A13, Gate 3 |
| `posts` DDL · `admins` · `auth.users` 덤프 (service_role 필요) | 사용자 (Supabase Dashboard) | J10·J11 — **Supabase 폐기 전에 반드시** |
| 멤버(미성년자) 사진 공개 범위 | 사용자 | I17, 공개 전달 방식 |
| `git restore supabase/` 승인 | 사용자 | 마이그레이션 근거 자료 |
| 브라우저 스크린샷 캡처 승인 | 사용자 | Gate 1 완료, Gate 3 비교 기준 |
