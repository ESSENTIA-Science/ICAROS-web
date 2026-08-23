# Decision Log

> 확정된 결정만 기록. 근거와 기각된 대안을 함께 남긴다.
> 상태: `확정` · `보류` · `범위 밖`

| # | 결정 | 상태 | 근거 | 기각안 |
|---|---|---|---|---|
| D1 | **Posts는 (A) ESSENTIA 서비스 토큰 경로**로 Community와 단일 원본 연동 | 확정 (착수 시점 미정) | 카테고리 권한·레이트리밋·`author_role` 스냅샷·이미지 MIME 검증·감사 로그·soft delete 규칙이 ESSENTIA 한 곳에 유지됨 | (B) 읽기 전용 — 요구 미충족 / (C) DB 직접 write — 6개 규칙 이중 구현, 반드시 어긋남 |
| D2 | ICAROS 테이블은 **별도 `icaros` 스키마** | 확정 | ESSENTIA가 `ddl-auto: validate`로 기동 → `public`에 낯선 테이블이 생기면 API 기동 실패 가능. `public.session` 이름 충돌도 회피 | `public.icaros_*` 접두사 |
| D3 | 이미지·GLB는 **전부 private + `/api/media/{id}` 프록시** (전달 방식은 D15 로 수정 — 302 → 스트리밍) | 확정 | ESSENTIA에 공개 읽기 클래스 전례 없음 · CloudFront signed URL 구현체 없음 · 멤버 사진이 미성년자. 프록시 URL이 고정이라 `next/image` 캐시가 붙고 접근 통제 지점이 하나로 모임 | 공개용 CloudFront 배포 신설 — 기존 배포는 정적 사이트 전용 + OAC 묶임, 재사용 불가 |
| D4 | S3 프리픽스 **`icaros-web/`**, 공개/비공개 분리 없음 | 확정 | 기존 12개 프리픽스 중 어느 것의 접두사도 아님(교차 삭제 사고 전력 대응). D3으로 단일 private 클래스 | `…/pub/` + `…/priv/` 이분 |
| D5 | Vercel 런타임 AWS 인증 = **OIDC 역할 수임** | 확정 | ESSENTIA는 런타임에 장기 키를 두는 곳이 없음(EC2 인스턴스 프로파일, GHA OIDC). 로컬 `essentia` 프로필은 IAM 사용자 장기 키라 런타임 사용 불가 | IAM user access key |
| D6 | CORS 오리진 = 프로덕션 도메인 + **고정 프리뷰 별칭 1개** | 확정 | `*.vercel.app`은 타인의 Vercel 앱까지 포함 | 프리뷰 와일드카드 |
| D7 | ~~Neon은 Preview 직전에 붙인다~~ → **무효 (D16)**. Gate 4까지 로컬 postgres:17 로 진행하는 부분만 유효 | 무효 | Neon 콘솔 접근 없이도 구현·검증 가능. role 권한 범위는 구현을 해봐야 정확히 정해짐 | 선행 Neon 접근권 확보 |
| D8 | `VITE_ADMIN_PW` 유출 → **로테이션·history purge 미실시** | 확정 | 사용자 판단: 이미 폐기된 값. 리뉴얼로 Supabase 자체가 제거되며 해당 자격증명 계열 전부 무효화 | git-filter-repo + force-push |
| D9 | 삭제된 `supabase/migrations/` **복구 안 함** | 확정 | `00-legacy-schema-snapshot.md`로 대체 기록. git history에 원문 존재 | `git restore supabase/` |
| D10 | 디스플레이 폰트 | **보류** | `WidescreenUEx_Trial_*` — 9파일 ~900KB 미서브셋 TTF, 파일명이 "Trial". 웹 라이선스 확인 필요 | — |
| D11 | ICAROS 게시판 | ✅ **해제 — 만들 필요 없음. 이미 존재** | `projects`에 ICAROS 행이 이미 있고(`2cb1ee87-9a24-4ea8-b38c-6c9d30eea042`) 카테고리로 동적 부착 중. `forum_posts.project_id` FK 경로도 열려 있음 | `forum_categories` 행 신설 / `projects` 행 신설 — **둘 다 하면 안 됨** |
| D13 | Posts 작성자 = **ICAROS 서비스 계정** FK로 전건 귀속 | 확정 | 레거시에 작성자 데이터가 전무(컬럼·서명 모두 0). 서비스 계정은 탈퇴하지 않아 익명화 공백이 성립하지 않고, FK가 채워져 소유·수정·삭제가 일관됨. D1 작업에 포함 | 글별 실명 귀속(수작업 18~19건 + 운영 DB 대조) / FK NULL + `author_name='ICAROS'`(마이페이지 관리 불가) |
| D15 | `/api/media/[id]` 는 302 가 아니라 **바이트를 스트리밍**한다 (D3 수정) | 확정 | 검토에서 Next 16.3.2 소스로 확인: `src` 가 `/` 로 시작하면 `fetchInternalImage` 경로를 타는데 **`Location` 을 따라가는 코드가 없고** body 0바이트면 `ImageError(400)`. 리다이렉트 추적은 `fetchExternalImage` 뿐인데 절대 URL 이 필요하고 `remotePatterns: []` 가 그걸 거부한다 → **양쪽 다 막힘**. 스트리밍하면 presigned URL 이 클라이언트로 새는 경로도 함께 닫히고, 업로드 시점에 이미 ≤2MB WebP 라 비용이 작다 | 302 리다이렉트(현 구현 — 동작하지 않음) / `remotePatterns` 개방(presigned URL 이 캐시 키를 오염시키고 5~10분마다 miss) |
| D14 | ICAROS 서비스 계정: `author_role = 'outsider'`, **`user` 행만 만들고 `members` 행은 만들지 않음** | 확정 | `public.role` enum은 `outsider`/`member`/`officer` 3개뿐이고 비-사람 값이 없다. `author_role`은 **표시 전용**(호출부 7곳 전부 DTO 조립, 인가는 `Viewer`가 별도 판정)이라 기능적 대가 0. `outsider`는 거짓을 주장하지 않는 유일한 값이고, 코드베이스가 이미 삭제된 글의 자리표시자로 `Role.OUTSIDER`를 쓴다. `members` 행을 만들면 **숨김 플래그가 없어** 공개 명단 `/members`에 뜨고 회원 수가 33→34로 보이며 회원 코드 대역(임원 `1XXXX`/회원 `2XXXX`)을 하나 소비한다 | `officer`(없는 권위 주장) / `member`(사람 계정과 배지 구분 불가) |
| D12 | presigned **PUT** 채택 (POST 아님) | 확정 | 버킷이 공유 자원이고 ESSENTIA는 이미 presigned PUT + `content-type;host` 서명으로 타입을 강제한다. POST를 열면 **같은 버킷에 검증 모델이 두 개** 생긴다. 크기 상한은 ① 브라우저 전처리 ② `/confirm`의 `HeadObject` 검증 후 초과 시 삭제로 담보 | presigned POST + `content-length-range` — 보장은 더 강하지만 공유 버킷을 쪼개는 값을 못 함 |

