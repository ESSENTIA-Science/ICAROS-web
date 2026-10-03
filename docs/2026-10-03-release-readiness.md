# 배포 전 최종 점검 — 2026-10-03

## 판정

**현재 새 정적 FE·CMS·API 구성의 운영 배포는 차단 상태다.** 로컬 코드 검사 통과와 운영 전환 완료는 구분한다. 기존 서비스를 새 구성으로 교체하거나 main에 push하지 않았다.

Superpowers requesting-code-review·verification-before-completion을 적용해 보안, 클라이언트 요구사항, 배포 구성을 병렬 검토했다. 실제 운영 값은 이 문서에 기록하지 않는다.

## 클라이언트 요구사항

아래 “구현”은 저장·조회·공개 렌더링 코드 연결을 확인했다는 뜻이다. 모든 항목의 운영 CMS → 전체 게시 → 공개 사이트 반영을 실환경에서 확인했다는 뜻은 아니다.

| 요청 | 코드 상태 | 남은 확인 |
|---|---|---|
| TRACK·CREW·불필요한 작은 문구 삭제 | 구현, 추가 CTA 장식 문구 제거 | 대표 화면 확인 |
| posts 위 Instagram 링크 | 구현 | CMS 현재 링크와 클릭 확인 |
| 총괄 인원 숫자 제거·옆 소개 | 구현 | 실제 소개와 화면 확인 |
| 게시판 정상화·ESSENTIA 연동·과거 날짜 정렬 | 구현, 기존 19개 글 이관 검증 기록 있음 | 새 도메인 구성에서도 기존 글 이미지 유지 |
| 홈 사진 추가·삭제·영상 | 구현 | 실제 파일 업로드·재생·전체 게시 |
| 후원 차수·누적 금액·목표 수정 | 구현 | 실제 운영 값 확인 |
| VEHICLES / ROCKETS·SATELLITES·UAVs | 구현 | 각 분류 조회 |
| 시리즈 설명·분류/시리즈 관리 | 구현 | CMS 수정 → 공개 반영 |
| 기체·캔셋 추가, 기존 기체 분류 수정 | 구현 | 기존 데이터로 CRUD 확인 |
| 기체 추가 사진·선택 GLB 모델 | 구현 | 파일 업로드와 WebGL/사진 fallback |
| 부서 이름 변경·추가·삭제·인원 배정 | 구현 | 실제 운영 데이터로 확인 |
| 제원 추가·삭제·범위 입력, 최대 6개 | 구현 | 1~3개 기존 레이아웃, 4~6개 2열·3행 확인 |
| 멤버 프로필 사진, 총괄 카드 폭 | 구현 | 공개 사진 접근 정책과 실제 화면 확인 |
| 본문 이미지·PDF·MP4와 미리보기 | 이번 점검에서 PDF·MP4 보완 | 브라우저 업로드·재접속 미리보기·PDF/영상 재생 |
| 별도 글 첨부 영역 제거 | 반영, 기존 첨부는 본문에 없는 것만 렌더링 | 기존 글 중복 이미지 확인 |
| 발사 기록 missions 목록·상세·CMS | 구현 | 실제 기록과 공개 반영 |
| 자동 저장·우측 상단 변경사항 반영·안내·이탈 경고 | 구현 | 실패·재시도·창 닫기 시나리오 |
| Cognito 자동 이동·MFA 제거 | 구현, 이전 OFF 설정 기록 있음 | 현재 AWS 설정·운영 callback 로그인 |
| 디자인 보완·빠른 로딩 | 정적 export·지연 미디어 등 구현 | 모바일 화면, 실제 Lighthouse/네트워크 실측 미완료 |

분류 자체 설명은 사용자 필수 요청이 아니며 누락으로 세지 않았다. 제원 1~3개의 기존 레이아웃 유지 역시 사용자 요청에 따른 동작이다. 디자인의 만족도와 “빠르다”는 결과는 코드 검사만으로 확정하지 않는다.

## 이번 점검의 수정

