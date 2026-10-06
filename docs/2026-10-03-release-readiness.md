# 배포 상태 — 2026-10-03

## 현재 상태

새 정적 공개 웹과 분리된 CMS를 AWS에 배포했다. Cloudflare DNS에서
`icaros.kr`·`www.icaros.kr`을 공개 CloudFront로, `cms.icaros.kr`을 CMS CloudFront로,
`media.icaros.kr`을 공개 미디어 CloudFront로 연결했다. 네 도메인은 DNS only이며
발급된 ACM 인증서로 HTTPS 응답을 확인했다. 기존 Vercel 프로젝트와 `main`은 유지했다.

운영 콘텐츠의 첫 전체 게시와 정식 미디어 도메인을 반영한 두 번째 전체 게시가
완료됐다. CodeBuild 성공 후 자동 callback이 게시 상태를 `published`로 바꾸고 KVS
release pointer를 새 버전으로 전환했다. 공개 홈·기체·기록 HTML이
`media.icaros.kr`을 참조하며 이미지 200을 확인했다. 사용자가 보고한 한 관리자
계정의 Cognito callback 401은 해당 계정이 CMS DB에 매핑되지 않은 문제로 좁혔다.
이후 사용자 요청에 따라 기존 Cognito 사용자 2명을 모두 삭제하고 활성 CMS 세션 2개를
폐기했다. 삭제 직후 사용자 수 0을 확인했다. 이후 콘솔에서 새 사용자 1명이 생성됐고,
이 계정의 이메일 검증과 기존 관리자 그룹 소속을 확인했다.
검증된 관리자 그룹 구성원은 첫 로그인 때 CMS DB에 자동 등록되도록 Lambda를 갱신했다.

## 확인한 경로

| 대상 | 관측 결과 |
|---|---|
| 공개 홈·기체 목록/상세·기록 목록/신규 및 과거 글·멤버·활동 | 스테이징 200, 운영 주요 목록 200 |
| 없는 기체 | 스테이징 404 |
| sitemap·robots·CSS | 스테이징 200 |
| 공개 `/admin` | 운영 CMS로 308 |
| 공개 `/api/admin/*` | 404 |
| CMS `/admin/` | 운영 200 |
| CMS 관리자 API | 미인증 403, 기존 계정의 Cognito 로그인 후 콘텐츠 조회 200 확인; 신규 계정은 생성 전 |
| 공개 미디어 | `media.icaros.kr`에서 이미지 200 |
| 멤버 사진 프록시 | 선택된 사진 200·`private, no-store`, 없는 ID 404 |
| Cloudflare DNS·TLS | 운영 네 도메인의 CloudFront 응답과 TLS 검증 성공 |
| 데스크톱·모바일 홈/기체/기록/멤버 | 브라우저 200, 가로 넘침·완료된 이미지 오류·페이지 예외 0 |

기존 Cognito pool/client/group을 재사용했다. 계정 삭제 전 운영 CMS의 OAuth state/cookie
왕복과 관리자 세션 발급을 브라우저에서 확인했다. Lambda의 외부 HTTPS는 기존 ESSENTIA API
EC2의 전용 CONNECT proxy를 사용한다. AWS CLI 작업은 `essentia` 프로필과 서울 리전으로
수행했다. 공유 DB는 TLS 검증을 사용하며 `public` 스키마를 변경하지 않았다.

운영 스냅샷은 기체 6건, 글 37건, 멤버 29건과 참조 미디어 79건으로 생성됐다.
참조 미디어 79건은 별도 저장소로 복사·검증했고 공개 75건, 비공개 멤버 사진 4건으로
나눠 제공한다. 기존 ready 미디어 가운데 로컬 원본이 남아 있지 않은 8건은 이번
스냅샷에서 참조되지 않는다.

## 구현 및 검증

- Web/CMS 워크스페이스 검사와 정적 합성 콘텐츠 빌드 통과.
- API typecheck·lint·build 및 테스트 212개 통과. Cognito 첫 로그인 시 관리자 DB 등록은
  운영 DB 트랜잭션에서 검증 후 rollback했다.
- 인프라 계약 테스트와 CloudFormation 스택 적용 완료.
- 실제 CodeBuild 두 차례 성공, 자동 게시 callback·KVS release pointer·공개 200 확인.
- CodeBuild 이벤트의 ARN 형식과 첫 게시의 빈 KVS 포인터 처리 오류를 실환경에서
  발견해 수정하고 회귀 테스트를 추가했다.

## 남은 확인과 운영 위험

1. 새 사용자의 Cognito 상태는 `CONFIRMED`·활성·이메일 검증 완료·관리자 그룹 소속이다.
   새 OAuth 로그인과 CMS DB 자동 등록은 사용자 비밀번호가 필요해 아직 브라우저에서
   확인하지 못했다.
2. 영상·PDF 업로드/재접속 미리보기, CMS의 개별 CRUD·자동 저장,
   실패 재시도, WebGL fallback과 디자인의 시각적 품질은 아직 검증하지 않았다.
3. DB 게시 상태와 KVS pointer는 원자적이지 않다. callback 유실과 부분 승격의
   reconciliation, rollback 훈련을 운영 절차로 남긴다.
4. 보존된 정적 release·미디어 버전의 개인정보 철회 및 이전 HTML의 해시 자산
   보존 정책을 확정해야 한다.
5. 검증된 전환 이후 기존 Vercel 제거를 검토한다. `main` 반영은 별도 승인 사항이다.

운영 식별자와 비밀값은 이 공개 저장소에 기록하지 않는다. 배포 파라미터와 검사 원문은
추적하지 않는 `docs/.local/`에 있다. 인프라 설계의 세부 검토는
[인프라 리뷰](../infra/aws/REVIEW.md)를 참고한다.