## 기본값으로 채택 (별도 질의 없이)

| 항목 | 값 |
|---|---|
| 업로드 전처리 | 브라우저 canvas → WebP q0.85, SVG 차단, 서버는 `image/webp`만 수락 |
| 이미지 상한 | `media` 512px / `hero`·`poster` 1600px. **인코딩 시 q0.85에서 시작해 상한 이하가 될 때까지 품질을 단계적으로 낮춘다** — 1600px는 q0.85로 2MB를 넘을 수 있음. 상한: `media` 1MB / `hero`·`poster` 2MB |
| GLB 상한 | **8MB**, `@gltf-transform/cli`로 Draco 또는 meshopt |
| presigned TTL | **10분** (ESSENTIA 프로필·게시판 관례) |
| presigned 방식 | **PUT** — ESSENTIA와 동일 (D12) |
| CORS 변경 **2건** | `ExposeHeaders`에 `Content-Range`·`Accept-Ranges`(GLB Range) · ICAROS 오리진 추가. ~~`POST` 메서드 추가~~ **철회** (D12) |
| React 버전 | **19.2.x 정확히 핀** — R3F peer가 `>=19 <19.3` 창이고 Next peer(`^19.0.0`)는 19.3을 통과시킴 |
| DB 드라이버 | `pg` (TCP). Fluid Compute에서 Vercel·Neon 모두 HTTP 드라이버보다 권장 |
| 마이그레이션 | `drizzle-kit push` 금지. `generate` + `migrate`만, unpooled로, `next build` 밖에서 |

## 미결 — 사용자 조치 필요

| # | 항목 | 왜 나여야 하는가 |
|---|---|---|
| U1 | Supabase `pg_dump --schema-only` (`posts` DDL) | `service_role` 필요. DDL이 레포·git history 어디에도 없음 |
| U2 | Supabase `admins` + `auth.users` 이메일 덤프 | `service_role` 필요. anon으로는 에러가 아니라 **빈 배열**이 와서 실패를 감지할 수 없음 |
| U3 | ~~카테고리 집계~~ | ✅ **해소** — `essentia_infra`가 공개 API로 확인 |
| U7 | **ICAROS 기존 4건 vs 우리 20건 중복 판정** | 제목·날짜 대조로 최소 1건 확정 중복, 1건 판단 필요. 본문 대조는 사람이 봐야 함 |
| U8 | ~~작성자 귀속 정책~~ | ✅ **해소 — D13** |
| U4 | 폰트 웹 라이선스 확인 | D10 해소 |
| U5 | Chrome 확장 연결 | Gate 1 스크린샷, Gate 3 시각 비교 기준 |
| U6 | ESSENTIA BE 서비스 토큰 착수 시점 | D1 실행. 이 레포 범위 밖 |


---

## 중복 판정 — ICAROS 기존 4건 × 레거시 20건 (U7)

ESSENTIA 신규 인프라 전환은 **2026-08-05**. 그 이전 3건은 구 게시판 ETL로 넘어온 것이라 우리 레거시와 같은 원본일 가능성이 높다.

| ESSENTIA 기존 | 우리 Supabase | 판정 | 조치 |
|---|---|---|---|
| 2026-08-08 `ICX-II RAON TMS` | 2026-08-08 `ICX-II RAON TMS` | **확정 중복** — 제목·날짜 완전 일치. 전환 이후 글이므로 양쪽에 각각 작성된 것 | import 제외 |
| 2026-07-19 `ICAROS ICX-IA 1st Launch` | 2026-07-24 `ICX-1A Launch` | **판단 필요** — 같은 사건(2026-07-18 알뜨르 발사)이나 제목·날짜 상이. 본문·사진 대조 필요 | 사용자 확인 |
| 2026-07-17 `Proj.ICAROS ICX-I Mission Patch` | 없음 | ESSENTIA 전용 | 유지 |
| 2026-06-18 `ICAROS` | 없음 | ESSENTIA 전용 | 유지 |

카테고리 집계 합이 47(전체 총계)과 일치 → **`Icaros`/`icaros` 등 변형 표기로 흩어진 글은 없다.**
→ 예상 import 대상: **20건 중 18~19건.**

## 되돌릴 지점 (기록)

| 항목 | 지금 선택 | 나중에 문제가 되는 조건 |
|---|---|---|
| D3 전부 private + 302 프록시 | 채택 | 로켓 사진처럼 공개해도 되는 이미지까지 10분 서명 URL이라 **CDN 캐시가 안 걸린다.** 트래픽이 늘면 S3 GET 비용·지연이 드러남. 그 시점에 공개 클래스 + CloudFront를 분리 |
| D12 presigned PUT | 채택 | 크기 상한이 서명에 박히지 않으므로 인증된 관리자가 대용량을 올릴 수 있다. `/confirm` 검증 + 삭제로 담보하되, 전송 중 비용은 발생 |


