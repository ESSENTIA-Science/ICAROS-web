# AWS 적용 검토 artifacts

**Foundation: source SHA 확정 후 적용 검토 가능한 산출물. Runtime: 통합 E2E까지 blocked.** 모든 남은 사용자 승인은 받았다. [APPROVALS.md](APPROVALS.md)의 조건과 [REVIEW.md](REVIEW.md)의 기술 gate를 구분한다. 이번 작업은 mutation하지 않았다.

- `foundation.template.json`: public/CMS/media 3개 disabled distribution, 저장소 분리, optional artifact bucket(defaulttrue), source pinned CodeBuild, immutable prefix+Retain policies.
- `network.template.json`: EgressMode=proxy 기본. NAT/EIP/public route/subnet 전부 UseNat condition으로 제외. proxyPrivateIpv4 /32:3128, DB5432, S3 prefix443. 기존 SG ingress 기본false(승인된 concrete 설정으로 부모 적용).
- `runtime.blocked.template.json`: 기존 Cognito 재사용, JSON DATABASE_URL secret, split buckets, ICAROS_HTTPS_PROXY→부모 egress helper, versioned API/proxy ZIP, callback 실패 큐. CompatibilityReviewed=false 기본.
- `certificate.template.json`: us-east-1 DNS validation. parent 요청 certificate 재사용 여부를 확인하며 중복 요청하지 않는다.
- `config.schema.json`/`config.example.json`: 플레이스홀더만. approvals=true는 최신 승인 반영, codeFixes/gates=false는 합성 예시이며 부모 검증 상태를 취소하지 않는다.
- `review.mjs`: 검증/private bundle 생성만. deploy 명령 없음, 값 출력 없음. 실제 값은 저장소 밖 private config와 0700/0600 bundle에 저장한다.
- `media-proxy.mjs`, `package.json`, `package-lock.json`, `proxy.package.json`: 별도 Node22 artifact. public/private selected copies, active index/member allowlist, MIME/hash/size 검증, no-store. SigV4a pinned side-effect import 포함.
- `NETWORK.md`: 선택된 proxy 구성과 IPv6/NAT 대안·비용·운영 비교.
- `preflight.sql`: 읽기 검증 쿼리. migration 아님.

```sh
npm ci --prefix infra/aws --ignore-scripts --no-audit --no-fund
node --test infra/cloudfront/release-router.test.mjs infra/cloudfront/routers.test.mjs infra/aws/review.test.mjs infra/aws/signer.test.mjs
node infra/aws/review.mjs check infra/aws/config.example.json
# 실제 경로는 저장소 밖에 둔다.
node infra/aws/review.mjs render /PRIVATE/config.json /PRIVATE/new-review-bundle
```

최신 결과: **27/27 tests 통과**. 실제 KVS client middleware의 SigV4a 생성은 합성 credential+offline requestHandler로 확인. 4개 template은 essentia 읽기 `validate-template` 통과. validate-template은 nested resource/live creation/IAM/egress 성공의 대체 증거가 아니다.

API/proxy production ZIP에는 package+lock+production dependencies, API native modules와 CA가 필요하다. 이 폴더 node_modules는 로컬 검증용이며 배포 ZIP은 생성하지 않았다. 실제 source commit/ZIP version/hash, 기존 Cognito callback/logout, proxy CONNECT, DB/schema/role, 원본 이관92행, snapshot/index/manifest/sharedassets, CMS canonical API, www UUID 호환, rollback/철회와 staged domain 검증은 부모의 실행 gate다.

Plato 계약: shared assets는 `_next/static|assets`만, RSC `__next.*.txt`는 release-local document. 공개 metadata/index JSON 직접 조회 차단. member allowlist는 published photo 또는 member Markdown image 참조를 검증한 private raster UUID만 포함한다.

Plato 전달 검증: FE snapshot36/release9/typecheck/lint/fixturebuild 통과, 실제 prep57 scoped assets·24JS parse 통과. 이 에이전트가 독립 실행한 suite가 아니며 운영 staged 성공을 뜻하지 않는다.

후속 실제 change-set early validation이 S3 CorsRule의 `ExposeHeaders`를 거부했다. `ExposedHeaders`로 수정하고 공식 nested schema 기반 회귀 테스트를 추가했다. validate-template 통과만으로 resource properties/live create 성공을 주장하지 않는다. 부모는 수정된 template로 private review bundle/change set을 다시 생성해야 하며, 이 작업은 해당 AWS mutation을 하지 않았다.

API/callback의 DB_TLS_SERVERNAME은 DatabaseSecret JSON의 동일 필드를 참조한다. DATABASE_URL은 private IP route를 유지한다. API ZIP의 certs/rds.pem은 PgBouncer frontend root CA를 담아야 하며 direct PostgreSQL migration용 CA와 구분한다. parent runtime에서 servername=검증된 SAN, rejectUnauthorized=true를 적용하고 실제 frontend 접속을 확인한다. SAN/secret/CA 원문은 public artifact에 넣지 않는다.
