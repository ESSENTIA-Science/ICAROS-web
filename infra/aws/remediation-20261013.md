# 인프라 적용 전 검토안 — 2026-10-13

이 문서는 **운영 적용 전 검토용**이다. 이 worktree의 foundation/runtime.blocked는 현재 G 운영 스택의 정본이 아니다. 옵션은 기본 false이며 AWS·Cognito·Secret·알림·배포 변경을 실행하지 않았다. 운영 식별자는 private parameter 파일에서만 관리한다.

## 소스와 적용 위치

| 검토 소스 | 실제 의미 | 준비한 변경의 적용 위치 |
|---|---|---|
| 현재 static worktree `infra/aws/foundation.template.json` | 이전 static foundation 검토 자료 | CMS 배포의 `/admin/assets/*` behavior와 새 cache policy만 활성 배포 정의에 옮긴다. public G 자산 정책에 전체 템플릿을 적용하지 않는다. |
| 현재 `infra/aws/runtime.blocked.template.json` | 이전 CodeBuild/callback runtime 검토 자료 | 활성 HTTP API stage의 AccessLogSettings와 14일 log group 항목만 옮긴다. 전체 runtime을 적용하지 않는다. |
| Web `feature/open-next-publishing-20261005`, `c0870bab510df467ddb72eb3efebbfe0fb9424a9`, `infra/g/production-stack.yml` | OpenNext MainFunction + FIFO RevalidationQueue/Mapping | public CF 5xx는 별도 us-east-1 alarm; FIFO revalidation DLQ를 API G 비동기 failure destination으로 사용하지 않는다. |
| API `feature/g-publication-compatible-20261005`, `ce0d271a15ac193fc3e66a764ff728add6f2b2d2`, `src/handler.ts`·`src/publication-runtime/g-aws.ts` | API self-invocation의 `icaros.g.complete`는 비정상 결과를 throw | `g-async.review.template.json`을 실제 invoke 대상 function/qualifier·role에 매핑한다. 원격 소스 열람은 deployed ZIP 전체의 SHA 일치 증명이 아니다. |
| G Web 동일 revision의 `infra/release/build.mjs` | 이전 CodeBuild 대체 게시 코드도 남아 있음 | 이 inactive entry에도 module root 고정 및 동일 SHA 전후 검사를 보완했다. 기존 SDK stage/timing은 유지한다. G publication의 snapshot pointer 승격과 CodeBuild가 동일 실행 경로라고 취급하지 않는다. |

소스 pin·ZIP 해시·활성 배포 절차는 [운영 대응표](../../docs/operations/current-deployment.md)를 함께 확인한다. G source patch 전제는 `verify-source.mjs`, 관련 테스트, Web browser script/dependencies, workflow/buildspec 검사를 함께 이식하는 것이다. API 배포 ZIP도 동일 API SHA의 `Check API` 결과 artifact를 확인해야 한다. 현재 외부 branch protection/수동 ZIP 배포 gate를 변경하지 않았다.

## W11: 연결·동시성·media throttle

2026-10-13 기존 읽기 증거에서 Lambda account quota/unreserved는 각각 10, API/callback/media reserved는 미설정, HTTP stage default는 rate 2·burst 5이고 route override는 없다. access log도 미설정이다. DB/PgBouncer의 서비스별 hard cap과 부하 peak는 이 작업에서 실측하지 않았다.

`configuration-review.mjs`의 `reviewConcurrency`는 측정값으로 설정안을 검토한다. quota에서 AWS의 100 unreserved를 남길 수 없으면 거부하므로 현 quota10에 예약값을 만들지 않는다. DB planning budget은 `(API(HTTP+G) concurrency + callback concurrency) × 기존 pool max3`이며 G와 HTTP가 같은 API 함수인 경우 두 번 합산하지 않는다. 이것은 실행 중 연결 계획 수치이며 idle warm pool 수까지 제한하는 증거가 아니다. 별도의 PgBouncer/DB hard cap 검증도 필수다. [AWS reserved concurrency 제약](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html).

