# 05 — Database Plan (Neon)

> 근거: `essentia_infra` 회신 1/2 (2026-08-23). AWS·S3 회신 2/2 대기 중.
> 상태: **전 항목 확정** (`DECISIONS.md` D1·D2·D7·D11). 남은 것은 중복 판정(U7)과 FK 확인(U8).

---

## 0. 마스터 프롬프트 전제 정정

| 프롬프트 전제 | 실제 |
|---|---|
| "ESSENTIA Neon의 Drizzle 스키마" | **Drizzle 없음.** 2026-08-03 Next 풀스택 → 정적 프론트 + **Spring Boot** 전환 시 Drizzle 43파일 삭제. 스키마 소유자는 **Flyway** 단독 |
| "ESSENTIA AWS 인프라만 사용" | **Neon은 AWS가 아님.** 별도 SaaS 계정 → Neon 콘솔 접근이 따로 필요 |
| "Landing 22개 key" | **18개** (`01-current-state.md` §5) |
| "ICAROS 게시판" | `forum_categories`에 **ICAROS 행 없음**. 5개 시드(`공지`·`자유`·`연구`·`질문`·`후기`)뿐 |

---

## 1. 상대편 구조 (읽기 전용 사실)

**도구**: Flyway (`spring-boot-starter-flyway`). `V1__baseline.sql` ~ `V18__vote_anonymous.sql`.
이력은 `flyway_schema_history` 테이블. 기동 시 자동 migrate.

**🔴 `spring.jpa.hibernate.ddl-auto: validate`** — Hibernate가 기동 시 스키마를 검증한다.
`public`에 예상 밖 변경이 생기면 **ESSENTIA API가 기동에 실패**할 수 있다. 이것이 이 계획의 최상위 제약이다.

### `forum_*` (3 테이블, `public`, snake_case)
```
forum_categories  id uuid PK · name text UNIQUE · sort_order
                  · outsider_writable · officer_only · active
forum_posts       id uuid PK
                  · category text NOT NULL      ← FK 아님. 카테고리 "이름 텍스트"
                  · title · content(Markdown)
                  · author_user_id  text  → public."user"(id)   ON DELETE SET NULL
                  · author_member_id uuid → public.members(id)  ON DELETE SET NULL
                  · author_name text NOT NULL   ← 스냅샷
                  · author_role public.role NOT NULL ← enum 스냅샷
                  · views · pinned · deleted · deleted_at
                  · project_id uuid → public.projects(id) ON DELETE SET NULL
forum_comments    post_id → forum_posts CASCADE · parent_comment_id → self CASCADE (1-depth)
```

- **첨부파일 테이블 없음.** 이미지는 본문 마크다운의 `/api/forum/image/{name}` 참조뿐. 실물은 S3.
  → 참조 무결성도 orphan 정리도 없다. **우리가 겪은 고아 3건과 동일한 구조적 결함이 저쪽에도 있다.**
- **본문 = plain Markdown.** GFM + LaTeX(`remark-math` + `rehype-katex`). Tiptap JSON도 HTML도 아니다.
  → 우리 `content_md`도 Markdown이므로 **포맷 변환 불필요.** 다만 이미지 URL 스킴은 다르다.
- **soft delete 전용.** `deleted` + `deleted_at`. 물리 삭제 없음.
- **작성자**: FK 2개 모두 `ON DELETE SET NULL`, 대신 `author_name`·`author_role` 텍스트 스냅샷 보존.
  → **ICAROS 레거시 20건에는 대응 `user`/`members` 행이 없다.** 스냅샷 컬럼만 채우고 FK는 NULL로 두는 것이 이 스키마의 의도된 사용법이다. (좋은 소식 — 억지로 계정을 만들 필요가 없다.)

### `public` 예외 — 인용 필수
Auth.js가 만들어 그대로 물려받은 `public."user"` · `public.account` · `public.session` · `public."verificationToken"` 과 camelCase 컬럼(`emailVerified`, `providerAccountId`). **큰따옴표 인용 없이 조회하면 깨진다** (전례 있음).
→ 우리 세션 테이블 이름이 `public.session`과 충돌할 뻔했다. `icaros` 스키마로 가면 자동 해소.

---

## 2. 소유권 규칙 (확정)