---

## 작성자 귀속 (U8) — ⚠ 정정

**앞선 판단 정정**: "FK NULL + `author_name` 스냅샷이 이 스키마의 의도된 사용법"이라고 했으나, 고아 데이터에 한해서만 맞고 **정책으로는 틀렸다.**

### 왜 FK NULL이 위험한가
ESSENTIA `WithdrawalService.anonymize()`는 **FK 두 컬럼으로만** 글을 찾아 작성자명을 익명화한다.
```
forumPosts.anonymizeByMember(memberId, ANONYMOUS);
forumPosts.anonymizeByUser(userId, ANONYMOUS);
```
`author_name` 텍스트는 조회 키가 아니다. 따라서 **FK가 NULL인 글은 그 사람이 탈퇴해도 실명이 게시판에 영구히 남는다.** 마이페이지 "내 글"에도 안 잡히고, 본인이 수정·삭제할 수도 없다(소유 판정이 FK 기반).

ICAROS 멤버 27명과 ESSENTIA 회원 33명은 겹친다. 기존 ICAROS 글 4건의 작성자 2명도 모두 ESSENTIA 임원이다.
→ 실명을 `author_name`에 넣으면서 FK를 비우는 조합이 최악이다. **나중에 개인정보 문의가 들어왔을 때 원인을 찾기 어려운 종류의 부작용이다.**

### 우리 쪽 제약 (실측)
| 사실 | 확인 방법 |
|---|---|
| `posts` 컬럼은 `id`·`title`·`content_md`·`created_at`·`cover_url`·`summary` **6개뿐** | REST `select=*` |
| `author` / `author_id` / `author_name` / `user_id` / `created_by` / `member_id` **전부 부재** | 각 컬럼 select → HTTP 400 |
| 본문 20건에 작성자 서명 **0건** | 정규식 스캔 |
| ESSENTIA `forum_posts.author_name` · `author_role` 은 **둘 다 NOT NULL** | `essentia_infra` 회신 |

→ **데이터에서 작성자를 복원할 수 없다.** 귀속은 사람이 정하는 정책 결정이다.

### 선택지
| | 방식 | 탈퇴 익명화 | 본인 수정·삭제 | 비용 |
|---|---|---|---|---|
| **가** | ESSENTIA에 **ICAROS 서비스 계정**을 만들고 그 FK로 전건 귀속 | 해당 없음(서비스 계정은 탈퇴 안 함) | ICAROS CMS가 소유 | D1 서비스 토큰 작업에 자연스럽게 포함 |
| 나 | 팀이 글별 작성자를 지정 → ESSENTIA 계정 대조 후 FK 채움 | ✅ 정상 동작 | ✅ | 18~19건 수작업 + 운영 DB 대조 |
| 다 | FK NULL + `author_name = 'ICAROS'` (실명 미사용) | 해당 없음(실명이 없음) | ❌ 불가 | 없음 |

### ✅ 확정: **가 (D13)** — ICAROS 서비스 계정으로 전건 귀속
D1으로 서비스 토큰을 만들기로 이미 정했으므로 그 계정이 곧 소유자가 된다. FK가 채워져 소유 판정·수정·삭제가 일관되고, 서비스 계정이라 탈퇴 익명화 문제가 성립하지 않는다.
**절대 피할 것**: 실명을 `author_name`에 넣으면서 FK를 비우는 조합.

### 미확인
- `public.role` enum의 유효 값 — `author_role`이 NOT NULL이라 서비스 계정에 넣을 값이 필요하다. `essentia_infra`에 확인 필요.


### D14 부수 사항 — 감사 시 혼동 지점
`outsider` 역할 글이 `자유` 아닌 카테고리(= ICAROS 프로젝트)에 있는 조합은 **앱이 자연 발생시키지 않는다** — 비회원은 `자유`에만 쓸 수 있기 때문. 제약조건 위반은 아니고(`author_role`은 스냅샷이라 재검증되지 않음) 기능에도 영향이 없지만, 나중에 감사할 때 "이게 왜 여기 있지"가 될 수 있다. 원인은 이 결정이다.

**D1 착수 시 같이 정할 것**: 프로젝트 카테고리 글쓰기는 회원 전용이라, `members` 행 없는 서비스 계정이 REST API로 쓸 수 있는지는 서비스 토큰 설계에 달려 있다. 레거시 18~19건 import는 D1 이전에 DB direct로 넣으므로 `user` 행만으로 충분하다.


---

## ⚠️ 운영 마이그레이션 시 반드시 알아야 할 것

### `drizzle-kit migrate` 는 실패한 마이그레이션을 삼키고 **exit 0** 으로 끝난다

로컬 셋업 중 실제로 겪었다. `0000` 이 통째로 적용되지 않았는데 exit code 는 0, stderr 도 비어 있었다.
발견은 `pg_tables` 를 직접 세어 보고 나서였다.

**원인**: `drizzle.config.ts` 의 `migrations: { schema: 'icaros' }` 때문에 drizzle-kit 이 원장 테이블을 만들려고
**스키마를 먼저 생성**한다. 그다음 마이그레이션 본문의 `CREATE SCHEMA "icaros"` 가 충돌한다.
`CREATE SCHEMA IF NOT EXISTS` 로 멱등화해 해결했다(`drizzle/0000_*.sql` 첫 줄).

**운영 Neon 에 적용할 때의 규칙** — exit code 를 신뢰하지 마라. 적용 후 반드시 확인한다:

```sql
select count(*) from icaros.__drizzle_migrations;          -- 기대값과 대조
select count(*) from pg_tables where schemaname = 'icaros'; -- 기대값과 대조
select count(*) from pg_tables where schemaname = 'public'; -- ESSENTIA 테이블 수가 그대로인지
```

세 번째가 특히 중요하다. ESSENTIA 는 `spring.jpa.hibernate.ddl-auto: validate` 로 기동하므로
`public` 이 한 칸이라도 어긋나면 **우리 배포가 상대 API 를 죽인다.**