승인된 측정표에는 quota·타 서비스 예약량/peak·API/G/callback/media concurrency·timeout·DB max_connections·PgBouncer mode와 server/client limits·타 서비스 연결량·ICAROS budget·media peak/RPS/p95를 각각 기록한다. pool max를 늘리지 않는다. quota 증설 및 부하 측정 후 설정안의 예약량과 media burst를 결정한다. `mediaRate`와 `mediaBurst`는 GET+HEAD 합산 예산이다. 측정한 GET 비율 `mediaGetWeight`(0<값<1)로 rate/burst를 나누며 각 route의 burst는 양수이고 두 burst 합계는 media concurrency 이하이다. 예산 rate6/burst12·GET비율0.75이면 GET4.5/9, HEAD1.5/3이다. `mediaPeakConcurrency`도 두 method 합산 측정값이다. `stageRouteSettings`는 GET/HEAD media 두 route의 throttle property만 병합하고 기존 administrator defaults/다른 route settings를 보존한다. rate/burst는 best effort이며 실제 Lambda throttle·429·DB connections·게시 지연을 함께 확인해야 한다. [HTTP API throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html).

rollback은 변경 직전 function reservation·stage defaults/route overrides를 private evidence로 보존하고 그 값으로 복원한다. 현재 자료 기준 reserved 미설정, default2/5, overrides빈값은 참고 값이며 적용 시 다시 읽는다. 기존 callback DLQ 메시지는 보존하고 purge하지 않는다.

## W12: 응답·G 실패·알림

`alerts/template.mjs` → `template.json`은 HTTP/media/G 신호를 독립 opt-in으로 추가한다. HTTP API는 `AWS/ApiGateway`의 소문자 `5xx`, `ApiId+Stage` dimensions를 사용해 정상 Lambda return의 503도 감지한다. Media log filter 계약은 `{event:"media.response",statusCode:<number>,functionName:<Lambda function>,logGroup:<Lambda log group>}` → `ICAROS/HTTP Media5xx`다. MetricTransformation의 FunctionName/LogGroup dimensions는 해당 로그 필드를 추출하고 alarm은 검증한 `MediaFunctionName`/`MediaLogGroupName`과 정확히 일치시킨다. 따라서 staging과 production 같은 metric name을 섞지 않는다. 이름은 Lambda 내장 환경변수만 읽으며 requestId/IP/사용자값을 dimensions로 넣지 않는다. dimensions가 있는 metric filter에는 DefaultValue를 설정하지 않는다. [CloudFormation metric dimension 계약](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-logs-metricfilter-dimension.html). method/requestId 등 안전한 필드만 허용하고 route 원문·query·IP·본문·토큰·exception message를 access log에 넣지 않는다. API access logs는 14일, 기존 notifier logs는 30일이다. [HTTP API metric 이름·dimension](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html).

G errors/throttles/AsyncEventsDropped/DestinationDeliveryFailures/standard failure queue depth는 `EnableGSignals`로 활성화한다. `GFunctionName`은 OpenNext public 함수가 아니라 G completion을 받는 API 함수다. G oldest job age는 별도 `EnableGJobAgeSignals=false`다. `ICAROS/Publication OldestActiveJobAgeSeconds`, `FunctionName=<검증한 G API 함수 이름>`에 durable DB 상태를 읽는 producer가 매분 값(작업 없음=0)을 내야 한다. producer가 현재 없고 ledger에 immutable created_at이 없으므로 완료로 보고하지 않는다. 60초 durable lease가 재설정되는 시각을 total job age로 사용하지 않는다. producer검증 플래그 없이 활성화하면 CFN rule이 거부하며, 활성화 후 heartbeat가 없어지면 missing data를 breaching으로 감지한다.

