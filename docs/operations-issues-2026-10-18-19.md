# 운영 이슈 기록: 멤버 페이지·사진 업로드·CMS 로그인

기록일: 2026-10-19. 이 문서는 2026-10-18~19에 조사·수정한 내용을 기록한다. 아래 스냅샷 버전과 인원·사진 상태는 조사 당시의 값이며 이후 CMS 편집에 따라 달라질 수 있다.

## 처리 현황

| 항목 | 확인한 원인·배경 | 적용한 조치 | 검증과 남은 확인 |
| --- | --- | --- | --- |
| 멤버 설명이 표시되지 않음 | 카드 단순화 과정에서 소개글 렌더링과 CSS·표시 검증이 삭제됨 | 소개글 Markdown과 반응형 배치 복원, 공개 Web/G 운영 배포 | 운영 desktop·mobile·JavaScript 없는 mobile에서 설명 표시 확인 |
| 김도건 사진을 바꿔도 공개 페이지에 반영되지 않음 | 업로드 직후 게시하면 새 사진을 멤버에 연결·자동 저장하기 전에 게시할 수 있는 경합 재현 | 연결과 자동 저장 등록까지 pending 작업으로 추적, CMS 운영 배포 | 합성 데이터 전체 E2E 통과. 실제 원하는 사진의 재업로드·게시 결과는 미확인 |
| CMS 로그인에서 아이디·비밀번호를 한 화면에 입력하기 어려움 | Managed Login v2에서 아이디 입력 단계만 표시됨 | 요청에 따라 Classic Hosted UI v1으로 운영 설정 변경 | desktop·mobile의 단일 폼·1회 제출 확인. 실제 계정 로그인 성공은 미검증 |
| 김건우 프로필 사진 추가 시 `파일 전송에 실패했습니다.` | S3 CORS에 현재 업로드 계약의 헤더 두 개가 누락됨 | 운영 CORS 및 인프라 템플릿에 두 헤더 추가 | 실제 CMS 오리진 → S3 업로드·체크섬 검증 통과. 실제 사진 재업로드·게시 결과는 미확인 |

## 1. 멤버 설명 누락

### 원인과 적용

`b3bcea5`에서 멤버 카드를 단순화하면서 소개글 JSX·CSS와 표시 검증이 함께 삭제됐다. 데이터가 존재해도 공개 페이지에서 렌더링하지 않았다.

`2a213590b1f613c0e7cc794db7e9e609883b7ec4`에서 소개글 Markdown과 반응형 배치를 복원했다. Markdown 이미지·원시 HTML 차단과 기존 부서·멤버 순서는 유지했다. 공개 Lambda와 재검증 worker를 함께 배포하고 기존 hashed assets를 보존했다. API·CMS·DB·게시 스냅샷은 변경하지 않았다.

### 검증

- Node 22의 G 패키징 검증(typecheck, lint, 전체 테스트, 운영 의존성 audit, 인프라, CMS build, browser suite, G runtime)을 통과했다.
- 첫 패키징의 모바일 메뉴 포커스 검사가 한 번 실패했다. 같은 소스의 개별 검사와 전체 패키징 재실행은 통과했다.
- 당시 v33 스냅샷 기준 공개 경로 41개 preflight 및 대표 운영 경로를 확인했다.
- 실제 Chrome desktop 1440px, mobile 390px, JavaScript 없는 mobile에서 김지후·이성우·김도건의 소개글 3개가 표시됐다. 멤버 29명과 기존 순서가 유지됐고 가로 넘침·page error가 없었다.
- 배포 전후 게시 pointer와 snapshot SHA가 같았다.

## 2. 프로필 사진 연결과 게시 순서 경합

### 조사와 재현

김도건의 사진이 변경되지 않는다는 신고를 조사했다. 당시 v39 공개 스냅샷과 운영 페이지 SHA는 일치했다. 공개 사진 3개의 실제 바이트 SHA도 스냅샷과 일치했고 `private, no-store`였다. 김도건은 `hasPhoto=false`로 기본 이미지를 사용하고 있었다. 이 조회만으로 이전 사용자 시도의 실패 원인을 단정할 수는 없었으며, CDN이 이전 사진을 반환한다는 증거도 없었다.

