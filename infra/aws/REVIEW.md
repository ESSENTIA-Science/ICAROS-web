# 배포·게시 사전 리뷰 — 2026-10-03

**이하 내용은 배포 전 발견 사항과 검토 기록이다. 현재 적용 상태는 [배포 상태](../../docs/2026-10-03-release-readiness.md)를 기준으로 확인한다.** 이후 Foundation·Network·Runtime 스택을 적용하고 Cloudflare DNS를 전환했다. 두 차례 게시와 운영 CMS 로그인·공개 경로를 확인했다. 아래의 `blocked`·`아직 없음`·`미검증` 표현은 당시 상태를 설명한다.

## Critical / missing infra

| 항목 | 확인 근거 | 남은 실행 gate |
|---|---|---|
| 신규 인프라 없음 | 초기 essentia 읽기 조회 및 부모 확인: 신규 Lambda/CodeBuild/KVS/해당 CF alias·ACM·NAT 없음 | disabled foundation부터 별도 실제 change set·리소스 검증. Route53 불필요; DNS는 Cloudflare |
| TLS/schema | 초기 ssl=off/legacy19tables. 최신 부모는 TLS verify-full/백업 확인 및 재시작 없는 TLS 활성화 완료 보고 | TLS 최신 상태는 부모 검증 증거. 새 lambda login/migrations008 포함 schema/grant·실제 Lambda 연결 확인. public schema 변경 금지 |
| Egress | VPC IPv6 없음, NAT 없음. ESSENTIA AAAA 없음 | 필요성 재확인된 private CONNECT proxy3128 선택. 부모 agent 배선 통합 보고; 실제 VPC CONNECT/E2E 검증 필요 |
| Source/artifact | public FE/private API, pinned source 및 versioned ZIP 필요 | 정확한 commit SHA·snapshot hash·Linux Node22 ZIP dependency/native/CA·S3 version/hash 검증 |
| Member withdrawal/rollback | active release allowlist + private published copy + no-store | 철회는 새 publish 시점. 예전 snapshot rollback은 철회 사진을 재노출할 수 있어 철회 비교 gate 또는 live DB/current API gate 필수 |

초기 발견이었던 S3 activate ContentType/cache 및 부분 재시도/idempotency는 부모 수정·2 tests green 보고가 있다. 이 작업은 해당 API 파일을 수정하지 않았다. Darwin의 split bucket/public-media 계약 및 Plato의 asset/index 생성은 진행 결과가 전달됐지만, 통합된 운영 staged 증거로 대체하지 않는다.

## Important

- **DB와 KVS 원자성:** 외부 pointer update와 DB COMMIT은 하나의 트랜잭션이 아니다. 응답 유실·callback timeout·DB commit 실패·동시 job을 실제 pointer와 reconciliation해야 한다. 동일 release 재시도 수정만으로 이 문제가 사라지지 않는다.
- **Callback/승격:** terminal FAULT/TIMED_OUT, durable attempt/build ID/source revision, 중복 callback, StartBuild 전후 종료 복구를 확인한다. EventBridge 초안은 terminal 전체와 delivery/async 실패 큐를 갖지만 기본 DISABLED다. runbook의 candidate 승인과 자동 성공 callback 승격 정책을 일치시켜야 한다.
- **첫 release/rollback:** KVS 비어 있으면 503. 검증된 baseline과 초기 pointer가 필요하다. retained manifest+bytes/hash, 예상 current pointer/ETag CAS, 진행 callback 중단·DB 상태 reconcile, member 철회 gate를 함께 검증한다.
- **404:** OAC ListBucket으로 missing key의 404를 목표로 하며 distribution-wide SPA/custom error fallback을 넣지 않았다. branded404 완결은 별도 gate. API 404 JSON과 public HTML이 섞이면 안 된다.
- **큰 파일 호환성:** publisher index는 raster 3MiB/PDF·GLB 8MiB/video32MiB를 허용한다. 현재 buffered UUID proxy는 3MiB 초과 요청에 413이며 다른 정상 사진은 서빙한다. 큰 파일의 CDN 직접 URL은 유지되나 기존 UUID 큰 파일 URL의 streaming/Range 호환성은 미완성이다.
- **빈 목록:** 초기 FE validator가 빈 게시글/차량/분류를 거부했던 발견은 부모/Plato 수정 범위다. 최신 Plato는 snapshot36/release9/typecheck/lint/fixturebuild 통과, 실제 prep57 shared assets·24 JS parse 통과를 전달했다. 이 작업의 독립 infra 검사와 구분한다. 운영 snapshot·sitemap·staged 전환 검증은 남는다.
- **권한/보존:** Retain은 bucket 뿐 아니라 bucket policies/CF function·OAC/policies에도 적용했다. 삭제해도 비용·리소스가 남는다. immutable public media 삭제 금지와 철회 요구의 운영 절차를 검토한다.

## 구현된 review artifacts