### 마이그레이션은 unpooled 로, `next build` 밖에서

`DATABASE_URL_UNPOOLED` 를 쓴다. PgBouncer transaction 모드에서 DDL 은 예측 불가능하다.
`drizzle-kit push` 는 **금지** — 라이브 DB 를 introspect 하므로 ESSENTIA 테이블이 시야에 들어온다.


---

## 🔴 D16 — ESSENTIA DB 가 Neon → AWS RDS 로 이관됨 (2026-08-23). 아키텍처 재검토 필요

`essentia_infra` 통보. **이미 운영 중이고 되돌릴 계획 없음.**

### 왜
Neon 무료 티어 컴퓨트 한도 소진으로 서비스가 중단됐다. 트래픽 때문이 아니다(게시글 47건, 조회수 두 자리).
원인은 클라이언트 형태의 불일치였다 — Hikari `keepalive-time: 120000` 이 2분마다 핑을 보내
Neon 의 5분 절전 타이머를 계속 리셋해 컴퓨트가 24/7 가동됐고, `max_cu = 8` 오토스케일링이 배수로 소진했다.
**상시 가동 JVM + 커넥션 풀이라는 형태가 서버리스 전제와 맞지 않았던 것**이지 Neon 자체의 문제가 아니다.

### 무효가 된 것
| | |
|---|---|
| D7 (Neon 제한 role 을 Preview 직전 생성) | RDS 이고, role 을 만들어도 네트워크가 닿지 않는다 |
| 선택지 (B) "읽기는 DB 직접" | **읽기조차 불가능** |
| pooled vs unpooled (`-pooler`) | RDS 에 그 개념이 없다 |
| Neon branch 테스트 환경 | 없다. RDS 는 스냅샷 방식 |
| P9 레거시 20건 **직접 DB insert** | 경로가 사라졌다 |

### 🔴 상대가 과소평가한 부분 — 영향은 Community 접근만이 아니다

RDS 는 퍼블릭 액세스가 꺼져 있고, 보안 그룹 인바운드(5432)가 **EC2 보안 그룹 하나만** 허용한다.
**Vercel 에서 도달 자체가 불가능하다.**

D2 에 따라 `icaros` 스키마를 그 RDS 에 두면, 거기 들어가는 것은:
`site_settings`(랜딩 카피 전부) · `page_sections` · `rockets` · `rocket_engines` · `members` ·
`media` · `admin_users` · `admin_sessions` · `auth_events` · `login_attempts` · `rocket_models` · `rocket_hotspots`

즉 **ICAROS 앱이 자기 자신의 데이터베이스에 닿을 수 없다.** Community 연동이 막히는 게 아니라
랜딩 페이지 렌더도, 관리자 로그인도 안 된다. 서비스 토큰으로 해결되는 범위가 아니다
(ESSENTIA API 는 forum 만 노출하지 우리 테이블을 노출하지 않는다).

### 선택지

| | 방식 | ICAROS 자체 데이터 | Community 데이터 | 비용·위험 |
|---|---|---|---|---|
| **가** | **ICAROS 전용 DB 를 따로 둔다** (ESSENTIA RDS 와 분리) | 직접 접속 ✅ | ESSENTIA REST API 경유 (D1 서비스 토큰) | DB 1개 추가. **`ddl-auto: validate` 위험이 구조적으로 사라진다** |
| 나 | ESSENTIA RDS 를 퍼블릭 개방 | ✅ | ✅ | 상대가 비권장. 감사 증적·전자서명이 든 DB 를 인터넷에 연다 |
| 다 | RDS Proxy | ✅ | ✅ | 추가 과금. 여전히 VPC 안이라 Vercel 에서 못 닿는 건 동일 |
| 라 | bastion 경유 | ✅ | ✅ | 서버리스에서 요청마다 SSH 터널은 성립하지 않는다 |

**권장: 가.** (`essentia_infra` 동의함 — 특히 근거 2번을 결정적이라고 평가)
- ICAROS 는 Vercel 서버리스라 절전이 정상 작동하는 형태다. 원인 중 하나였던 24/7 가동은 해당하지 않는다.

  > ⚠️ **내 근거 1번을 정정한다.** "서버리스라 그 실패 모드가 아니다"는 절반만 맞다.
  > `essentia_infra` 확인: 한도를 실제로 태운 것은 절전 실패가 아니라 **`autoscaling_limit_max_cu = 8`**
  > (최소 0.25의 32배)이었다. 24/7 가동만으로는 한도(약 191.9 CU-시간)에 아슬아슬하게 들어갔다.
  > **오토스케일링 상한은 서버리스 클라이언트에도 그대로 적용된다.** 아래 가드레일 없이 새 프로젝트를 만들면 같은 일이 난다.
- D2 의 존재 이유였던 `ddl-auto: validate` 위험이 **DB 가 분리되면 아예 성립하지 않는다.**
  두 저장소가 한 DB 를 공유하던 구조적 위험이 사라진다.
- Community 는 어차피 D1(서비스 토큰) 경유가 확정이므로, DB 를 나눠도 잃는 것이 없다.
- 대가: DB 2개 운영. ICAROS 규모(카피 26행·로켓 4·멤버 27)에서는 무료 티어로 충분하다.

**사용자 결정 사항** — 인프라 프로비저닝과 비용이 걸려 있어 내가 정할 수 없다.

### 바뀌지 않은 것
- 스키마·데이터 100% 동일(40테이블 행수 + md5 대조 확인), PostgreSQL 17.11
- Flyway 가 여전히 `public` 단독 소유자, V18 적용, `ddl-auto: validate` 유지
- ICAROS 게시판은 여전히 `projects` 행으로 존재, 기존 글 4건 그대로
- **S3·AWS 관련(D3·D4·D5·D6·D12·D15) 전부 유효** — 버킷·프리픽스·CORS·IAM 논의는 영향 없음
- 로컬 개발(docker postgres:17)은 영향 없음 → **Gate 4·5 작업은 계속 진행 가능**
- 리전 싱가포르 → 서울, API 응답 414ms → 45ms

