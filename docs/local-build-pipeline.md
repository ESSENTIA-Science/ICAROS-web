# 로컬 CMS → API → 공개 사이트

`./dev.sh`는 로컬 PostgreSQL(127.0.0.1:5435)과 MinIO(9010)를 시작하고, 공개 사이트(5174), CMS(5175), 로컬 API(5176)를 실행한다. CMS 저장은 로컬 DB의 draft를 바꾸고, 게시는 `scripts/build-web-local.mjs`를 실행해 정적 사이트를 다시 만든다. 성공한 빌드만 별도 릴리스 디렉터리에서 `docs/.local/web-current` 링크로 승격한다. 공개 서버는 이 링크를 서빙하므로 빌드 실패 시 이전 출력이 유지된다.

기본 실행은 `createApiRuntime`을 사용하는 실제 핸들러다. 로컬 모드의 게시 어댑터는 빌드를 버전별 디렉터리에 고정한 뒤 성공 시 공개 링크를 교체한다. CMS 인증은 Cognito managed login으로 확인한다. API는 형제 `ICAROS-api` 저장소에서 실행하며 `docs/.local/cognito.env`가 필요하다. 로컬 media presign/confirm은 `S3_ENDPOINT=http://127.0.0.1:9010`, 로컬 자격증명, `S3_BUCKET=icaros-local`, `S3_PREFIX=icaros-web`을 사용한다. DB의 미디어 키 제약도 이 접두사를 요구한다. 업로드 테스트에 운영 버킷을 쓰지 않는다.

Cognito User Pool과 관리자 계정이 없으면 CMS 로그인은 닫힌다. 로컬 설정 방법은 `docs/cognito-local.md`를 참고한다. 기존 비밀번호 로그인 파일과 자동 재발급 스크립트는 사용하지 않는다.

게시물 쓰기는 ESSENTIA 서비스 계약이 필요하다. 운영에서는 `ESSENTIA_SERVICE_ORIGIN`(HTTPS), `ESSENTIA_SERVICE_TOKEN`, `ESSENTIA_SERVICE_CATEGORY`, `ESSENTIA_AUTHOR_LABEL`을 설정하면 API가 서비스 draft를 읽고 쓰며, 빌더가 `/api/service/icaros/posts/snapshot`의 게시된 항목을 공개 스냅샷에 합친다. 설정 일부만 있거나 서비스가 실패하면 빌드가 중단된다. 게시물의 `forumPostId`, `displayDate`, 첨부 media ID를 보존하며, 첨부 파일은 로컬 DB의 ready media와 대조한다. 서비스 설정이 없으면 기존 `legacy_posts`만 빌드된다.

로컬 ESSENTIA 백엔드가 `127.0.0.1:8081`에서 실행 중이고 `docs/.local/essentia-service-token`이 있으면 `./dev.sh`가 게시글 API를 자동 연결한다. 토큰은 ESSENTIA의 `SERVICE_TOKEN`과 같은 값이고, ESSENTIA는 `SERVICE_TOKEN_USER_ID`·`SERVICE_TOKEN_PROJECT_ID`도 설정해야 한다. 이 모드는 로컬 루프백 HTTP만 허용한다. `ICAROS_LOCAL_ESSENTIA=1 ./dev.sh`는 연결을 필수로 검사하고, `ICAROS_LOCAL_ESSENTIA=0 ./dev.sh`는 연결을 끈다. ESSENTIA 브랜치의 로컬 Flyway V25·V26 적용과 서비스 기동 방법은 `docs/essentia-contract-gap.md`를 참고한다.

로컬 흐름 확인: Cognito 설정 후 `./dev.sh`를 실행하고 CMS에서 로그인해 초안 저장→사이트 전체 게시→공개 HTML 반영을 확인한다. 자동화된 API·CMS 단위 테스트는 각 저장소에서 실행한다.

배포 전 로컬 확인: `bash scripts/predeploy-local.sh`. 타입, lint, 테스트, 로컬 DB 스냅샷 빌드와 핵심 HTML 출력을 검사한다. 배포나 운영 DB/S3 쓰기는 실행하지 않는다. 기존 공개 미디어 다운로드는 `essentia` AWS profile의 `s3api get-object` 읽기만 사용하고, 새 로컬 업로드는 MinIO에서 읽는다.
