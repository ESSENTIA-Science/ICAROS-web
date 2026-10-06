// Generates a standalone CloudFormation stack. No production identifiers are stored here.
const ref = name => ({ Ref: name })
const att = (name, attribute = 'Arn') => ({ 'Fn::GetAtt': [name, attribute] })
const sub = value => ({ 'Fn::Sub': value })
const notifierName = sub('${AWS::StackName}-notifier')
const notifierArn = sub('arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${AWS::StackName}-notifier')
const metricAlarm = (name, namespace, metric, dimensionName, dimensionValue, threshold = 1) => ({
  Type: 'AWS::CloudWatch::Alarm', Properties: {
    AlarmName: sub(`icaros-${'${AWS::StackName}'}-${name}`),
    AlarmDescription: `${name}: inspect source logs/queue before replay or rollback`,
    Namespace: namespace, MetricName: metric, Statistic: metric === 'ApproximateNumberOfMessagesVisible' ? 'Maximum' : 'Sum', Period: 300,
    EvaluationPeriods: 1, DatapointsToAlarm: 1, Threshold: threshold,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching',
    Dimensions: [{ Name: dimensionName, Value: dimensionValue }]
  }
})

const resources = {
  AlertLogs: { Type: 'AWS::Logs::LogGroup', Properties: {
    LogGroupName: sub('/icaros/${AWS::StackName}/alerts'), RetentionInDays: 30 } },
  DedupTable: { Type: 'AWS::DynamoDB::Table', Properties: {
    BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }], TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    SSESpecification: { SSEEnabled: true }, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } } },
  DeliveryDlq: { Type: 'AWS::SQS::Queue', Properties: { MessageRetentionPeriod: 1209600, SqsManagedSseEnabled: true } },
  AlertRole: { Type: 'AWS::IAM::Role', Properties: {
    AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
    Policies: [{ PolicyName: 'deliver', PolicyDocument: { Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: att('AlertLogs') },
      { Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: ref('WebhookSecretArn') },
      { Effect: 'Allow', Action: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'], Resource: att('DedupTable') },
      { Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: notifierArn },
      { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: att('DeliveryDlq') }
    ] } }] } },
  AlertFunction: { Type: 'AWS::Lambda::Function', Properties: {
    FunctionName: notifierName, Runtime: 'nodejs22.x', Handler: 'handler.handler', Role: att('AlertRole'), Timeout: 15, MemorySize: 256,
    Code: { S3Bucket: ref('ArtifactBucket'), S3Key: ref('ArtifactKey'), S3ObjectVersion: ref('ArtifactVersion') },
    Environment: { Variables: { CODEBUILD_PROJECT: ref('CodeBuildProject'), WEBHOOK_SECRET_ARN: ref('WebhookSecretArn'),
      DEDUP_TABLE: ref('DedupTable'), ALERT_FUNCTION_ARN: notifierArn } }, LoggingConfig: { LogGroup: ref('AlertLogs') }
  } },
  AlertAsyncFailure: { Type: 'AWS::Lambda::EventInvokeConfig', Properties: {
    FunctionName: ref('AlertFunction'), Qualifier: '$LATEST', MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 2,
    DestinationConfig: { OnFailure: { Destination: att('DeliveryDlq') } }
  } },
  BuildRule: { Type: 'AWS::Events::Rule', Properties: {
    EventPattern: { source: ['aws.codebuild'], 'detail-type': ['CodeBuild Build State Change'],
      detail: { 'project-name': [ref('CodeBuildProject')], 'build-status': ['SUCCEEDED', 'FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT'] } },
    State: 'ENABLED', Targets: [{ Id: 'alerts', Arn: att('AlertFunction'), RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 12 },
      DeadLetterConfig: { Arn: att('DeliveryDlq') } }]
  } },
  BuildInvoke: { Type: 'AWS::Lambda::Permission', Properties: {
    Action: 'lambda:InvokeFunction', FunctionName: ref('AlertFunction'), Principal: 'events.amazonaws.com', SourceArn: att('BuildRule')
  } },
  PublicationLogs: { Type: 'AWS::Logs::SubscriptionFilter', Properties: {
    LogGroupName: ref('CallbackLogGroupName'), FilterPattern: '"publication.terminal"',
    DestinationArn: att('AlertFunction')
  }, DependsOn: 'LogsInvoke' },
  LogsInvoke: { Type: 'AWS::Lambda::Permission', Properties: {
    Action: 'lambda:InvokeFunction', FunctionName: ref('AlertFunction'), Principal: sub('logs.${AWS::Region}.amazonaws.com'),
    SourceArn: sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${CallbackLogGroupName}:*'),
    SourceAccount: ref('AWS::AccountId')
  } },
  DeliveryDlqPolicy: { Type: 'AWS::SQS::QueuePolicy', Properties: {
    Queues: [ref('DeliveryDlq')], PolicyDocument: { Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: att('DeliveryDlq'),
        Condition: { ArnEquals: { 'aws:SourceArn': [att('BuildRule'), att('AlarmRule')] } } }
    ] }
  } }
}