실제 CMS 컴포넌트에서 업로드 확인을 지연하고 즉시 게시하면, 새 사진 ID를 멤버에 PUT하기 전에 게시 POST가 실행되는 경합을 재현했다. 파일 전송·확인만 전역 pending으로 추적하고 호출자가 수행하는 사진 연결·자동 저장 등록은 포함하지 않은 것이 원인이었다.

### 수정과 적용

`999561974552059739fadd47ad1c19783f37cf6d`에서 `ResourceEditor.upload()`의 파일 업로드부터 폼 연결·busy 해제까지 하나의 pending 작업으로 추적했다. 기존 `flushCmsChanges()`가 새 멤버 저장을 완료한 뒤 게시하도록 했다. 업로드 실패는 대기 중인 게시에도 전파한다.

CMS 정적 번들만 운영에 배포했다. 공개 Web/G·API·media proxy 코드, 공개 pointer와 운영 멤버 데이터는 변경하지 않았다.

### 검증과 경계

- 변경 전 실패한 회귀 테스트가 수정 후 통과했다. 새 멤버 PUT이 게시 POST보다 먼저 실행됐고 재접속 후에도 새 ID가 유지됐다. 업로드 실패 시 게시 POST는 0건이었다.
- 전체 workspace 테스트·typecheck·lint, production CMS build 및 CMS 브라우저 시나리오 23개를 통과했다.
- 배포할 production CMS dist, 임시 PostgreSQL 17, 실제 API repository·세션·게시 ledger·snapshot source, 실제 MemberPage SSR·media proxy를 연결한 desktop/mobile E2E를 통과했다.
- 사진 등록 → 즉시 게시, 교체 → 즉시 게시, 제거 → 즉시 게시에서 decoded pixel·DB ID·snapshot URL·응답 SHA와 이전 사진의 404를 확인했다.
- **이 E2E의 S3는 loopback fixture였다.** 바이트·체크섬·조건부 쓰기는 검사했지만 AWS S3의 CORS와 IAM은 검증하지 않았다. Cognito 로그인은 격리 DB 세션으로 대체했다. 따라서 아래 4번의 운영 CORS 장애를 배제하는 근거가 되지 않는다.

## 3. Cognito Classic Hosted UI 전환

### 요청과 적용

아이디와 비밀번호를 한 화면에서 입력하고 버튼 한 번으로 제출하도록 요청받았다. 변경 전 실제 CMS 진입 화면은 desktop/mobile 모두 비밀번호 입력 없이 아이디 입력 단계만 표시했다.

CMS 전용 User Pool 도메인의 `ManagedLoginVersion`을 2에서 1(Classic Hosted UI)로 변경하고 `ACTIVE` 상태를 확인했다. App Client와 사용자 풀 보안 설정이 변경 전과 동일함을 확인했다. 앱/API 배포는 하지 않았다.

### 검증과 복구

- 실제 CMS에서 시작한 desktop/mobile 로그인 화면에서 아이디·비밀번호가 같은 POST 폼에 표시되고 제출 버튼이 하나임을 확인했다.
- authorization code와 PKCE S256 흐름을 유지했다. Cognito 인증 테스트 2개를 통과했다.
- 존재하지 않는 합성 계정으로 한 번 클릭했을 때 두 값이 POST 한 건에 함께 전송되고 정상적으로 거부됐다. 실제 관리자 계정의 로그인 성공은 검증하지 않았다.
- UI 복구가 필요하면 같은 도메인의 `ManagedLoginVersion`을 2로 되돌린다. 실제 계정이나 비밀번호를 변경하는 작업은 아니다.

## 4. S3 CORS 누락으로 사진 전송 실패

### 관측과 원인

김건우 프로필 사진 추가 시 `파일 전송에 실패했습니다.`가 표시된다는 신고를 조사했다. CloudWatch에서 최근 미디어 POST 3건은 모두 201로 성공했지만 업로드 확인 요청이 이어지지 않았다. 이 로그는 서명 발급이 성공했음을 보여주며, 요청별 로그에 멤버 이름이 없으므로 각 건을 김건우 요청으로 특정하지는 않았다.

CMS의 해당 문구는 서명 URL로 직접 PUT하는 `fetch`가 실패했을 때 표시된다. PUT은 브라우저 → S3 경로이므로 API Lambda 로그만으로 S3 전송 결과를 확인할 수 없다.