### 즉시 지켜야 할 것
- **Neon 프로젝트에 붙어서 개발하지 마라.** 롤백용으로 며칠 유지되지만 쓰기를 받지 않아 데이터가 갈린다.
- P9 import 는 API 경유이거나 **EC2 안에서 사람이 실행하는 일회성 작업**이 된다.


### D16 부록 — 새 Neon 프로젝트를 만든다면 반드시 지킬 것

`essentia_infra` 가 사고 후 정리해 준 것. 5건 전부 우리에게도 적용된다.

| # | 규칙 | 이유 |
|---|---|---|
| 1 | **`autoscaling_limit_max_cu` 를 min 0.25 / max 1 로 고정** | ESSENTIA 는 max 8(32배)이었다. **한도를 실제로 태운 진짜 원인이 이것이다.** 기본값을 그대로 두면 부하 스파이크마다 CU-시간이 배수로 나간다 |
| 2 | **런타임은 pooled(`-pooler`), 마이그레이션만 직결** | Vercel 함수는 인스턴스마다 커넥션이 늘어난다. 반대로 PgBouncer transaction 모드에서 DDL 은 깨진다 |
| 3 | **절전을 막는 것을 앱에 넣지 마라** | 헬스체크 크론·상시 커넥션 풀·keepalive 핑. ESSENTIA 를 죽인 게 정확히 이것(Hikari `keepalive-time: 120000`) |
| 4 | **프리뷰 브랜치를 방치하지 마라** | 브랜치마다 자기 컴퓨트가 붙고 각각 CU-시간을 쓴다. 쓰고 지운다 |
| 5 | **`quota_reset_at` 과 CU 그래프를 주기적으로 본다** | ESSENTIA 는 한도가 다 탈 때까지 아무도 보지 않았고 사이트가 죽고 나서 알았다 |

- **ESSENTIA 의 기존 Neon 프로젝트를 재사용하지 않는다.** 롤백 창 종료 후 해지 예정이고 한도도 소진됐다.
- 대안: Supabase 무료 티어(서울 리전 있음, 컴퓨트 시간 대신 "1주 무활동 시 일시정지" 제약 — 실사용이 있으면 발생하지 않는다).
  단 리뉴얼의 전제가 "Supabase 를 런타임에서 완전히 제거"이므로 채택 시 그 요구사항과의 충돌을 명시해야 한다.
- **Vercel Secure Compute(VPC 연결)** 는 기술적으로 존재하나 Enterprise 요금제다. 학생단체 예산에서 검토 대상이 아니다.
- `essentia_infra` 확인: **RDS 에 `icaros` 스키마를 만들지 않았고, 결정 전까지 만들지 않는다.**


---

## D17 — ICAROS 데이터는 **ESSENTIA RDS 에 둔다.** 바꾸는 것은 접근 경로다

사용자 결정(2026-08-23): "RDS 에 둬야지 다른 걸 변경해."
→ D16 의 "가(전용 DB 분리)" 권고는 **채택되지 않았다.** `icaros` 스키마는 예정대로 그 RDS 에 만든다.
D2(별도 `icaros` 스키마)도 그대로 유효하며, `ddl-auto: validate` 회피 장치로서 **오히려 더 중요해졌다** —
같은 인스턴스를 쓰는 이상 그 결합이 남기 때문이다.

### 바꿔야 하는 것 — 네트워크 도달성

현재: RDS 퍼블릭 액세스 OFF, 인바운드 5432 는 EC2 보안 그룹 하나만 허용. Vercel 에서 도달 불가.

| | 방식 | 판단 |
|---|---|---|
| **가** | **퍼블릭 액세스 ON + SSL 강제 + `icaros` 스키마 전용 최소권한 role** | **권장.** 아래 참조 |
| 나 | EC2 안에 ICAROS 데이터 API 를 띄우고 Vercel 이 그걸 호출 | 서비스가 하나 더 늘고, 우리가 그걸 운영해야 한다. Community 용 D1 과 별개의 두 번째 API |
| 다 | RDS Proxy | 여전히 VPC 안이다. **문제를 풀지 못한다** |
| 라 | ICAROS 를 Vercel 이 아니라 같은 VPC 안(EC2/컨테이너)에 배포 | 요구사항의 "독립 Vercel 프로젝트" 전제를 깬다 |

### 가안의 구체 형태

노출 위험의 실체는 "감사 증적·전자서명·탈퇴 스냅샷이 든 DB 를 인터넷에 연다"였다.
그 위험을 **권한으로 봉인**하는 것이 이 안의 요지다.

1. `rds.force_ssl = 1` — 평문 접속 거부
2. ICAROS 전용 role 을 만들고 **`public` 스키마에 대한 grant 를 하나도 주지 않는다**
   ```sql
   revoke all on schema public from icaros_app;
   grant usage on schema icaros to icaros_app;
   grant select, insert, update, delete on all tables in schema icaros to icaros_app;
   alter default privileges in schema icaros grant ... to icaros_app;
   ```
   → 그 자격증명이 유출돼도 `forum_*`·`user`·`audit` 계열에 **닿지 않는다.** DDL 권한도 없다
   (마이그레이션은 별도 role 로, 배포 파이프라인에서만).
3. 보안 그룹: Vercel 은 Enterprise(Secure Compute) 가 아니면 고정 egress IP 가 없다.
   → 5432 를 CIDR 로 좁힐 수 없으므로 **인증·권한·SSL 이 유일한 방어선**이 된다. 이 점을 명시적으로 받아들인다.
4. 강한 무작위 비밀번호 + 주기적 로테이션. 가능하면 IAM DB 인증 검토.

**남는 잔여 위험**: DB 인스턴스의 인증 표면이 인터넷에 노출된다. 무차별 대입·0-day 대상이 된다.
`icaros_app` role 이 뚫려도 ICAROS 데이터까지가 한계지만, 인스턴스 자체에 대한 공격 표면은 늘어난다.
**사용자가 이 트레이드오프를 알고 선택한 것으로 기록한다.**