- Foundation: 4개 private S3 저장소 + optional versioned artifact bucket(release+snapshot, raw private media, public media, CMS), OAC, KVS, source SHA pinned FE CodeBuild, **public/CMS/media 3개 별도 distribution**. disabled/no aliases가 기본이다.
- Public API: exact UUID `/api/media/` GET/HEAD만 전달. `/admin`은 CMS canonical origin으로 redirect, 공개 admin API는 404. CMS는 별도 distribution의 `/admin/` UI와 same-origin `/api`. 실제 apex/www/CMS/media alias·인증서는 private parameter로 입력한다.
- Runtime: **기존 Cognito parameter만 사용, 새 pool/client/group 생성 없음.** callback/logout/admin mapping 검증 필요. split bucket env, VPC API/callback, 별도 nonVPC media proxy, 실패 큐. CompatibilityReviewed=false 기본값으로 실행 차단.
- Shared assets: `/_release/<asset-tree-sha256>/{_next/static/...|assets/...}` → `release-assets/<sha>/<path>`, KVS pointer와 독립. raw storage prefixes/traversal/encoded separators/private member assets/metadata JSON 차단. Plato uploader는 조건부 생성과 hash/MIME/cache 검증 담당.
- Cache: parent build metadata 계약상 `_next/static`만 immutable, 나머지 HTML/CSS·공개 날짜·sitemap 등 max-age60. URL namespace로 이전 탭 consistency를 보장하고 metadata는 짧은 TTL로 새 버전을 반영한다. 실제 CF response/header 관측은 미수행.

## Media proxy 계약

Index는 `{version,media:{uuid:{key,mime,size,sha256,entityType,storage}}}`이며 entity는 post/panel/rocket/mission/member다. key는 정확히 `published/<lowerUUID>/<lowerSHA>.<ext>`.

- member: storage=private, raster만. private bucket **published/* 읽기만**, raw originals/DB/write 권한 없음. 매 요청 KVS active release → compat index → `published-member-media.json {version,mediaIds}` → 선택된 private 사본을 검증한다.
- 나머지: storage=public, 별도 public bucket. MIME/size/hash 검증 후 bytes 응답, redirect/presigned URL 없음. 전체 UUID 응답 private,no-store/nosniff.
- active member allowlist와 compat index 모두 manifest hash에 포함하고 pointer 이전에 승격한다. index 없거나 부정합이면503, 선택되지 않은 UUID404. 선택된 member 사진 공개 의도와 기존 no-store 정책을 유지한다.
- `@aws-sdk/signature-v4a` pinned dependency 및 side-effect import 추가. 실제 KVS client middleware의 SigV4a 서명이 offline transport까지 생성되는 regression 포함. 실제 AWS 요청·IPv6/TLS 검증은 아님.

## 검증 범위

최종 테스트/CloudFormation validation 결과는 README.md 참조. 합성/mock 검증은 운영 egress·DB TLS·Linux ZIP·DNS·staged end-to-end를 증명하지 않는다. Initial audit 당시 FE suite 28/29와 API focused34/34 기록은 최신 전체 suite green 주장이 아니다. 이 단계에서 workspace 전체 lint/typecheck/FE export/운영 게시를 실행하지 않았다.

[승인·비용](APPROVALS.md) · [네트워크 필요성](NETWORK.md) · [실행기/검증](README.md)

최신 media allowlist에는 공개 member photo뿐 아니라 member Markdown에서 참조한 index 검증된 private raster UUID도 포함한다(Plato 전달). 원본/임의 HTML/미선별 UUID는 포함하지 않는다.

Next RSC 문서 `__next.*.txt`의 !/$는 strict directory 아래 basename에서만 허용하며 %21/%24는 canonical key로 변환한다. shared asset namespace의 TXT/JSON은 계속 차단한다.

## 후속 실제 CloudFormation property 실패

읽기 전용 describe-events에서 `PrivateMediaBucket`의 `/Properties/CorsConfiguration/CorsRules/0`이 Unsupported property `ExposeHeaders`로 실패한 것을 확인했다. AWS::S3::Bucket 공식 describe-type의 CorsRule은 additionalProperties=false이며 올바른 이름은 `ExposedHeaders`다. 단일 property 수정, 이전 template에서 회귀 실패 재현 후 최신26/26 통과. validate-template이 통과해도 nested property 지원을 완전히 검사하지 않는 실제 사례다. 기존 실패 change set은 수정 전 bytes이므로 부모가 새 private bundle/change set을 생성해야 한다. execute/update/create는 수행하지 않았다.

최신 DB 전달: parent actual migration 적용 실패 및 디버깅 중, dry-run8개 통과. PostgreSQL TLS 확인과 별개로 EC2:5432가 PgBouncer front이며 다른 cert/auth 경로라는 조사 결과가 있다. CA trust/auth 확인 및 실제 migration 성공 전 DB runtime/schema gate를 해제하지 않는다.

Foundation 후속 공식 nested schema preflight: 12/12 resource types 조회 성공, unknown property0. Intrinsic value/type/service constraint 전체 검증은 아니며 새 change set 성공을 주장하지 않는다. API/callback DB_TLS_SERVERNAME dynamic reference 추가 후27/27 테스트 통과. PgBouncer frontend CA/SAN 검증은 direct PG TLS와 분리하고 private route·rejectUnauthorized=true를 유지한다.
