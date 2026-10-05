# AWS 코드 배포와 CMS 게시

## 두 종류의 변경

| 변경 | 실행 경로 | 완료 기준 |
| --- | --- | --- |
| CMS 콘텐츠 저장 후 게시 | 운영 API의 G snapshot 검증·pointer 전환 | 공개 Lambda가 새 pointer를 읽고 전체 route preflight를 통과한 뒤 게시 job 완료 |
| Web 코드 변경 | `main`의 `deploy-web.yml` | 현재 snapshot으로 OpenNext 빌드, S3 업로드, Web Lambda 스택 업데이트, route preflight, CloudFront 무효화와 공개 smoke |
| CMS 코드 변경 | `main`의 `deploy-cms.yml` | asset 선 업로드, HTML 전환, CloudFront 무효화와 CMS HTML smoke |
| API 코드 변경 | API 저장소 `refactor/repo-split-cognito`의 `deploy-api.yml` | 검증·빌드, versioned artifact 업로드, API/callback 스택 업데이트와 Lambda smoke |

콘텐츠 게시에는 GitHub Actions나 CodeBuild가 필요하지 않다. Web 빌드는 코드가 바뀐 경우에만 수행한다. GitHub Actions는 OIDC로 저장소와 브랜치가 제한된 짧은 AWS 세션을 사용한다. AWS access key, 운영 버킷명, 스택명, 배포 역할 ARN은 공개 저장소에 커밋하지 않고 GitHub repository variables와 AWS IAM에 둔다.

## 안전한 전환과 복구

Web은 현재 G pointer의 snapshot을 SHA-256으로 검증한 뒤 빌드한다. Lambda zip과 `_assets`, `_cache`를 올린 후 CloudFormation의 코드 key와 build ID를 바꾼다. 60여 공개 route 사전 검사나 smoke가 실패하면 이전 코드 key/build ID로 복구하고 캐시를 다시 비운다. API는 artifact bucket의 S3 VersionId를 스택에 반영하고, smoke 실패 시 이전 key/version으로 복구한다. CMS는 새 hashed asset을 먼저 올린 뒤 HTML을 전환한다. 즉시 오래된 asset을 지우지 않아 전환 중 열린 브라우저가 이전 JS를 계속 읽을 수 있다.

수동 재배포는 각 workflow의 `workflow_dispatch`로 한다. 롤백 시 CloudFormation의 직전 코드 key/version을 재지정한다. 콘텐츠 rollback은 코드 배포와 별개의 G pointer rollback 절차를 따른다. 서로의 S3 버킷 객체를 삭제하지 않는다.

## 현재 제한

운영 DB에는 `member_departments`가 없어 다중 부서 API 코드를 배포하면 CMS 멤버 읽기가 실패한다. 이번 코드 배포에는 운영 DB 호환 API와 CMS UI를 사용한다. 다중 부서 기능은 migration 적용·검증·브라우저 E2E를 거쳐 별도 배포해야 한다.

Vercel 프로젝트와 Git 배포 연결은 AWS 코드 배포·CMS 게시·브라우저 검증이 모두 끝난 뒤 제거한다. `legacy/`의 과거 소스와 문서는 이력 검토용이며 운영 배포 대상이 아니다.