- Next.js 16.3.8로 보안 업데이트. React 정확한 버전 고정 유지.
- 업로드 SHA-256·실제 크기·MIME·ETag 검증, 서명 URL 재사용 덮어쓰기 방지. 빈 CRC32 자동 서명 제거.
- production PostgreSQL URL이 강제 CA 검증을 덮어쓰지 못하도록 TLS 옵션 제거.
- stale 게시 요청의 버전 검증을 ESSENTIA 글 공개보다 먼저 실행.
- 정적 release 객체의 Content-Type과 캐시 정책 수정, 부분 승격·동일 release 재시도 검증.
- authenticated PDF·영상 미리보기 URL과 안전한 본문 렌더링 추가.
- CloudFront 저장소 prefix·인코딩된 경로 traversal 차단.
- 운영 migration 001~007, 체크섬 원장·transaction·advisory lock·권한 검증 러너 준비.
- main CI 및 인프라 계약 테스트 추가.

## 운영 전환 차단 사항

1. 공유 PostgreSQL TLS가 꺼져 있다. 새 API는 TLS 검증을 요구한다. TLS 활성화·CA 준비·재시작 영향 확인이 필요하다.
2. 운영에는 새 CMS의 departments·missions·publication 등 테이블/컬럼이 없다. migrator로 dry-run → 승인된 적용 → 소유권·권한 검증이 필요하다. `public` 스키마는 변경하지 않는다.
3. 새 API Lambda·CodeBuild·CloudFront·KVS·인증서가 아직 없다. IAM과 네트워크 변경 범위를 검토하고 구성해야 한다.
4. private Lambda의 Cognito·ESSENTIA 외부 HTTPS 경로가 없다. NAT Gateway 고정비 또는 기존 EC2 egress proxy의 운영 부담 중 선택해야 한다.
5. production media resolver는 아직 private 원본 key를 URL에 붙인다. 공개 대상으로 선별된 파일의 승격·해시 확인·분리 버킷 연결이 필요하다. private 버킷 전체를 CDN에 연결하면 안 된다.
6. 멤버 사진의 production HTTPS URL과 FE의 정적 파일 계약이 충돌한다. 기존 private/no-store 취지와 정적 공개·철회 정책을 함께 해결해야 한다.
7. ESSENTIA 글의 기존 `/api/media/<id>` URL을 새 환경에서도 유지해야 한다. compatibility proxy는 준비했지만 공개 미디어 index 생성과 release 연결은 미구현이다.
8. 게시 완료의 DB 상태와 KVS 포인터는 별도 저장이다. callback 유실·실행 종료 후 job 복구와 reconciliation이 필요하다. API revision 교체 중 이전 빌드 callback 검증도 보완해야 한다.
9. 이전 HTML이 새 release에서 이전 assets를 요청하면 404가 날 수 있다. release별 asset URL 또는 공용 해시 asset 저장소가 필요하다.
10. 모든 posts·vehicles·분류 등을 비우면 현재 FE build validator가 거부한다. 빈 상태의 지원 또는 명확한 CMS 게시 조건이 필요하다.
11. 개별 `kind: media` 게시 버전 조회가 legacy에 없는 `media.updated_at`을 사용한다. 전체 게시와 별도로 해당 경로를 수정/비활성화해야 한다.
12. Linux Lambda ZIP·native 의존성·CA 패키징, 기존 Cognito 관리자 매핑, API 404와 공개 404 처리, 신규 환경 스모크가 남았다.

운영 전환 세부 증거·검토용 CloudFormation과 rollback 순서는 [인프라 리뷰](../infra/aws/REVIEW.md)에 있다. `runtime.blocked.template.json`은 현재 코드와 호환되지 않는 차단된 초안이며, 적용 가능한 완성 템플릿으로 취급하지 않는다.

ESSENTIA 글 공개는 ICAROS 정적 빌드보다 먼저 수행된다. 두 사이트의 동시·원자적 공개를 보장하지 않으며 CMS 안내에 이 순서를 명시했다.

## 검증 증거

- web/CMS: typecheck·lint·CMS 139개 + web 29개 테스트 통과.
- 합성 콘텐츠 static FE build·CMS production build 통과. CMS bundle 크기 경고는 남아 있다.
- CloudFront router·AWS 계약/proxy 테스트 14개 통과. 합성/mocked 검증이며 실제 AWS 동작 증거가 아니다.
- web/CMS·API production dependency audit 0건. 보안 완전성을 보증하는 수치는 아니다.
- API 최종 통합 검사 결과는 아래 실행 기록을 갱신한 뒤 확정한다.
- 로컬 서버 실행/재시작, 운영 DB 쓰기, 신규 AWS 리소스 생성, 도메인 전환, main push는 수행하지 않았다.

최종 로그와 실제 식별자를 포함한 읽기 전용 점검 원문은 추적하지 않는 `docs/.local/`에 보관한다.
