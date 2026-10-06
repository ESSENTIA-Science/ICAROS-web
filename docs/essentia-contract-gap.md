# ICAROS ↔ ESSENTIA 게시글 연동 현황

ESSENTIA 서비스 API와 HTTP 오류 처리 수정은 `main`·`prod`에 병합하여 운영 배포했다. ICAROS CMS는 `ICAROS-api/src/essentia/posts.ts`를 통해서만 ESSENTIA 게시글을 읽고 쓴다. `icaros` 스키마에 신규 게시글 사본을 만들지 않는다. 로컬 ESSENTIA API가 8081에서 실행 중이고 `docs/.local/essentia-service-token`이 있으면 기본 `./dev.sh`가 연결한다. 운영 연결 설정과 로컬 기본 대상 선택을 적용했다. 실행 중인 로컬 서버에는 사용자가 재시작한 뒤 반영된다.

## 공통 저장 계약

- ESSENTIA `public.icaros_service_posts`가 초안의 단일 원본이다. 초안 필드는 `category`, `title`, `content`, `displayDate`, `attachments[{mediaId,kind,title}]`이다. `kind`는 `image|pdf|video`, 첨부는 최대 20개다.
- ICAROS CMS의 `bodyMd`는 API 어댑터에서 ESSENTIA의 `content`로 변환한다. `authorLabel`은 서버 설정의 표시값이다. CMS에서 별도 작성자·게시글 원본을 저장하지 않는다.
- 저장은 ESSENTIA의 버전 조건과 생성 idempotency key를 사용한다. 게시하면 ESSENTIA의 `forum_posts` 한 행으로 승격하고, `forumPostId`와 `publishedVersion`을 유지한다. ICAROS 정적 웹은 ESSENTIA `/snapshot`과 과거 `icaros.legacy_posts`를 합쳐 `displayDate` 내림차순으로 빌드한다.
- ESSENTIA 작업 브랜치는 기존 `SERVICE_TOKEN`, `SERVICE_TOKEN_USER_ID`, `SERVICE_TOKEN_PROJECT_ID` 설정을 사용하도록 맞췄다. 게시할 때 `forum_posts.project_id`와 `author_user_id`를 기록해야 ESSENTIA의 ICAROS 프로젝트 게시판에 나타난다.

## 로컬 검증과 첨부 연동 범위

로컬 8081 API와 로컬 PostgreSQL에서 초안 생성·수정·게시, `forum_posts`의 ICAROS `project_id`·서비스 작성자·공개 상태, ICAROS 정적 웹 빌드까지 확인했다. 검증용 글과 게시글은 로컬 DB에서 정리하고 다시 빌드했다.

운영 서비스 API·Flyway V25·V26·서비스 설정 적용 및 실제 게시판 연동 검증을 완료했다. 토큰은 서버에만 주입하며 브라우저에 전달하지 않는다.

ESSENTIA 커뮤니티 자체 화면은 `forum_posts` 본문을 읽는다. 첨부 메타데이터와 `displayDate`는 서비스 테이블에 저장되므로 커뮤니티 화면에서 PDF·영상 미리보기와 지정 날짜 표시까지 필요하면 ESSENTIA 공개 API/FE 확장이 별도로 필요하다. 이번 운영 테스트는 Markdown·날짜·빈 첨부 계약을 검증했고 실제 PDF·영상 업로드와 렌더링은 검증하지 않았다.

## 로컬 ICAROS → 운영 ESSENTIA 연결

`./dev.sh`는 환경 변수 또는 추적하지 않는 대상 선택 파일로 연결 대상을 정한다. 둘 다 없으면 로컬 모드다. 명시적으로 `ICAROS_ESSENTIA_TARGET=production`을 설정하면 서버·컨테이너 시작 전에 `docs/.local/essentia-production.env`를 읽고 필수 설정을 검증한다. 운영 모드에서는 로컬 8081 자동 연결과 로컬 토큰 주입을 건너뛰며, 설정 누락·오류가 있어도 로컬로 전환하지 않는다.

