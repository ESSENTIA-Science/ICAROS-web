# ICAROS 게시 관측과 알림

이 폴더는 운영 게시 경로와 분리된 CloudWatch 경보·Slack/Discord 알림 스택이다. **현재 webhook이 없어 실제 전송은 구성하거나 확인하지 않았다.** `EnableDelivery=false`가 기본이다. 2026-10-04 운영에는 이 상태로 API/callback 오류·스로틀과 callback 전달 실패 큐의 CloudWatch 경보 5개를 적용했다. 알림 Lambda·로그 구독·EventBridge rule·IAM role은 생성되지 않았다. Delivery 활성화는 webhook Secret 준비와 별도 운영 변경 검토 후 진행한다.

## 신호와 의미

| 신호 | 출처 | 해석 |
|---|---|---|
| 빌드 종료 | CodeBuild `Build State Change` → EventBridge | `SUCCEEDED`는 빌드 성공이고 **게시 승격 확인 대기**다. 실패·중단·timeout도 알린다. [AWS CodeBuild 이벤트](https://docs.aws.amazon.com/eventbridge/latest/ref/events-ref-codebuild.html)는 best effort 전달이다. |
| 게시 종료 | callback Lambda의 `publication.terminal` JSON log → CloudWatch Logs subscription | 실제 callback 응답이 `published` 또는 `failed`로 종료한 뒤에만 게시 완료/실패를 알린다. API callback의 해당 로그가 운영 ZIP에 반영돼야 한다. CloudWatch Logs 구독 payload는 [gzip/base64](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html)다. |
| 운영 경보 | API/callback/알림 Lambda `Errors`, callback `Throttles`, callback EventBridge/async DLQ visible depth, alert DLQ depth, alert EventBridge `FailedInvocations` | `Errors`는 Lambda 예외와 timeout을 포함한다. `ALARM`과 `OK` 상태 전환을 알리되, `OK`가 게시 성공을 증명하지는 않는다. [CloudWatch alarm 이벤트](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-and-eventbridge.html)는 EventBridge로 전달된다. |

callback 로그 입력 계약:

```json
{"event":"publication.terminal","status":"PUBLISHED","jobId":"job-id","version":12,"attempt":1}
```

실패는 `status="FAILED"`. 이 로그는 callback HTTP 200과 실제 terminal job 응답을 확인한 뒤 기록한다. `jobId` 원문은 CloudWatch 로그에만 남으며 채널 메시지는 SHA-256 앞 12자만 사용한다. 임의의 에러 메시지·본문·계정·이메일·Secret·webhook URL은 채널과 notifier 로그에 싣지 않는다. 동일 job/version/attempt/status/channel은 DynamoDB 조건부 claim으로 중복 전달을 억제한다. HTTP 응답이 유실된 경우 채널 전달 여부를 확정할 수 없어 재시도 중 중복이 가능하다. 각 채널은 독립 claim이라 한 채널만 실패하면 그 채널만 재시도한다.

## webhook 준비와 적용 순서

1. [Slack incoming webhook](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)용 전용 채널과 [Discord server integration webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks)용 전용 채널을 만든다. URL을 티켓·터미널 출력·저장소에 붙이지 않는다.
2. 저장소 밖 0600 파일에 `{"SLACK_WEBHOOK_URL":"<Slack URL>","DISCORD_WEBHOOK_URL":"<Discord URL>"}` JSON을 작성한다. 승인된 AWS 계정에서 [Secrets Manager `create-secret --secret-string file://...`](https://docs.aws.amazon.com/cli/latest/reference/secretsmanager/create-secret.html)로 저장하고 파일을 안전하게 지운다. Secret **ARN만** private CloudFormation parameter에 전달한다. 두 URL이 모두 필요하다.
3. 형제 ICAROS-api의 callback `publication.terminal` log patch `ca91f3f`는 2026-10-04 운영 API·callback Lambda에 적용했고 코드 해시를 확인했다. 같은 날 callback log group의 기존 subscription filter가 0개임을 확인했다. 실제 게시를 실행해 새 로그가 발생하는 검증은 아직 하지 않았다.
4. `npm ci --prefix infra/aws/alerts --ignore-scripts --no-audit --no-fund`, `node --test infra/aws/alerts/notifier.test.mjs`, `node infra/aws/alerts/template.mjs > infra/aws/alerts/template.json`, `aws cloudformation validate-template --template-body file://infra/aws/alerts/template.json`으로 로컬 검증한다. 이후 별도 승인된 절차에서 `handler.mjs`·`notifier.mjs`·production `node_modules`를 ZIP으로 패키징해 versioned S3 artifact에 올린다. CloudFormation parameter `ArtifactBucket`/`ArtifactKey`/`ArtifactVersion`, 기존 `CodeBuildProject`, API/callback Lambda 이름, callback log group, callback EventBridge·async DLQ **이름**, `WebhookSecretArn`, `EnableDelivery=true`를 입력한다. CloudFormation change set의 IAM·구독·알람 변경을 검토한 뒤 적용한다.
5. 실제 테스트 빌드와 게시 1회를 수행해 **빌드 종료와 게시 종료가 각각** Slack·Discord에 도착하는지 확인한다. 실패 시험은 별도 테스트 환경에서 하고, 운영 게시 실패를 의도적으로 만들지 않는다. Lambda Errors/ALARM 및 DLQ 깊이가 0으로 돌아오는지 본다. 검증 전에는 전달 완료로 보고하지 않는다.

알림 Lambda는 VPC 밖에서 4초 제한 HTTPS POST를 수행하고 redirect를 거부한다. CloudWatch 로그 구독 수신은 같은 Lambda를 비동기로 재호출해 채널 전송을 enqueue한다. Secrets Manager 읽기, DynamoDB 기록, Slack/Discord 전송 실패는 게시 callback을 실패시키지 않는다. EventBridge/재호출 뒤의 Lambda 비동기 실패는 alert DLQ에 보존되며 `alert-dlq` alarm이 켜진다. 다만 구독 수신 단계의 enqueue 자체가 실패하면 Lambda error metric과 원본 callback 로그를 통해 수동으로 발견·재처리해야 한다. CloudWatch Logs subscription에는 [전달 재시도 한도](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Subscriptions.html)가 있고 함수 코드 오류의 재시도까지 보장하지는 않는다.

## CloudWatch Logs Insights

callback log group에서 게시 종료 기록:

```sql
fields @timestamp, @message
| filter @message like /publication\.terminal/
| sort @timestamp desc
| limit 100
```

alert log group에서 채널 전송과 오류:

```sql
fields @timestamp, @message
| filter @message like /alert\.delivered|Notification delivery failed/
| sort @timestamp desc
| limit 100
```

빌드 로그에서는 CodeBuild build ID로 log stream을 좁히고 마지막 실패 phase를 확인한다. 로그 메시지에 Secret·민감한 환경변수가 들어갈 수 있으므로 그대로 채널에 복사하지 않는다. [Logs Insights는 JSON 필드를 추출](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData-discoverable-fields.html)하지만 Lambda text log의 prefix 때문에 위 쿼리는 `@message` 검색을 쓴다.

## 경보 대응

- `callback-errors`, `callback-throttles`: callback Lambda 로그와 해당 build/job 상태를 확인한다. 먼저 현재 publication job과 KVS release pointer를 대조하고, 중복 callback을 수동 재실행하지 않는다.
- `callback-event-dlq`, `callback-async-dlq`: 두 큐의 메시지와 실패 시각을 확인한다. 정상 게시 여부를 확인한 뒤 재처리 여부를 결정한다. 큐 메시지에 원본 이벤트가 있으므로 외부 채널로 전달하지 않는다.
- `api-errors`: API 로그에서 요청 종류와 실패 원인을 확인한다. 일반 API 오류만으로 게시 실패를 단정하지 않는다.
- `alert-errors`, `alert-dlq`, `build-rule-delivery`: Secrets Manager 조회, webhook 거부/timeout, 알림 함수 호출 권한과 DLQ를 확인한다. 이 장애는 게시 결과 자체를 바꾸지 않는다. 채널 알림이 끊겼을 수 있으므로 CloudWatch 콘솔로 직접 상태를 확인한다.

알람은 5분 단위 `>=1`, missing data는 정상 취급한다. CloudWatch metric alarms는 과거 손실된 EventBridge 이벤트를 재생하지 않으므로 CodeBuild 이벤트가 best effort라는 한계를 별도로 고려한다. 배포 직후에는 실제 게시 한 건으로 신호 체인을 검증한다.