### 실행 순서 (전부 사용자·`essentia_infra` 영역)
1. RDS 퍼블릭 액세스 ON + `rds.force_ssl`
2. `icaros` 스키마 생성 + `icaros_app` role (위 grant)
3. 마이그레이션 전용 role 분리
4. 접속 문자열 전달 → 내가 마이그레이션 적용 후 Preview 배포

**밤샘 작업은 이것과 무관하게 로컬 postgres:17 로 계속 진행한다.**

---

## D18 — 디스플레이 폰트를 오픈소스로 교체

`WidescreenUEx_Trial_*` 는 라이선스 확인 없이 배포할 수 없고(파일명이 Trial), 9파일 ~900KB 미서브셋 TTF 다.
→ 동등한 wide grotesque 오픈소스로 교체하고 woff2 서브셋. D10 종결.

## D19 — 3D: 변환 도구 설치 승인. 단 로켓에 붙이지 않는다

`icx-2.fbx` → GLB 변환과 3D 인프라는 만들되, **홈 히어로에만** 쓴다.
`icx2`(ICX-II) 로켓 행을 되살리는 것은 팀 판단이 필요해 하지 않는다 — `rocket_models.rocket_id` 는 null 로 둔다.


### D17 보정 — `essentia_infra` 기술 검토 (2026-08-23). 내 제안에 구멍이 있었다

#### 이미 충족돼 있던 것
- **`rds.force_ssl = 1` 이 이미 켜져 있다.** PG16+ 부터 RDS 기본 파라미터 그룹의 기본값이다.
  커스텀 파라미터 그룹도 재부팅도 불필요(`ApplyType: dynamic`). CA 는 `rds-ca-rsa2048-g1`.
- **DNS 는 split-horizon** — 퍼블릭 전환 후에도 VPC 내부 조회는 사설 IP 를 받는다. EC2 앱 설정 변경 불필요.
  단 `PubliclyAccessible` 수정 자체가 **짧은 연결 중단**을 유발할 수 있다. 트래픽 적은 시간에.

#### 내가 빠뜨린 것
| # | 항목 | 결과 |
|---|---|---|
| ① | `ALTER DEFAULT PRIVILEGES` 누락 | `grant ... on all tables` 는 **그 시점 테이블만** 덮는다. 다음 마이그레이션이 만든 테이블에 앱이 접근 못 해 **배포마다 깨진다.** `for role <마이그레이션_role>` 을 반드시 명시 — 빠뜨리면 실행한 사람 기준이 되어 파이프라인 산출물에 안 걸린다 |
| ② | 시퀀스 권한 누락 | serial/identity 컬럼이 하나라도 있으면 **INSERT 가 거부된다.** `grant usage, select on all sequences` + default privileges |
| ③ | `revoke ... from icaros_app` 이 `PUBLIC` 상속을 못 지운다 | `public` 스키마는 의사 role `PUBLIC` 에 USAGE 를 준다. `revoke ... from PUBLIC` 은 ESSENTIA 까지 영향을 줘 함부로 못 한다.<br>**내 표현을 정정한다** — "`forum_*`·`audit` 계열에 닿지 않는다"는 **데이터 기준으로는 맞고 메타데이터 기준으로는 틀리다.** `information_schema`·`pg_catalog` 를 통한 스키마 구조 열람은 막지 못한다 |
| ④ | 🔴 **마스터 계정이 같이 인터넷에 열린다** | 최소권한 설계는 `icaros_app` **자격증명이 샜을 때**를 막는다. 그런데 퍼블릭 전환은 `essentia` **마스터 로그인도 인터넷에 노출**한다. 마스터가 뚫리면 감사로그·전자서명·탈퇴 스냅샷 전부다.<br>그 비밀번호는 SSM·EC2 `/etc/essentia/api.env`·이관 셸 이력에 있다. **오늘까지는 VPC 안에서만 쓸 수 있는 값이었지만 전환 후엔 어디서나 쓸 수 있는 값이 된다.** 이것이 이번 변경의 가장 큰 델타이고 내 제안서에 없었다.<br>**최소 조치: 전환과 동시에 마스터 비밀번호 교체.** 나아가 ESSENTIA 앱도 마스터 대신 전용 제한 role 을 쓰게 하고 마스터는 운영자만 보관 |
| ⑤ | Postgres 에 로그인 시도 제한이 없다 | "인증·권한·SSL 이 유일한 방어선"이라 썼는데, 정확히는 **그 방어선에 시도 횟수 제한이 없다.** fail2ban 도 계정 잠금도 없다. 공개된 5432 는 무한 브루트포스 대상이다. 아주 긴 랜덤 비밀번호 + 연결 로깅·알람이 유일한 완화책 |

#### SSL 은 `require` 로 부족하다
`sslmode=require` 는 **암호화만 하고 서버 인증서를 검증하지 않는다**(MITM 방어 없음).
인터넷 경유가 되면 ICAROS 는 **`sslmode=verify-full` + RDS CA 번들**을 써야 한다.

#### 검토할 대안 2개
1. **RDS IAM 데이터베이스 인증** — 현재 `IAMDatabaseAuthenticationEnabled: false`, **재부팅 없이 켤 수 있다.**
   정적 비밀번호 대신 **15분 수명 토큰**. 우리는 이미 S3 용으로 Vercel OIDC 역할 수임을 채택(D5)했으므로
   **같은 자격증명 경로를 DB 에 재사용**할 수 있다. 유출돼도 15분이면 만료, IAM 정책으로 즉시 폐기(비밀번호 교체·재배포 불필요).
   ④의 "정적 비밀번호가 인터넷에 노출" 문제를 `icaros_app` 에 한해 제거한다. 마스터 문제는 별도로 남는다.
   → **권장. 퍼블릭 전환을 한다면 이것과 묶어서 한다.**