설정 파일은 Git에서 제외된 `docs/.local/`에 두고 본인 소유의 일반 파일에 `chmod 600`을 적용한다. 신뢰하는 shell 변수 할당만 넣는다. 토큰과 실제 프로젝트 이름은 문서·커밋·터미널 출력에 남기지 않는다.

```bash
# docs/.local/essentia-production.env 형식 (실제 값은 이 파일에만 보관)
ESSENTIA_SERVICE_ORIGIN='https://api.essentia-sci.org'
ESSENTIA_SERVICE_TOKEN='<서비스 토큰>'
ESSENTIA_SERVICE_CATEGORY='<운영 ICAROS 프로젝트의 실제 title>'
ESSENTIA_AUTHOR_LABEL='<작성자 표시값>'
```

먼저 서버를 시작하지 않는 읽기 전용 검사를 실행한다.

```bash
bash scripts/essentia-production-smoke.sh
```

이 검사는 형제 `ICAROS-api`의 실제 `createEssentiaPostsAdapter`를 불러 `listDrafts()`와 `readSnapshot()`을 호출한다. `ICAROS_API_DIR`로 체크아웃 경로를 지정할 수 있으며 해당 저장소에 `tsx` 의존성이 설치되어 있어야 한다. 두 운영 GET 경로만 허용하고 15초 제한·리다이렉트 거부를 적용한다. 응답은 어댑터 계약으로 검증하며 결과에는 성공 여부와 개수만 출력한다. 글 본문·제목·작성자·토큰은 출력하지 않는다. 필수 설정 누락, 404, 인증 오류는 실패 종료하며 운영 쓰기·AWS 변경·서버 시작은 수행하지 않는다.

승인받은 운영 배포·마이그레이션과 서비스 설정 적용을 마친 뒤 연결을 활성화하는 명령은 다음과 같다.

```bash
ICAROS_ESSENTIA_TARGET=production ./dev.sh
```

승인된 운영 연동 대상은 추적하지 않는 `docs/.local/essentia-target`에 `production`으로 저장한다. 이 파일이 있으면 `./dev.sh`도 운영 연결을 선택한다. 환경 변수 `ICAROS_ESSENTIA_TARGET=local`을 명시하면 로컬 모드로 전환할 수 있다. 기존 실행 중 프로세스에는 반영되지 않으므로 사용자가 재시작해야 한다.

**실제 쓰기 대상:** ICAROS 콘텐츠 DB와 미디어 업로드는 기존 로컬 PostgreSQL/MinIO를 사용하지만, CMS 게시글 생성·수정·게시 및 전체 게시 과정의 게시글 승격은 운영 ESSENTIA `/api/service/icaros/posts`에 쓰기를 보낸다. 공개 웹 빌드도 운영 ESSENTIA 스냅샷을 읽는다. AWS `essentia` profile은 기존 운영 미디어 읽기에 사용하며 서비스 API 인증은 별도 Bearer 토큰이다. 이번 운영 배포·마이그레이션과 실제 테스트는 사용자 승인 후 수행했다. 이후 추가 운영 변경은 해당 작업의 승인 범위를 따른다.

### 운영 적용 및 검증 결과 (2026-10-03)

