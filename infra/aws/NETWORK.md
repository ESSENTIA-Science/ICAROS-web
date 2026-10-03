# Egress 선택 검토 — 적용하지 않은 artifact

**최신 결정: proxy 필요성 재확인 완료 및 사용 승인. 현재 선택안은 기존 EC2 private CONNECT proxy3128. NAT 미선택. 아래 IPv6 검토 기록은 대안 조사이며 선택안을 되돌리지 않는다. 실제 설치·연결 검증은 부모 담당이고 이 작업은 mutation하지 않는다.**

| 방식 | 추가 고정비 | 운영 차이 | 판정 |
|---|---|---|---|
| Dual-stack + egress-only IGW + private ESSENTIA | gateway 자체 추가 요금 없음; 전송/기타 서비스 별도 | IPv4 private DB 유지. 모든 외부 호출에 실제 IPv6 endpoint/SDK 경로 필요. IPv4-only 인터넷은 접근 불가 | 조사한 미선택 대안 |
| 기존 EC2 CONNECT proxy | 기존 용량/IP 재사용하면 증분 고정비가 거의 없을 수 있음. 용량 미확인 | OS/proxy patch·장애·용량·allowlist·로그 운영, 기존 workload와 장애 공유. SDK agent 및 fetch/JWKS/OAuth 별도 배선 | 필요성 재확인 완료·승인된 선택안; 실제 용량/연결 검증 필요 |
| 단일 NAT Gateway + IPv4 | 서울 약 $46.72/month + $0.059/GB, 전송/세금 별도 | 애플리케이션 proxy 배선 불필요, 관리형. 단일 AZ NAT 장애가 두 subnet에 영향 | 미선택, template은 대안 초안 |

가격은 APPROVALS.md의 읽기 조회 기준이다. [Egress-only gateway 자체 무과금](https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html). NAT 처리량이나 전체 서비스 비용이 무료라는 뜻은 아니다.

## 확인한 것과 미확인

부모 DNS 조회: Cognito JWKS AAAA 3, managed login AAAA 2, CodeBuild dualstack AAAA 1. ESSENTIA AAAA 0. VPC IPv6 CIDR 없음. DNS 주소 수는 연결 성공의 증거가 아니다.

- Lambda는 dual-stack subnet과 `Ipv6AllowedForDualStack=true`가 필요하다. VPC/subnet IPv6 CIDR, `::/0` egress-only IGW route, IPv6 SG/NACL/DNS와 양쪽 subnet 검증이 필요하다. 현재 runtime default=false이며 NAT network template에는 IPv6 구성 자체가 없다. [Lambda 공식 설정](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- S3는 현재 gateway endpoint/private IPv4 경로 사용 여부를 먼저 확인한다. 무조건 모든 SDK에 dualstack을 켜면 S3 endpoint 경로가 달라질 수 있다.
- CodeBuild SDK의 실제 resolved endpoint는 default IPv4와 dualstack을 구분해 확인한다. Cognito는 JWKS뿐 아니라 token exchange와 managed login까지 실제 origin URL/TLS를 확인한다.
- KVS 실제 서명은 `@aws-sdk/signature-v4a` side-effect 등록 후 offline transport까지 통과했다. 이는 DNS/TLS/IPv6 성공을 의미하지 않는다. 합성 계정 endpoint DNS의 A/AAAA 0 결과는 실제 endpoint 판정에 쓰지 않는다. 실제 ARN으로 resolved host를 private 경로에서 조회하고 주소·endpoint 원문을 출력하지 않은 채 AAAA와 IPv6 연결을 확인해야 한다. CloudFront 일반 서비스 IPv6 지원 표만으로 KVS data API 지원을 확정하지 않는다.
- ESSENTIA public AAAA가 없으므로 private IPv4 HTTPS 경로가 핵심이다. private DNS/IP, 같은 VPC 또는 승인된 연결, SG/NACL/route, TLS hostname/SNI/인증서, 포트와 실제 응답을 확인한다. HTTPS를 IP로 바꿔 인증서 검증을 끄는 방식은 제외한다.
- Runtime에서 쓰는 Secrets Manager/KMS/STS 등 추가 SDK 호출과 인증 credential 공급을 inventory에 포함한다. 서비스 이름의 IPv6 지원과 현재 선택된 endpoint는 별개다.

## 당시 IPv6 필요성 검토 기준 (현재 proxy 선택 완료)

모든 호출이 IPv6 또는 검증된 private IPv4로 성공하면 NAT/proxy를 배포하지 않는 안을 선택할 수 있다. 하나라도 외부 IPv4-only 호출이면 IPv6 egress-only만으로 해결되지 않으므로 승인된 proxy 또는 아직 미선택인 NAT 대안을 다시 비교한다. IPv6 대안을 선택한다면 VPC IPv6 변경과 실제 staged Lambda 검증이 필요하다는 당시 판정이다. 현재 proxy 선택안은 IPv6 변경을 요구하지 않으며 실제 CONNECT/E2E 검증을 요구한다.

`HttpProxyUrl` parameter는 API/callback에 **ICAROS_HTTPS_PROXY**와 HTTP_PROXY/HTTPS_PROXY를 전달한다. 부모의 실제 `src/egress.ts`/handler에서 NodeHttpHandler+HttpsProxyAgent, Undici ProxyAgent fetch, JWKS SimpleFetcher agent 배선을 읽어 확인했다. 부모는 SDK/split publisher 통합 완료를 보고했다. 이 배선의 Linux package·실제 CONNECT·Cognito/ESSENTIA/KVS E2E 성공은 별도 검증이다. [SDK v3 공식 proxy 배선](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-configuring-proxies.html)

CONNECT proxy라면 SourceDestCheck를 NAT instance처럼 끌 필요가 없다. Lambda SG만 proxy listener에 허용하고 public/open proxy를 만들지 않는다. destination allowlist, private 주소 SSRF 방어, TLS passthrough, metadata 주소 차단, secret 없는 로그, health/capacity/patch/rollback이 운영 gate다. 이번 작업은 설치·SG·route 변경을 수행하지 않았다.

Proxy mode network template은 모든 NAT/EIP/public subnet/default internet route를 UseNat condition으로 제외한다. SG3128은 검증된 private IP /32만, proxy ingress는 Lambda SG만 허용한다. S3PrefixListId는 지역 managed prefix list를 private 읽기 조회로 확인해 입력한다. ManageProxyIngress/ManageDbIngress 기본false는 기존 SG를 자동 변경하지 않는 안전한 적용 선택값이다. 부모는 승인된 구체 값으로 true 적용 여부를 정할 수 있다.