2. **Cloudflare Tunnel** (EC2 → Cloudflare, Access 서비스 토큰) — DNS 가 이미 Cloudflare 라 붙이기 쉽고
   **5432 를 인터넷에 열지 않고도** 외부에서 닿는다. 대가는 구성요소 추가 + 커넥션 지연.
   기각하더라도 평가했다는 기록은 남긴다.

#### 상태
**미승인.** `essentia_infra` 는 이 결정을 승인된 것으로 취급하지 않고 네트워크·role·파라미터 어느 것도 건드리지 않았다.
④·⑤는 사용자가 결정 시점에 알고 있어야 할 내용이라 별도로 올렸다.


---

## D20 — DB 접근은 **B안 확정**: RDS 퍼블릭 + IAM 데이터베이스 인증

사용자 결정(2026-08-24). 선택지가 셋으로 좁혀진 뒤의 재확인이다 —
`essentia_infra` 가 **Cloudflare Tunnel(C)이 이 용도에 성립하지 않음**을 정정했다:
raw TCP(Postgres)를 터널로 쓰려면 클라이언트에서 `cloudflared access tcp` 프록시를 띄워야 하는데
**Vercel 함수 안에서는 바이너리를 실행할 수 없다.** HTTP 는 되지만 Postgres 프로토콜은 안 된다
(TCP 를 공개 호스트명으로 직접 받는 Spectrum 은 Enterprise 전용).

기각된 대안: ②(ICAROS 전용 무료 DB — 노출 0, 인프라 작업 0) · ⑤(D1 완성까지 배포 보류).
세 안 모두 비용은 $0 이었고, **사용자가 노출을 감수하고 단일 DB 를 택했다.**

### 실행 (전부 $0)
| # | 항목 | 시점 |
|---|---|---|
| 1 | RDS `PubliclyAccessible` → true | 사용자 명시 승인 후 |
| 2 | `essentia-db-sg` 5432 인바운드 `0.0.0.0/0` | 사용자 명시 승인 후 |
| 3 | `IAMDatabaseAuthenticationEnabled` → true (재부팅 불필요) | 승인 후 밤에 가능 |
| 4 | `icaros` 스키마 + `icaros_migrator` + `icaros_app`(`rds_iam` 상속, 비밀번호 없음) | 승인 후 밤에 가능 |
| 5 | 🔴 **마스터 비밀번호 교체** | **B 와 무관하게 필수** — 오늘 이관 과정에서 셸 이력에 남았다 |
| 6 | 클라이언트 `sslmode=verify-full` + RDS CA(`rds-ca-rsa2048-g1`) | ICAROS 작업 |

`grant` 에 반드시 포함: `ALTER DEFAULT PRIVILEGES FOR ROLE icaros_migrator IN SCHEMA icaros`,
시퀀스 권한(현재 불필요하나 미래 대비). `icaros_app` 은 DDL 권한 없음, `public` 에 grant 없음.

**받아들인 잔여 위험**: 5432 인증 표면이 인터넷에 노출된다. Postgres 에는 로그인 시도 제한이 없다
(fail2ban 도 계정 잠금도 없음). IAM 인증으로 `icaros_app` 의 정적 비밀번호는 제거되지만
마스터 계정 로그인은 여전히 인터넷에서 도달 가능하다.

## D21 — D1 서비스 계정은 `members` 행 없이 회원 판정을 우회한다

사용자 결정(2026-08-24). **(a) 명단 노출 · (b) 숨김 플래그 추가를 제치고 (c) 를 선택.**

> ⚠️ **나와 `essentia_infra` 둘 다 (c) 를 비권장했다.** 권한 모델에 예외를 뚫는 것이고,
> 예외가 하나 생기면 나중에 그 예외를 기준으로 또 뚫리기 때문이다. 사용자가 알고 선택했다.

### 그래서 예외를 최대한 좁게 못박는다 — 구현 조건
1. 우회는 **`isMember()` 판정 하나에만** 적용한다. `isPresident()`·`isOfficer()` 등 다른 술어에는 절대 적용하지 않는다.
2. **`/api/forum/**` 경로에서만** 유효하다. `/api/admin/**` 에는 어떤 경우에도 통하지 않는다.
3. 서비스 토큰으로 들어온 요청은 **ICAROS 프로젝트 카테고리에만** 쓸 수 있다. 다른 카테고리는 거부.
4. `author_role` 은 `outsider` (D14 유지). `author_name` 은 사람 이름이 아니라 팀/봇 표기.
5. **네거티브 테스트가 필수다** — 서비스 토큰이 관리자 경로·타 카테고리·임원 전용 게시판에서
   거부되는 것을 명시적으로 검증한다. 통과 테스트만 있으면 이 예외는 검증된 게 아니다.
6. 감사로그에 서비스 토큰 사용이 사람 계정과 **구별되게** 남아야 한다.
7. **서비스 토큰에도 레이트리밋을 건다** (예: 시간당 N건). 무제한 예외는 사고가 났을 때 폭주한다.

### 🔴 (c) 를 택한 진짜 이유 — 나중에 "왜 예외를 뚫었나"에 답하기 위해 남긴다
비회원은 `자유` 카테고리에 **24시간 3건** 제한이 걸린다.
레거시 18~19건을 비회원 신원으로 넣으면 **일주일이 걸린다.**
(a)·(b) 를 제치고 (c) 를 택한 실질적 동인은 "명단 오염 회피"가 아니라 **이 레이트리밋**이다.
(`essentia_infra` 가 지적. 이 근거가 문서에 없으면 나중에 감사할 때 예외의 정당성을 설명할 수 없다.)

### 작성자 FK 는 양쪽 다 NULL — 의도된 것이다
`members` 행도 `user` 행도 만들지 않으므로 `author_member_id` · `author_user_id` 가 **모두 NULL** 이고
`author_name` 텍스트 스냅샷만 남는다.
앞서 경고했던 "탈퇴 익명화가 FK 로만 걸려 실명이 영구히 남는다"(U7 논의)는 **봇 계정에는 해당하지 않는다** —
익명화할 사람이 없기 때문이다. 일관된다.
다만 나중에 감사할 때 "FK 없는 글"로 눈에 띄므로 원인이 이 결정임을 여기 남긴다.

