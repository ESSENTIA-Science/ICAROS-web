# 기존 EC2의 HTTPS CONNECT egress

부모 작업자가 배포하는 ARM64 Squid artifact. **기존 ESSENTIA API EC2에만** 설치한다.
DB 인스턴스에는 설치하지 않는다. 새 EC2·NAT Gateway·IPv4 주소를 만들지 않는다.
기존 EC2의 인터넷 경로와 기존 주소를 사용한다. 배포·SG·Lambda 설정 변경은 이 renderer가 수행하지 않는다.

## 정책

- 입력 `privateIpv4`의 **한 주소에만 TCP 3128 bind**. Docker host network로 Lambda 원본 source IP를 보존한다.
- `lambdaCidrs`의 canonical RFC1918 IPv4 `/16..32`만 허용한다. 실제 Lambda subnet CIDR을 넣는다.
- **CONNECT method + 목적지 443 + 정확한 CONNECT hostname**을 모두 만족해야 허용한다.
- `dstdomain -n`은 IP literal의 reverse DNS 변환을 하지 않는다. leading-dot/wildcard 없이 exact host만 쓴다.
  anchored `url_regex`도 `hostname:443` CONNECT authority에 적용한다.
  [Squid v5 effectiveRequestUri](https://github.com/squid-cache/squid/blob/v5/src/HttpRequest.cc)는 CONNECT를 parsed `host:port`로 제공한다.
  이 ACL은 **GET의 URL allowlist가 아니라 CONNECT의 목적지 allowlist**다. GET/POST/HEAD/OPTIONS/TRACE는 거절한다.
- 알 수 없는 host·subdomain·IP literal·다른 port·다른 source CIDR·proxy credentials는 거절한다.
- TLS decrypt/`ssl_bump` 없음. HTTP response/object cache 없음. access/store/cache 로그와 Docker 로그를 비활성화한다.
  토큰·인증 헤더·본문은 종단 간 TLS 안에 있으며 proxy 설정에 credential을 넣지 않는다.
- CONNECT authority만 검사한다. 터널 내부 HTTP Host/path, SNI, TLS payload는 검사하지 않는다.
  Lambda 클라이언트가 원래 목적지의 TLS certificate를 계속 검증해야 한다.
- source IP별 동시 연결 16, fd 256, PID 64, 짧은 연결/읽기 timeout.
  기존 API 요청 제한에 맞춰 Lambda 연결 pool·timeout도 부모 작업에서 제한한다.

Squid의 [ACL 정의](https://www.squid-cache.org/Doc/config/acl/),
[http_access](https://www.squid-cache.org/Doc/config/http_access/),
[cache_dir 기본값](https://www.squid-cache.org/Doc/config/cache_dir/)을 따른다.
Debian bookworm의 [Squid ARM64 패키지](https://packages.debian.org/bookworm/squid)를 설치하며 외부 proxy image를 쓰지 않는다.

## 설정 입력 — 실제 값은 비공개 파일만

`config.example.json`은 placeholder다. 실제 private IPv4, CIDR, account별 endpoint를 commit하지 않는다.
렌더러는 URL 대신 **소문자 hostname**을 받는다. scheme/path/port/credentials/trailing dot/wildcard/추가 key를 거절한다.

| `hosts` key | 부모 작업자가 넣을 값 |
| --- | --- |
| `cognitoAuth` | 기존 Cognito auth domain의 hostname. custom domain도 실제 사용 host 그대로 |
| `cognitoJwks` | user pool issuer/JWKS URL의 hostname (`cognito-idp.<region>.amazonaws.com` 형식) |
| `essentia` | 실제 ESSENTIA HTTPS origin hostname. port 443의 기존 TLS endpoint 필요 |
| `codebuild` | 실제 AWS SDK가 선택한 CodeBuild HTTPS endpoint hostname |
| `kvs` | 실제 SDK가 KVS ARN으로 선택한 account별 `<account>.cloudfront-kvs.global.api.aws` hostname |

AWS endpoint를 suffix 전체로 허용하지 않는다. region/FIPS/endpoint override를 바꾸면 부모가 **새 실제 hostname**으로 재렌더한다.
KVS endpoint는 현재 설치 SDK `@aws-sdk/client-cloudfront-keyvaluestore` endpoint ruleset에서 확인했다.
S3는 기존 VPC gateway endpoint로 직접 접근하며 이 host allowlist에 포함하지 않는다.
Lambda의 `ICAROS_HTTPS_PROXY=http://<기존-EC2-private-IPv4>:3128`은 부모의 검증된
undici/HttpsProxyAgent 연결을 사용한다. Cognito auth/JWKS, ESSENTIA, CodeBuild/KVS 각각 적용해야 한다.
단순히 환경 변수만 설정해서 모든 SDK가 자동으로 proxy를 쓰는 것으로 가정하지 않는다.

```sh
node infra/egress/render-config.mjs /private/path/egress.local.json /private/path/rendered-egress
node --test infra/egress/config.test.mjs
```

renderer는 DNS/네트워크/환경 변수를 읽지 않는다. 두 출력 파일은 mode 0600으로 신규 생성하며
기존 파일은 덮어쓰지 않는다. 실패 메시지는 입력 내용·host·주소·parser details를 출력하지 않는다.
출력: `squid.conf`, `icaros-egress.service`. 생성된 private 출력은 저장소 밖에 둔다.

## ARM64 image artifact와 배포

아래는 **부모 배포용 절차**다. 이 작업자는 EC2/AWS에 적용하지 않는다.
이미지를 별도 ARM64 builder에서 만들고 전달하면 기존 EC2에서 apt/build를 돌릴 필요가 없다.

```sh
docker build --platform=linux/arm64 --tag icaros-egress:approved infra/egress
docker save --output /private/path/icaros-egress-arm64.tar icaros-egress:approved
```

기준 image는 Docker Official `debian:bookworm-slim`이다. `policy-rc.d`로 image build 중 package service 시작을 막는다.
base/tag 및 Debian security update는 가변이므로 부모가 image ID·base digest·Squid package version·artifact SHA-256을 기록한다.
런타임은 root가 아닌 Debian `proxy` 사용자다. `/etc/squid/squid.conf`는 필수 mount이며 기본 설정을 image에서 제거하여
mount가 없을 때 개방된 proxy로 실행되지 않는다.

부모는 **기존 API EC2**에서 image를 load하고 Docker의 `proxy` UID/GID를 확인한 뒤 배포한다.
`install`의 UID/GID는 image에서 확인한 값으로 대체한다(운영에서 이름이 같다고 host UID가 같다고 가정하지 않는다).

```sh
docker load --input /private/path/icaros-egress-arm64.tar
docker run --rm --network=none --entrypoint /usr/bin/id icaros-egress:approved proxy
install -d -m 0700 /etc/icaros-egress
# 아래 UID/GID는 image에서 확인한 실제 숫자로 지정한다.
install -o PROXY_UID -g PROXY_GID -m 0400 /private/path/rendered-egress/squid.conf /etc/icaros-egress/squid.conf
install -o root -g root -m 0644 /private/path/rendered-egress/icaros-egress.service /etc/systemd/system/icaros-egress.service
```

listener를 시작하기 **전에** 같은 image의 실제 Squid parser로 config를 검사한다.
아래 one-shot은 network=none이며 `-k parse`는 listener를 열지 않는다.
parser는 host/CIDR 등 설정을 출력할 수 있으므로 출력은 버리고 exit code로 확인한다. 실패 분석 출력은 부모의 비공개 위치에서만 취급한다.

```sh
docker run --rm --platform=linux/arm64 --network=none --user=proxy --read-only --cap-drop=ALL --security-opt=no-new-privileges:true --memory=128m --memory-swap=128m --cpus=0.25 --pids-limit=64 --ulimit=nofile=256:256 --log-driver=none --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8m,mode=1777 --mount=type=bind,src=/etc/icaros-egress/squid.conf,dst=/etc/squid/squid.conf,readonly --entrypoint=/usr/sbin/squid icaros-egress:approved -k parse -f /etc/squid/squid.conf -d 0 > /dev/null 2>&1
```

부모가 확인할 배포 조건:

1. 실제 private IPv4가 이 API EC2의 NIC에 있고 3128이 비어 있어야 한다. DNS가 다섯 목적지를 해석하고 기존 EC2 경로로 443에 닿아야 한다.
2. 기존 API EC2 SG의 inbound3128을 **Lambda SG만** 허용한다. host ACL에는 실제 Lambda CIDR만 넣는다.
   public3128/전체 VPC inbound를 열지 않는다. host network에는 Docker `-p`/bridge SNAT를 추가하지 않는다.
3. Docker engine이 이미 설치/운영 가능한지와 host memory headroom을 확인한다. container의 **128 MiB/0.25 CPU hard limit**에 Docker daemon overhead는 포함되지 않는다.
   이 artifact는 운영 RSS/처리량을 측정한 결과가 아니다.
4. parser 통과 후 부모가 `systemctl daemon-reload`와 `systemctl enable --now icaros-egress.service`로 시작한다.
5. 실제 Lambda 경로에서 다섯 허용 host CONNECT:443 성공 및 unknown host/IP/port/plain GET/외부 source 거절을 검사한다.
   테스트 클라이언트에서 token/credentials/body를 출력하지 않는다. 기존 ESSENTIA API latency/memory와 container OOM/restart count를 함께 확인한다.

unit은 `Type=oneshot` + `RemainAfterExit=yes`, Docker는 `--restart=unless-stopped`다.
부팅/수동 unit restart는 기존 **동명 container만** 교체한다. image inspect 실패 시 기존 container를 제거하지 않는다.
고정 resource/security options: 128 MiB, swap 추가 없음, CPU 0.25, read-only root, capabilities 전체 제거,
no-new-privileges, nonroot, `/tmp` 8 MiB tmpfs, 로그 driver none.
Docker 재시작은 engine이 관리하므로 `systemctl is-active`만으로 건강 상태를 판정하지 않는다.
부모는 `docker inspect`의 State/OOMKilled/RestartCount와 credential 없는 실제 연결 검사를 사용한다.
중단은 `systemctl stop icaros-egress.service`이며 다른 API container나 DB에는 영향을 주지 않는다.

## 검증 경계

`config.test.mjs`는 생성된 ACL을 독립적인 제한된 evaluator로 읽어 allow/deny 회귀를 검사한다.
renderer 자체와 별개로 exact CONNECT authority, `dstdomain -n`, source CIDR, method/port 순서를 검사한다.
이미 Squid가 분리한 host/port를 대상으로 하며 raw HTTP request parser는 모델링하지 않는다.
이는 실제 네트워크 요청을 Squid에 보낸 통합 테스트가 아니다.
실제 image build와 **one-shot Squid config parse**는 로컬에서 검증할 수 있으며 proxy server는 시작하지 않는다.
운영 CONNECT·DNS·TLS 성공 및 리소스 headroom은 부모의 실제 배포 검증 단계에 남는다.