| 대상 | 소유자 | ICAROS의 권한 |
|---|---|---|
| `public` 스키마 전체 (`forum_*` 포함) | **ESSENTIA Flyway 단독** | DDL 금지. `ALTER`·`CREATE INDEX`도 금지 |
| `icaros` 스키마 | **ICAROS** | 전권 |
| Flyway 버전 번호 | ESSENTIA | ICAROS가 `V19__`를 만들지 않는다 |
| `forum_*` 변경 필요 시 | — | ESSENTIA BE 레포에 PR로 `V19__….sql` 제출. 경로는 이것 하나 |

ICAROS 측 도구 설정:
```ts
// drizzle.config.ts
schemaFilter: ['icaros'],
migrations: { schema: 'icaros', table: '__drizzle_migrations' },
// 연결 시 search_path=icaros 고정
```
`drizzle-kit push` **금지**. `generate` + `migrate`만. (`04-architecture.md` 참조 — Flyway가 상대라 도구 충돌 위험은 사라졌지만, `push`가 라이브 DB를 introspect한다는 사실은 그대로다.)

---

## 3. `icaros` 스키마 — 우리가 소유할 테이블

ESSENTIA와 무관한 데이터 전부. `forum_*`는 여기 오지 않는다.

| 테이블 | 출처 | 행 |
|---|---|---|
| `icaros.site_settings` | `site_content` | 18 |
| `icaros.page_sections` | 신규 (섹션 활성화·순서) | — |
| `icaros.rockets` | `rockets` | 4 |
| `icaros.rocket_engines` | `rockets.engines` jsonb 정규화 | 6 |
| `icaros.rocket_models` | 신규 (GLB·포스터·Scene JSON) | — |
| `icaros.rocket_hotspots` | 신규 | — |
| `icaros.members` | `members` | 27 |
| `icaros.media` | 신규 (S3 메타데이터) | — |
| `icaros.admin_users` / `admin_sessions` / `auth_events` / `login_attempts` | 신규 | `06-auth-security-plan.md` |
| `icaros.storage_cleanup_jobs` | 신규 (필요 시) | — |

이전 시 교정할 것 (`08-migration-plan.md`):
- `members.sort_order` 재부여 — 현재 값 5에 3중 충돌, 14·24 결번. **글로벌 unique 인덱스를 걸면 import가 거부된다.**
- `rockets.sort_order`는 `(series, sort_order)` 복합 unique로.
- `posts.summary`는 복사 금지·재계산 (20건 중 13건이 낡음).

---

## 4. 🔴 Posts 연동 — 마스터 프롬프트 요구가 현재 충족 불가

### 요구사항
> "ESSENTIA Community의 ICAROS 게시판과 `/posts`를 단일 데이터 원본으로 연동"
> "CMS Posts 탭도 같은 Community row를 CRUD"
> "ESSENTIA와 ICAROS 양쪽 수정 즉시 반영"

### 막힌 지점
ESSENTIA에는 `POST/PATCH/DELETE /api/forum/posts`, 댓글, `POST /api/forum/images/presign`+`/confirm`이 이미 있다.
**그러나 인증이 JWT HttpOnly 사용자 세션 전용이고, 서비스 간 인증(API key / service token)이 구현되어 있지 않다.**
ICAROS가 자체 Argon2id 인증을 쓰면 ESSENTIA 세션이 없어 **API를 호출할 수단이 없다.**

### 선택지

| | 방식 | 요구 충족 | 비용 | 위험 |
|---|---|---|---|---|
| **A** | ESSENTIA BE에 **서비스 토큰** 신설 → ICAROS가 REST API 호출 | ✅ 완전 충족 | ESSENTIA BE 레포 작업 필요 (이 레포 범위 밖) | 낮음 — 모든 규칙이 한 곳에 유지 |
| **B** | 읽기는 DB 직접, **쓰기는 ESSENTIA 커뮤니티로 링크** | ❌ CMS Posts 탭 CRUD 불가 | 없음 | 없음 — **지금 당장 안전하게 가능한 유일한 방식** |
| **C** | DB 직접 write | ⚠ 형식상 충족 | 6개 규칙 재구현 | **높음** — 같은 규칙이 두 곳에 생기면 반드시 어긋난다 |