`members` 행을 만들지 않으므로 공개 명단·회원 수·회원코드는 오염되지 않는다(그것이 이 선택의 이득이다).

## D22 — ICAROS → ESSENTIA API 호출은 **서버 사이드 전용**

선택의 여지가 없다. 서비스 토큰이 브라우저에 노출되면 안 된다.
→ Next.js route handler / Server Action 에서만 호출한다. 클라이언트 컴포넌트에서 직접 호출 금지.
→ 따라서 **`essentia.cors.allowed-origins` 에 Vercel 오리진을 추가할 필요가 없다.**


### D20 실행 결과 (2026-08-24) + 🔴 `rds_iam` 상속 사고

`essentia_infra` 가 3·4·5 완료. **1·2(퍼블릭 전환 + SG 개방)는 세션 권한에 막혀 미실행** — 그때까지 Vercel 에서 못 닿는다.

| 항목 | 값 |
|---|---|
| host | `<rds-host>` |
| port / dbname / schema | `5432` / `essentia` / `icaros` |
| 런타임 role | `icaros_app` (DDL 권한 없음, `public` 직접권한 0건) |
| 마이그레이션 role | `icaros_migrator` (스키마 소유자) |
| 기본권한 | `FOR ROLE icaros_migrator` 기준 TABLES·SEQUENCES 둘 다 등록 |
| CA | `rds-ca-rsa2048-g1` · `sslmode=verify-full` |
| 인증 | **비밀번호 없음.** IAM 토큰 15분 |

Vercel OIDC 역할에 `rds-db:connect` 필요:
```
arn:aws:rds-db:ap-northeast-2:<account>:dbuser:<rds-resource-id>/icaros_app
```
마지막 세그먼트가 role 이름이다. `icaros_app` 과 `icaros_migrator` 를 **각각 따로** 허용하고,
마이그레이션 role 은 배포 파이프라인 역할에만 준다. 런타임 역할에 주지 않는다.

#### 🔴 사고 — `rds_iam` 을 상속시키면 그 계정은 비밀번호로 못 붙는다

스키마 생성 SQL 이 `ALTER DEFAULT PRIVILEGES FOR ROLE` 을 쓰려고 `GRANT icaros_migrator TO CURRENT_USER` 를 했는데,
`icaros_migrator` 가 `rds_iam` 을 갖고 있어 **마스터가 그걸 상속받았고 그 순간 마스터의 비밀번호 인증이 차단**됐다
(`FATAL: PAM authentication failed`). **ESSENTIA API 가 약 10분간 죽었다.**

복구: EC2 역할에 `rds-db:connect` 임시 부여 → IAM 토큰으로 접속 → `REVOKE icaros_migrator FROM essentia` → 임시 권한 회수.

**우리에게도 그대로 적용된다.** `rds_iam` 을 가진 role 을 사람·앱 계정에 상속시키지 않는다.
불가피하면 **부여 → 설정 → 같은 트랜잭션에서 즉시 회수**한다.


---

## D23 — `/posts` 는 ESSENTIA Community 를 **읽기로 즉시 연동**했다 (2026-08-24)

D1(서비스 토큰) 대기 중이라 `/posts` 를 준비중 페이지로 두고 있었는데, **읽기에는 토큰이 필요 없다.**
`essentia_infra` 가 ICAROS 카테고리를 확인할 때 쓴 것이 인증 불필요한 공개 엔드포인트였다.

| | |
|---|---|
| API base | `https://api.essentia-sci.org` (`ESSENTIA_API_BASE`) |
| 목록 | `GET /api/forum/posts?category=ICAROS&page=N&size=M` → `data.posts.{items,page,size,total,totalPages}` |
| 상세 | `GET /api/forum/posts/{id}` → **`data.post`** (한 겹 더 감싸임. `data` 에는 comments·canComment·signedIn 도 있다) |
| 본문 | plain Markdown. 이미지는 `/api/forum/image/{name}` **상대 경로** — API 호스트 기준이라 절대 URL 로 치환해야 한다 |
| 현재 | ICAROS 4건 |

### 설계
- **복제하지 않는다.** 우리 DB 에 저장하지 않으므로 양쪽이 갈라질 수 없다. 동기화 코드가 없으니 동기화 버그도 없다.
- `force-dynamic` + `cache: 'no-store'` — "ESSENTIA 에서 쓰면 여기 즉시 보인다"가 요구사항이다.
- **`projectId` 로 한 번 더 거른다.** 카테고리 이름으로 물었지만 그건 텍스트라 겹치거나 바뀔 수 있다.
  목록·상세 양쪽에서 `2cb1ee87-…` 를 대조한다.
- 호출은 **서버 사이드에서만** (D22). 지금은 토큰이 없지만 붙을 자리를 미리 그렇게 잡아 둔다.
- `skipHtml` — 상류 본문은 우리가 통제하지 않는다. 원시 HTML 을 렌더하지 않는다.

### 상류 실패를 세 갈래로 나눈다
| 상황 | 우리 응답 | 이유 |
|---|---|---|
| 상류 404 | **404** | 그 글은 없다 |
| 타임아웃·5xx | **200 + "지금 불러올 수 없습니다"** | 글은 있을 수 있다. 404 로 만들면 색인에서 사라진다 |
| 200 인데 모양이 다름 | **404** | 상류 계약이 바뀐 것 |

첫 구현에서 이 셋을 뭉뚱그려 **실제 글이 404, 없는 id 가 200** 으로 뒤집혀 있었다.

### 남은 것 — 쓰기
CMS 에서 글을 쓰는 것은 여전히 **D1 서비스 토큰**이 필요하다.
지금은 상세 하단에서 ESSENTIA 커뮤니티로 링크한다.
