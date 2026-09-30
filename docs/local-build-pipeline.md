# 로컬 CMS → API → 공개 사이트

`./dev.sh`는 로컬 PostgreSQL(127.0.0.1:5435)과 MinIO(9010)를 시작하고, 공개 사이트(5174), CMS(5175), 로컬 API(5176)를 실행한다. CMS 저장은 로컬 DB의 draft를 바꾸고, 게시는 `scripts/build-web-local.mjs`를 실행해 정적 사이트를 다시 만든다. 성공한 빌드만 별도 릴리스 디렉터리에서 `docs/.local/web-current` 링크로 승격한다. 공개 서버는 이 링크를 서빙하므로 빌드 실패 시 이전 출력이 유지된다.

기본 실행은 `createApiRuntime`을 사용하는 실제 핸들러다. 로컬 모드의 게시 어댑터는 빌드를 버전별 디렉터리에 고정한 뒤 성공 시 공개 링크를 교체한다. `node scripts/smoke-real-handler.mjs`로 인증 조회를, `node scripts/smoke-local-loop.mjs`로 저장→게시→정적 HTML을 확인한다. 예전 데모 API는 `ICAROS_API_RUNTIME=demo ./dev.sh`로만 실행한다. 로컬 media presign/confirm은 `S3_ENDPOINT=http://127.0.0.1:9010`, 로컬 자격증명, `S3_BUCKET=icaros-local`, `S3_PREFIX=icaros-web`을 사용한다. DB의 미디어 키 제약도 이 접두사를 요구한다. 업로드 테스트에 운영 버킷을 쓰지 않는다.

처음 실행하면 `docs/.local/admin-login.json`에 로컬 로그인 정보가 0600 권한으로 생성되고 로컬 DB의 전용 관리자 계정도 준비된다. 이 파일은 Git에서 무시된다. CMS 로그인 화면에서 이 파일의 email/password를 사용한다. 비밀번호를 재발급하려면 서버를 종료하고 파일을 삭제한 뒤 `./dev.sh`를 다시 실행한다. 운영 관리자 계정은 변경하지 않는다.

게시물 쓰기는 ESSENTIA 서비스 계약이 필요하다. `ESSENTIA_SERVICE_ORIGIN`(HTTPS), `ESSENTIA_SERVICE_TOKEN`, `ESSENTIA_SERVICE_CATEGORY`, `ESSENTIA_AUTHOR_LABEL`을 설정하면 API가 서비스 draft를 읽고 쓰며, 빌더가 `/api/service/icaros/posts/snapshot`의 게시된 항목을 공개 스냅샷에 합친다. 설정 일부만 있거나 서비스가 실패하면 빌드가 중단된다. 게시물의 `forumPostId`, `displayDate`, 첨부 media ID를 보존하며, 첨부 파일은 로컬 DB의 ready media와 대조한다. 서비스 설정이 없으면 기존 `legacy_posts`만 빌드된다.

로컬 흐름 확인: `./dev.sh` 실행 중 별도 터미널에서 `node scripts/smoke-local-loop.mjs`. 이 스크립트는 로그인 정보 값을 출력하지 않고 전용 임시 mission을 생성·수정·게시한 뒤 게시 상태와 정적 HTML을 검사한다. 마지막에 임시 행을 삭제하고 별도 게시 작업으로 정리 릴리스를 발행한다. 로컬 DB와 localhost API만 사용한다.

배포 전 로컬 확인: `bash scripts/predeploy-local.sh`. 타입, lint, 테스트, 로컬 DB 스냅샷 빌드와 핵심 HTML 출력을 검사한다. 배포나 운영 DB/S3 쓰기는 실행하지 않는다. 기존 공개 미디어 다운로드는 `essentia` AWS profile의 `s3api get-object` 읽기만 사용하고, 새 로컬 업로드는 MinIO에서 읽는다.