운영 private media 버킷 CORS에는 `content-type`만 허용돼 있었다. 현재 계약은 `if-none-match`와 `x-amz-checksum-sha256`도 전송한다. 실제 preflight에서 기존 헤더는 200, 현재 업로드 헤더는 403과 CORS 응답 헤더 누락을 반환했다. Chrome에서도 desktop/mobile 모두 fetch TypeError가 발생했고 객체는 생성되지 않았다.

### 수정과 검증

`9121f57`에서 [`foundation.template.json`](../infra/aws/foundation.template.json)의 허용 헤더에 두 항목을 추가했다. 운영 버킷에도 동일 변경을 적용하고 재조회했다. 허용 오리진은 CMS, 메서드는 PUT, 노출 헤더는 ETag로 유지했다.

- 같은 preflight가 200으로 바뀌었고 허용하지 않은 오리진은 계속 403이었다.
- 네트워크 interception 없이 실제 CMS 오리진을 연 Chrome desktop 1440px/mobile 390px에서 합성 WebP를 실제 S3로 PUT하여 200을 확인했다.
- API의 실제 S3 서명 어댑터를 사용하되 서명 자격증명은 운영자 CLI 자격증명을 사용했다. 저장 크기·MIME·SHA-256, API 어댑터의 checksum HEAD와 ETag 조건부 prefix GET이 통과했다.
- 합성 이미지의 객체 버전을 모두 삭제하고 최종 목록에 테스트 객체와 삭제 마커가 없음을 확인했다.
- 전체 workspace 테스트 297개, 인프라 테스트 93개, typecheck·lint가 통과했다.
- 실제 사용자의 로그인 → 운영 presign → PUT → 운영 confirm → 실제 멤버 게시 전체 흐름은 검증하지 않았다. 실제 사진은 다시 업로드하고 사이트에 반영해야 한다.

## 이후 같은 증상을 조사할 때

1. **설명이 없음:** CMS/스냅샷에 설명이 있는지와 공개 페이지가 해당 필드를 렌더링하는지 분리해서 확인한다. 설명이 있는 합성 멤버의 desktop/mobile·JavaScript 없는 화면을 검사한다.
2. **파일 전송 실패:** API presign 응답 → 브라우저 OPTIONS → S3 PUT → confirm 순서로 확인한다. 상태 코드 없는 fetch 실패에서는 CORS·네트워크·CSP를 먼저 확인한다. 실제 브라우저의 preflight와 요청 헤더를 운영 CORS에 대조한다.
3. **업로드 성공 후 이전 사진 표시:** confirm 완료, 멤버의 새 media ID 자동 저장, 게시 job, snapshot URL·SHA, 공개 응답 바이트 순서로 비교한다. 업로드 직후 게시하는 경합도 검사한다.
4. **E2E 범위 기록:** fixture S3 테스트와 실제 AWS 테스트를 구분한다. 브라우저 네트워크 interception을 사용한 검사가 실제 CORS를 검증한다고 가정하지 않는다. 물리 모바일 기기 검사는 이번 작업에서 수행하지 않았다.

이 절차는 운영 조사·검증 지침이다. CORS drift 자동 감시나 실제 AWS 통합 테스트의 CI 편입은 이번에 구현하지 않았다.

## 변경 이력과 증거 보관

위 코드 커밋은 로컬 `integration/remaining-web-20261014`에 기록했다. 이 작업에서 원격 push·PR 병합은 수행하지 않았다. 운영 적용 사실과 Git 원격 반영 여부는 별개다.

상세 작업 기록은 상위 작업공간의 `docs/member-bio-restoration-2026-10-18.md`, `docs/member-photo-restoration-2026-10-19.md`, `docs/cognito-classic-2026-10-19.md`, `docs/member-photo-upload-cors-2026-10-19.md`에 있다.

설정 전후 응답·AWS receipt·브라우저 캡처·검증 로그는 상위 작업공간의 접근 제한된 `.private/` 아래 다음 폴더에 보관한다. 저장소 상대 경로가 아니며, 운영 식별자와 민감한 값을 포함하므로 Git에 복사하지 않는다.

- `member-bio-20261018/`
- `member-photo-20261019/`
- `cognito-classic-20261019/`
- `profile-upload-20261019/`

참고: [AWS S3 CORS 문제 해결](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors-troubleshooting.html), [Cognito UpdateUserPoolDomain](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateUserPoolDomain.html).