- 사용자 승인 후 ESSENTIA 공식 배포 파이프라인으로 배포했고 Flyway V25·V26 성공을 확인했다. 적용 전 운영 DB dump와 컨테이너·환경 설정 복구 자료를 서버에 보관했다.
- 서비스 토큰은 AWS SSM SecureString에 저장하고 기존 서버 역할로 주입했다. 서비스 작성자와 ICAROS 프로젝트 연결 설정도 적용했다.
- 실제 ICAROS-api 어댑터로 초안 생성·조회·목록·수정, 생성 idempotency, stale version 충돌, 날짜 유지, 미게시 초안의 공개 snapshot 제외를 검증했다.
- 실제 게시·게시 재요청의 중복 방지, ESSENTIA ICAROS 프로젝트 게시판 조회, 재게시 전 공개본 유지와 재게시 후 날짜 반영을 검증했다.
- 운영 테스트에서 발견한 HTTP 오류 변환 문제를 수정했다. 인증·입력·미존재·버전 충돌은 각각 401·400·404·409로 응답한다. 수정 후 Gradle `check bootJar` 전체 452개 테스트가 통과했다.
- 생성한 공개 테스트 글은 soft-delete하고 테스트 초안 2개만 조건을 대조하여 제거했다. 정리 후 테스트 초안·공개 테스트 글은 0개이며 읽기 smoke도 통과했다.
- 최종 실행 이미지, readiness `UP`, 공개 ping HTTP 200, 서비스 설정 활성화를 확인했다. 로컬 개발 서버는 시작하거나 재시작하지 않았다.