G async failure review template은 14일 보존·SSE·Retain 표준 SQS, 정확한 queue ARN의 sqs:SendMessage role grant, function/qualifier별 EventInvokeConfig를 갖는다. 기본 false `EnableGReconcile`은 rate(1 minute) EventBridge가 `{kind:"icaros.g.reconcile"}`만 검증한 G API function/alias에 보내는 설정안이다. 기존 표준 `ExistingGFailureQueueArn`과 `EnableGAsyncFailure=true`가 없으면 CFN rule이 거부한다. target·LambdaPermission function ARN·EventInvokeConfig qualifier는 같은 입력을 쓰고 permission SourceArn은 exact rule이다. handler는 trusted worker auth·G mode·60초 durable lease·1job/dispatch 계약을 지켜야 한다. 같은 function/qualifier의 async config를 다른 stack에서 중복 관리하지 않는다. 기본 검증 사용 경로는 base $LATEST와 같은 async config다. alias/version은 후속 completion self-invoke가 같은 qualifier인 증거 없이는 켜지 않으며 AliasCompletionQualifierVerified=false gate가 이를 거부한다. 새 운영 env를 요구하지 않는다. 설정안은 기존queue를 유지하고 다음delivery를 위한 rule생성은 asyncconfig뒤에 한다. 기존 callback DLQ를 옮기거나 purge하지 않는다. 자세한 [worker 계약](README.md#g-trusted-worker-계약과-동일-sha-gate)을 따른다. alias/버전·event age·retry를 기존 값과 비교하고 invocation이 `$LATEST`인지 별도 qualifier인지 확인한다. timeout/오류가 throw되는지 staging에서 확인한 후 연결한다. FIFO SQS는 Lambda async destination으로 사용할 수 없다. OpenNext FIFO queue의 redrive와 별개다. [async destination·role permission](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-retain-records.html), [FIFO 제약](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-eventinvokeconfig-destinationconfig.html).

regional alarms는 기존 EnableDelivery의 EventBridge → notifier → 채널 경로로 연결된다. CloudFront `5xxErrorRate`는 us-east-1 전용 `alerts/global.template.json`으로 분리했다. `EnableSignals=false`, `EnableNotifications=false`이며 활성화 시 검증된 기존 us-east-1 SNS topic/subscription ARN에 ALARM/OK를 전달한다. 다른 region에서는 리소스가 생성되지 않고 출력에 disabled/wrong-region이 표시된다. [CloudFront metric region/statistic](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/programming-cloudwatch-metrics.html).

실제 알림 전달은 미검증이다. staging에서 dependency throw→HTTP503/media503→metric→ALARM→확인된 수신자→runbook 링크, G async 실패→queue→alarm, age heartbeat중단을 각각 검증한다. alarm·custom metric·SNS·보관 비용도 승인 전 견적을 남긴다. CloudFront 기본 5xx metric에는 추가 상세 metric subscription이 필요하지 않는다. 새로운 DLQ는 실패 원문 payload를 담을 수 있으므로 수신 권한과 14일 보관을 검토한다. queue삭제/purge를 복구로 취급하지 않는다.

## W13: 동일 SHA와 실제 runner

Web/API workflow는 모든 push와 PR에 검사한다. 마지막 단계만 SHA가 GITHUB_SHA와 같음을 확인한 `web-verification-<SHA>`/`api-verification-<SHA>` artifact를 만든다. Web은 workspace checks, `npm run test:infra`(infra/egress29개·nested media·Web-only legacy safety·local target), fixture/CMS build, 실제 browser runner를 요구한다. `test:infra`는 workspace npm test와 독립 실행되며 release gate도 동일 script를 사용한다. API는 postgres:17-alpine을 명시 pull한 뒤 격리 runner `npm run test:postgres`를 실행한다. 원격 GitHub 실행·branch protection의 필수 check 등록은 미실행이다.

static release build는 clean approved HEAD를 확인하고 typecheck/lint/unit/all infra/browser를 실제 실행한 후에야 첫 AWS 동작을 시작한다. export 후 업로드 직전 source를 다시 확인한다. 검사 실패/dirty tracked/untracked source/SHA변경이면 manifest와 upload로 진행하지 않는다. 개발 중의 `npm test`에는 clean HEAD 요건을 넣지 않았다. buildspec은 기존 pinned dependency로 nested infra SDK와 Chromium을 설치한다. CodeBuild image의 browser OS dependency/egress가 가능한지 staging에서 확인한다.

## W15: MFA 등록·필수화·분실 복구

기존 Cognito pool을 재생성하지 않는다. 현재 읽기 증거는 MFA OFF다. 관리자가 모두 기존 pool에 속하는지, recovery담당 2인·개별 enrollment·복구권한 보유자가 정해졌는지 먼저 확인한다. software token TOTP를 staging에서 등록하고 정상 로그인, 틀린 코드 거부, API 세션 만료/재로그인, logout후 재로그인, 분실→재등록을 검증한다. `OPTIONAL`은 이행 단계로만 사용하며 Cognito managed login은 optional일 때 enrollment를 자동으로 요청하지 않으므로 전원 등록 증거를 별도 확보한다. [Cognito MFA enrollment](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html).

`reviewMfa`는 총 관리자 수가 1 이상이고 전원 등록 수가 일치하며 recovery/staging 검증이 true여야 `SetUserPoolMfaConfig`의 ON+SoftwareToken Enabled 입력 fragment를 만든다. 사용자 pool ID는 포함하지 않고 private 입력에서 지정한다. 이 함수는 AWS API를 호출하지 않는다. 등록 누락을 OPTIONAL설정만으로 완료 처리하지 않는다.

분실 복구는 승인된 운영자가 본인 확인과 2인 검토 후 해당 사용자만 `AdminDeleteSoftwareToken`으로 기존 TOTP association을 제거하고 다음 로그인에서 MFA_SETUP·새 TOTP를 검증하는 경로를 staging에서 연습한다. 전체 pool MFA를 OFF로 내려 복구하지 않는다. 기존 `AdminSetUserMFAPreference`는 TOTP 자체를 reset하지 않는다. 새 reset API가 설치된 CLI/SDK/region에서 지원되는지 확인한다. [2026-08 Cognito TOTP reset API](https://aws.amazon.com/about-aws/whats-new/2026/08/amazon-cognito-totp-reset/), [TOTP 재등록 동작](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html).

rollback은 이전 MFA설정 private snapshot과 등록 상태를 유지하고 검증된 담당자만 검토한다. OFF전환은 password만으로 진입하는 기존 위험을 복원하므로 별도 승인과 session폐기 판단이 필요하다. 이 작업에서는 실제 계정 등록·권한·MFA·세션을 변경하지 않았다.

## W18: CMS assets와 HTML

기존 읽기 증거의 CMS default/API behaviors는 TTL0, compression cache flags가 false이며 public hashed assets는 별도 수정 대상이 아니다. `EnableCmsHashedCache=false`인 foundation 옵션은 `/admin/assets/*`에만 연1 cache, MinTTL0, Gzip/Brotli+Compress를 붙인다. CMS router association과 HTML default TTL0/API 정책을 유지한다. [CloudFront 압축의 세 옵션](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html).

활성 배포 정의에 이 behavior만 옮기기 전, Vite generated hash JS/CSS만 이 prefix에 업로드하는지 검증한다. HTML은 no-store로 올리고 이전 hashed assets는 덮어쓰기/삭제 없이 보존한다. 새 assets 업로드→모든 key접근 검증→HTML 교체 순서다. 새 배포/오래된 탭/rollback에서 참조 key가 남고 gzip/br·cache hit가 관측되어야 완료다. rollback은 이전 HTML과 cache behavior snapshot으로 복원하고 옛 assets를 삭제하지 않는다. 실제 응답 hit/encoding 검증은 미실행이다. snapshot revision feed 재사용은 public FE 담당 범위다.


## G branch remediation port의 검증 범위

이 G worktree에 가져온 검토 자료는 기본 false의 G async failure/reconciliation template, 해당 계약 test와 docs다. 원본에 없는 alerts/legacy safety suite는 포팅하거나 G CI에 참조하지 않았다.

실제 G Web/API workflow는 모든 push와 PR, contents:read, 같은 GITHUB_SHA와 clean checkout 검사를 통과한 마지막 단계의 receipt 발급을 갖는다. G Web에는 실제 Playwright browser runner, 기존 suite만 명시한 test:infra(egress29 포함), current-build OpenNext fixture와 generated member freshness gate를 연결했다. G API에는 disposable PostgreSQL17 integration gate를 연결했다. G OpenNext config/production stack/versioned cache/ISR을 보존했다.

G 전용 verify:g와 build:g:fixture는 module root에서 Git/npm 검사를 수행하고 supplied revision이 있으면 build 전후 같은 clean SHA를 요구한다. 로컬 dirty fixture build는 synthetic 검증이며 receipt를 발급하지 않는다. 보존된 inactive static infra/release/build.mjs에도 첫 AWS 이전 full verifySource와 upload 이전 assertSource, Git/npm/AWS CLI/output의 module root 고정을 적용했다. 기존 G SDK 업로드/병렬 staging은 유지한다. 위 W13 공통/static 설명에 나오는 미포팅 legacy/alerts/buildspec은 G의 실행 gate가 아니다.

**W13 PARTIAL — 코드 잔여:** 현재 저장소에서 실제 G Lambda ZIP packaging/deploy entry가 확인되지 않아 verify:g/동일 SHA receipt를 그 실행 경로에서 강제 소비하도록 연결하지 못했다. inactive static entry 보완은 이 연결을 대신하지 않는다. 원격 required check 등록·runner 실행·배포 ZIP hash/sourceRevision 증거도 미검증이다. source pin만으로 deployed wrapper/visible helper가 같은 ZIP에서 왔다고 증명할 수 없다. current privacy authority 연결, template 활성화·schedule 생성·배포는 수행하지 않았다.
