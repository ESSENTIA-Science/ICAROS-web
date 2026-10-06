# 최신 승인과 적용 범위

**사용자는 남은 작업을 모두 승인했다.** 신규 인프라·IAM·DB schema·TLS(필요 시 재시작)·필요성 재확인을 마친 기존 EC2 proxy 사용이 승인됐다. 추가 승인 질문은 필요 없다. 이번 에이전트는 요청된 artifact만 작성하며 AWS mutation·서버·commit을 수행하지 않는다.

도메인 전환은 staged 검증 후, 기존 Vercel 제거는 테스트된 cutover 후라는 실행 조건을 유지한다. 승인 상태와 기술 검증 상태는 별개다. `CompatibilityReviewed=false`는 미검증 runtime의 실행 gate이며 사용자 미승인을 뜻하지 않는다.

## 승인된 구체 범위

- Foundation: release+snapshot/private media/public media/CMS 버킷 4개 및 optional artifact bucket, public/CMS/media CloudFront 3개, OAC/functions/KVS, source SHA pinned FE CodeBuild·IAM·logs. 초기 disabled/no aliases, versioning/encryption/public block·Retain 정책.
- Network: 기존 backend EC2의 private IPv4 CONNECT proxy3128. Lambda 전용 subnet/route table/SG·S3 gateway endpoint, Lambda SG → proxy /32:3128, DB SG:5432, S3 managed prefix443. 필요 시 기존 backend SG에 Lambda SG source3128 ingress 추가. proxy mode는 NAT/EIP/public subnet/default internet route를 만들지 않는다. NAT는 선택된 배포안이 아니다.
- DB: parent가 TLS verify-full과 백업을 확인했으며 재시작 없이 TLS 활성화 완료했다고 보고했다. DB schema/migrations와 새 runtime login `icaros_lambda`가 `icaros_app`을 상속하는 구성을 준비한다. 기존 legacy login/password 보존, `public` schema 변경 금지. migration008 추가3컬럼 포함 실제 적용·grant 검증은 부모 담당이다.
- Runtime: private API artifact+별도 media-proxy ZIP, JSON Secret의 DATABASE_URL key, CA file, versioned artifact/hash, 기존 Cognito pool/client/group 재사용 및 callback/logout URL 확인. 새 Cognito pool 생성 없음.
- Content/media: local CMS 콘텐츠가 정본. 기존 private 원본 ready92행을 새 foundation private bucket으로 이관하는 작업은 부모 담당이다. member 사진은 private published copy/no-store UUID route, 다른 공개 media는 별도 public CDN. 미선별 원본 전체 공개 금지.
- Domains: public/CMS 분리, CMS same-origin API, public www의 기존 UUID media 호환. 실제 alias·origin·certARN은 private parameters만 사용한다. simulation host의 사용자 지정 표기는 유지한다. Cloudflare DNS이며 Route53 생성·NS 이전 없음. parent 요청 ACM은 현재 DNS validation pending이라고 보고됐다.
- Publication/cutover: 검증된 source commit 뒤 foundation 적용, staged E2E 뒤 domain 전환, 테스트된 cutover 뒤 Vercel 제거. 첫 pointer·자동게시·rollback에도 검증된 release/hash와 실행 정책을 적용한다.

## 비용과 운영 차이

| 방식 | 추가 고정비/월(730h) | 운영 차이 |
|---|---|---|
| 선택된 기존 EC2 proxy | 기존 용량·IP 재사용 시 증분 고정비가 거의 없을 수 있음. 실제 여유/운영비 미측정 | EC2/OS/proxy patch·allowlist·capacity·health 책임, 기존 backend와 장애 공유 |
| 미선택 단일 서울 NAT+IPv4 | 약 **$46.72**, 처리량 **$0.059/GB** 추가 | 관리형, SDK proxy 배선 불필요; 단일 AZ 장애 범위 |
| 검토했던 IPv6 egress-only | gateway 자체 추가 요금 없음 | 모든 호출의 IPv6/private 접근 요구. 현재 선택안 아님 |

2026-10-03 essentia 읽기 Price List 조회 기준 NAT $0.059/h, IPv4 $0.005/h. AZ별 NAT2개면 고정비 약 $93.44/월. 전송·세금·환율·다른 서비스 제외. [NAT/IPv4 공식 요금](https://aws.amazon.com/vpc/pricing/), [서울 Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-2/index.json).

S3 retained versions/releases/artifacts, CloudFront 요청/전송, CodeBuild 실행분, Lambda/HTTP API/KVS/SQS/logs는 별도다. 전체 월비용 상한은 트래픽·보존량 없이는 확정하지 않는다. S3 gateway endpoint 자체는 시간·처리량 요금이 없다. 개인정보 철회와 retained release/public immutable 보존은 별도 운영 절차가 필요하다.