운영 배포 기록: [ESSENTIA production 배포](https://github.com/ESSENTIA-Science/ESSENTIA-Platform_BE/actions/runs/37056895671).

### 승인된 운영 초안 검증 실행기

다음 실행기로 승인된 운영 초안 테스트를 수행했다. 이후 실행도 실제 운영 초안을 생성하므로 명시적 opt-in이 필요하다.

```bash
bash scripts/essentia-production-write-smoke.sh --help
# 실제 운영 초안 생성·수정: 명시적 opt-in 필요
bash scripts/essentia-production-write-smoke.sh --apply-production-draft-test
# 운영 요청 없이 실제 형제 어댑터 + fake fetch 검증
bash scripts/essentia-production-write-smoke.sh --self-test
node --check scripts/essentia-production-write-smoke.mjs
bash -n scripts/essentia-production-write-smoke.sh
```

shell 실행기는 기존 `essentia-production-config.sh` helper로 ignored·본인 소유·owner-only `docs/.local/essentia-production.env`를 읽는다. 형제 `ICAROS-api`의 설치된 `tsx`와 실제 `src/essentia/posts.ts`를 사용하며 `ICAROS_API_DIR` override를 지원한다. `--help`·`--self-test`는 운영 설정 파일을 읽지 않는다. Node 파일 직접 실행에도 동일한 opt-in 인자가 필요하다.

한 실행마다 `randomIdempotencyKey()`와 고유한 `[ICAROS production draft test]` 제목을 만든다. 미게시 초안을 생성하고 같은 key·같은 payload로 재생성해 동일 UUID·버전을 확인한다. 생성 응답 유실·오류에는 정확히 같은 요청을 한 번만 재시도한다. 수정은 재시도하지 않는다. 실제 어댑터가 `If-Match` 의미를 `expectedVersion`으로 전달하므로 이전 버전의 수정이 `conflict`인지 검사하고, 이후 재조회에서 최신 본문이 보존됐는지 확인한다.

`displayDate`를 변경하고 Markdown 표와 `:::gallery{columns=1}` 이미지 블록을 저장한다. 이미지에는 외부 요청이 없는 inline data URI를 사용하고 `attachments`는 항상 `[]`다. 날짜·본문·빈 첨부·미게시 상태를 detail/list에서 대조하고 published snapshot에 테스트 UUID·제목이 없음을 검사한다. 이미지 렌더링 검증은 포함하지 않는다.

HTTPS 운영 origin과 `GET /api/service/icaros/posts`, `GET /api/service/icaros/posts/snapshot`, `POST /api/service/icaros/posts`, 이번 실행에서 생성된 UUID의 `GET|PUT /api/service/icaros/posts/{id}/draft`만 허용한다. query·fragment·URL credentials·다른 UUID·publish·delete 경로를 거부한다. 요청과 응답 본문 읽기에 15초 제한을 적용하고 리다이렉트를 거부한다. 서버 시작·AWS 변경·게시·자동 삭제는 하지 않는다.

생성 요청 전에 `docs/.local/essentia-production-write-smoke-*.json` receipt를 exclusive create하고 명시적으로 `chmod 0600`을 적용한다. 디렉터리는 본인 소유·일반 디렉터리인지 확인하고 `0700`으로 제한한다. receipt에는 부모 작업용 `id`(생성 응답의 post UUID), `idempotencyKey`, 고유 테스트 `title`, `currentVersion`(문자열), `initialDraft`(최초 ESSENTIA 요청의 `category`, `title`, `content`, `displayDate`, `attachments`)와 결과가 저장된다. 호환 필드 `postId`, `createdKey`, `version` 및 동일 요청 재시도용 JSON 문자열 `createBody`도 유지한다. 생성 응답 전에는 `id`와 `currentVersion`이 null이고, 생성·수정 응답을 확인하면 즉시 갱신한다. 서비스 토큰은 저장하지 않는다. 생성 결과를 받지 못하면 UUID는 null일 수 있지만 key와 원본 payload로 부모 작업이 확인할 수 있다. 실패 중에도 receipt를 유지한다. receipt 내용·key·UUID·토큰은 출력하거나 커밋하지 않는다. 실행 결과는 성공 여부·개수와 고정된 오류 안내만 출력한다.

receipt를 이용한 후속 확인·전체 게시 여부·정리는 부모 작업 담당이다. 이 실행기로 전체 게시를 호출하면 테스트 초안도 대상이 될 수 있으므로, 부모 작업에서 테스트 초안 처리 여부를 결정한 후 진행한다. standalone self-test는 생성 후 응답 유실 재시도, 동일 key 보존, stale 충돌, roundtrip, snapshot 제외, 요청 allowlist, 실패 receipt 보존과 수정 비재시도를 검증한다.

## 기존 게시글 운영 이관 (2026-10-03)

사용자 요청에 따라 로컬 레거시 19개 글을 운영 ESSENTIA 서비스 API로 이관했다. 현재 공개 글 18개는 ICAROS 프로젝트 게시판에 게시했고, 기존 중복 판정으로 비공개였던 1개는 CMS 초안으로 보존했다. 원본 ID를 포함한 안정적인 idempotency key와 비추적 매핑 파일로 반복 생성의 중복을 방지한다. 본문·날짜·대표 사진과 이미지 48개의 실제 응답을 확인했다.

ESSENTIA 공개 본문의 사진은 검증된 ICAROS 운영 미디어 절대 URL을 사용한다. 어댑터는 읽을 때 해당 도메인만 내부 media URL로 되돌리고, 저장 시 내부 media URL을 공개 URL로 변환한다. 다른 사이트 URL은 바꾸지 않는다. 공개 커뮤니티 날짜도 원래 생성 시각을 유지하도록 이관 글에만 적용했다. 이 URL은 현재 운영 ICAROS 미디어 프록시에 의존하므로 정적 웹 운영 전환 시 미디어 서빙 경로를 함께 유지해야 한다.

이관 확인 후 로컬 레거시의 공개 18개는 비공개 보관으로 전환했고 원본 행은 삭제하지 않았다. 운영 ICAROS 원본 DB와 웹 배포는 변경하지 않았다. 최초 검증에서는 ESSENTIA 공개 글 18개를 확인했다. 검증 도중 CMS에서 날짜 변경과 남은 초안 게시가 이루어져 최종 로컬 공개 snapshot은 19개를 포함한다. 후속 CMS 변경은 덮어쓰지 않았다. 이중 노출 없이 날짜 내림차순으로 표시하며 로컬 정적 빌드·승격을 완료했다. 원래 중복으로 내려둔 글도 현재 게시 상태다. 원본·이관 매핑은 `docs/.local/legacy-posts-import-source.json`, `docs/.local/legacy-post-import-mapping.json`에만 보관한다.