const alarms = {
  ApiErrors: metricAlarm('api-errors', 'AWS/Lambda', 'Errors', 'FunctionName', ref('ApiFunctionName')),
  CallbackErrors: metricAlarm('callback-errors', 'AWS/Lambda', 'Errors', 'FunctionName', ref('CallbackFunctionName')),
  CallbackThrottles: metricAlarm('callback-throttles', 'AWS/Lambda', 'Throttles', 'FunctionName', ref('CallbackFunctionName')),
  AlertErrors: metricAlarm('alert-errors', 'AWS/Lambda', 'Errors', 'FunctionName', ref('AlertFunction')),
  CallbackEventDlq: metricAlarm('callback-event-dlq', 'AWS/SQS', 'ApproximateNumberOfMessagesVisible', 'QueueName', ref('CallbackEventDlqName')),
  CallbackAsyncDlq: metricAlarm('callback-async-dlq', 'AWS/SQS', 'ApproximateNumberOfMessagesVisible', 'QueueName', ref('CallbackAsyncDlqName')),
  AlertDlq: metricAlarm('alert-dlq', 'AWS/SQS', 'ApproximateNumberOfMessagesVisible', 'QueueName', att('DeliveryDlq', 'QueueName')),
  BuildRuleDelivery: metricAlarm('build-rule-delivery', 'AWS/Events', 'FailedInvocations', 'RuleName', ref('BuildRule'))
}
const deliveryResources = [
  'AlertLogs', 'DedupTable', 'DeliveryDlq', 'AlertRole', 'AlertFunction', 'AlertAsyncFailure',
  'BuildRule', 'BuildInvoke', 'PublicationLogs', 'LogsInvoke', 'DeliveryDlqPolicy'
]
for (const name of deliveryResources) resources[name].Condition = 'DeliveryEnabled'
for (const name of ['AlertErrors', 'AlertDlq', 'BuildRuleDelivery']) alarms[name].Condition = 'DeliveryEnabled'
Object.assign(resources, alarms)
resources.AlarmRule = { Type: 'AWS::Events::Rule', Condition: 'DeliveryEnabled', Properties: {
  EventPattern: { source: ['aws.cloudwatch'], 'detail-type': ['CloudWatch Alarm State Change'],
    detail: { alarmName: Object.keys(alarms).map(name => ref(name)), state: { value: ['ALARM', 'OK'] } } },
  State: 'ENABLED', Targets: [{ Id: 'alerts', Arn: att('AlertFunction'), RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 12 },
    DeadLetterConfig: { Arn: att('DeliveryDlq') } }]
} }
resources.AlarmInvoke = { Type: 'AWS::Lambda::Permission', Condition: 'DeliveryEnabled', Properties: {
  Action: 'lambda:InvokeFunction', FunctionName: ref('AlertFunction'), Principal: 'events.amazonaws.com', SourceArn: att('AlarmRule')
} }

const parameters = Object.fromEntries([
  'CodeBuildProject', 'ApiFunctionName', 'CallbackFunctionName', 'CallbackLogGroupName',
  'CallbackEventDlqName', 'CallbackAsyncDlqName', 'WebhookSecretArn', 'ArtifactBucket', 'ArtifactKey', 'ArtifactVersion'
].map(name => [name, { Type: 'String', MinLength: 1 }]))
parameters.EnableDelivery = { Type: 'String', AllowedValues: ['false', 'true'], Default: 'false' }
delete parameters.WebhookSecretArn.MinLength
parameters.WebhookSecretArn.Default = ''
parameters.WebhookSecretArn.AllowedPattern = '^$|arn:[^:]+:secretsmanager:[^:]+:[0-9]{12}:secret:.+'
parameters.WebhookSecretArn.Description = 'Existing Secrets Manager JSON secret with SLACK_WEBHOOK_URL and DISCORD_WEBHOOK_URL; pass ARN only.'

const template = { AWSTemplateFormatVersion: '2010-09-09',
  Description: 'ICAROS build/publication notifications and CloudWatch alarms. Separate from publish critical path.',
  Parameters: parameters,
  Conditions: { DeliveryEnabled: { 'Fn::Equals': [ref('EnableDelivery'), 'true'] } },
  Rules: { RequireWebhookSecretForDelivery: { RuleCondition: { 'Fn::Equals': [ref('EnableDelivery'), 'true'] },
    Assertions: [{ Assert: { 'Fn::Not': [{ 'Fn::Equals': [ref('WebhookSecretArn'), ''] }] },
      AssertDescription: 'Enabling delivery requires an existing webhook secret ARN.' }] } },
  Resources: resources,
  Outputs: { AlertFunctionName: { Condition: 'DeliveryEnabled', Value: ref('AlertFunction') },
    AlertDeadLetterQueueUrl: { Condition: 'DeliveryEnabled', Value: ref('DeliveryDlq') } } }

if (process.argv[1]?.endsWith('/template.mjs')) process.stdout.write(`${JSON.stringify(template, null, 2)}\n`)
export { template }