**(C)가 우회하게 되는 것** (직접 write 시 전부 무력화):
카테고리 권한 판정(`officer_only`/`outsider_writable`/`active`) · 비회원 3건/24h 레이트리밋 · `author_role` 스냅샷 · 이미지 MIME 검증·SVG 차단 · **감사 로그** · soft delete 규칙.

**권장: A.** 단, ESSENTIA BE 레포 작업이므로 **이 리뉴얼의 범위를 넘는다.** 사용자 결정 사항.
A가 불가하면 **B로 가고 요구사항을 명시적으로 축소**하는 것이 C보다 낫다.

### 부수 사실
- ✅ **ICAROS 게시판은 이미 존재한다.** `projects`에 ICAROS 행(`2cb1ee87-9a24-4ea8-b38c-6c9d30eea042`)이 있고 카테고리로 동적 부착 중. `forum_categories`에는 여전히 고정 5개뿐이지만 **아무것도 만들 필요가 없다.**
  (`essentia_infra`의 초기 "projects 0건"은 2026-08-05 이관 문서 기준이었고, 운영은 그 뒤 움직였다. 공개 프로젝트 3개: ESSENTIA WebOps · Obvium Nihil · ICAROS)
- ✅ **ICAROS 카테고리에 기존 글 4건 존재** (2026-08-08 / 07-19 / 07-17 / 06-18, 작성자 2명 모두 officer, 댓글 0).
  전환일(2026-08-05) 이전 3건은 구 게시판 ETL 산물. **우리 20건과 최소 1건 확정 중복, 1건 판단 필요** → `DECISIONS.md` 중복 판정표(U7).
- ⚠ `author_user_id`/`author_member_id` FK가 채워져 있는지는 **미확인** — 공개 API가 FK를 노출하지 않는다. ETL이 매핑하도록 작성됐고 레거시 `user` 56행이 이관됐으므로 채워져 있을 가능성이 높으나 **추정이다** (U8).

---

## 5. 연결

| | ESSENTIA (Spring Boot) | ICAROS (Vercel Node) |
|---|---|---|
| 엔드포인트 | **직결** (`-pooler` 없음) — PgBouncer transaction 모드가 Hibernate prepared statement와 충돌 | **pooled** (`-pooler`) — 서버리스는 커넥션이 폭증 |
| `channel_binding` | JDBC 미지원으로 제외 | `require` 사용 가능 |

두 앱이 서로 다른 엔드포인트를 쓰는 것은 정상이며 충돌하지 않는다.
마이그레이션(`drizzle-kit migrate`)은 **unpooled**로, `next build` 밖의 게이트된 단계에서 실행한다.

---

## 6. 개발·테스트 환경

- **Neon branch: 미확인** (Neon 콘솔 접근 필요)
- ESSENTIA 로컬: `compose.yaml`의 **postgres:17-alpine, 호스트 포트 5434**, `dev.sh` 하나로 DB+API+웹 기동
- ESSENTIA 테스트: JUnit **Testcontainers PostgreSQL 17**, E2E는 전용 DB 볼륨 + 전용 S3 버킷(운영 버킷과 같으면 실행 전 중단)
- → ICAROS도 **로컬 Postgres 17**에서 `icaros` 스키마를 만들어 개발하면 Neon 콘솔 없이도 Gate 4까지 진행 가능

---

## 7. 사용자 결정 4건

| # | 결정 | 권장 | 영향 |
|---|---|---|---|
| 1 | ~~Posts 연동 방식~~ | ✅ **A 확정** — ESSENTIA BE 서비스 토큰 신설. 착수 시점은 이 레포 범위 밖 | D1 |
| 2 | ICAROS를 `projects` 행 vs `forum_categories` 행 | ⏸ **보류** — 운영 DB에 `category='ICAROS'` 과거 글이 있을 수 있어 건수 확인 후 결정 (중복 import 위험) | D11 |
| 3 | ~~스키마 위치~~ | ✅ **`icaros` 전용 스키마 확정** | D2 |
| 4 | ~~Neon 콘솔 접근~~ | ✅ **Gate 4까지 로컬 postgres:17. Neon은 Preview 직전 연결** | D7 |

## 8. 미해결

- 운영 DB의 `forum_posts where category='ICAROS'` 건수 — **이전 전 필수 확인**
- `citext` 확장 가용 여부
- Neon branch 존재 여부
- S3 관련 전부 → `essentia_infra` 회신 2/2 대기
