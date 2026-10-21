import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const template = JSON.parse(readFileSync(new URL('./g-async.review.template.json', import.meta.url)))

test('G API async failure review uses a retained standard queue and grants the invoking function send permission', () => {
  assert.equal(template.Parameters.EnableGAsyncFailure.Default, 'false')
  const queue = template.Resources.GAsyncFailureQueue
  assert.equal(queue.Properties.FifoQueue, undefined)
  assert.equal(queue.Properties.MessageRetentionPeriod, 1209600)
  assert.equal(queue.DeletionPolicy, 'Retain')
  assert.equal(queue.UpdateReplacePolicy, 'Retain')
  const invocation = template.Resources.GAsyncInvokeConfig.Properties
  assert.deepEqual(invocation.FunctionName, { Ref: 'GApiFunctionName' })
  assert.deepEqual(invocation.Qualifier, { Ref: 'InvocationQualifier' })
  assert.deepEqual(invocation.DestinationConfig.OnFailure.Destination, { 'Fn::If': ['UseExistingFailureQueue',
    { Ref: 'ExistingGFailureQueueArn' }, { 'Fn::GetAtt': ['GAsyncFailureQueue', 'Arn'] }] })
  assert.deepEqual(template.Resources.GAsyncDestinationPermission.Properties.Roles, [{ Ref: 'GApiRoleName' }])
  const statement = template.Resources.GAsyncDestinationPermission.Properties.PolicyDocument.Statement[0]
  assert.equal(statement.Action, 'sqs:SendMessage')
  assert.deepEqual(statement.Resource, invocation.DestinationConfig.OnFailure.Destination)
  assert.ok(template.Rules.RequireReviewedGSource)
})

const evaluate = (value, parameters) => {
  if (!value || typeof value !== 'object') return value
  if (value.Ref) return parameters[value.Ref]
  if (value['Fn::Equals']) return evaluate(value['Fn::Equals'][0], parameters) === evaluate(value['Fn::Equals'][1], parameters)
  if (value['Fn::Not']) return !evaluate(value['Fn::Not'][0], parameters)
  if (value['Fn::And']) return value['Fn::And'].every(item => evaluate(item, parameters))
  if (value['Fn::Or']) return value['Fn::Or'].some(item => evaluate(item, parameters))
  throw new Error('Unexpected rule operation')
}

test('minute reconciler cannot enable without matching async failure configuration and an existing standard queue', () => {
  assert.equal(template.Parameters.EnableGReconcile?.Default, 'false')
  const ready = { EnableGReconcile: 'true', EnableGAsyncFailure: 'true',
    ExistingGFailureQueueArn: 'arn:aws:sqs:ap-northeast-2:000000000000:synthetic-failure' }
  const rule = template.Rules.RequireReconcilerFailureDestination
  const allowed = input => !evaluate(rule.RuleCondition, input) || rule.Assertions.every(item => evaluate(item.Assert, input))
  assert.equal(allowed(ready), true)
  assert.equal(allowed({ ...ready, EnableGAsyncFailure: 'false' }), false)
  assert.equal(allowed({ ...ready, ExistingGFailureQueueArn: '' }), false)
  assert.equal(allowed({ ...ready, EnableGReconcile: 'false', EnableGAsyncFailure: 'false', ExistingGFailureQueueArn: '' }), true)
  const pattern = new RegExp(template.Parameters.ExistingGFailureQueueArn.AllowedPattern)
  assert.equal(pattern.test(ready.ExistingGFailureQueueArn), true)
  assert.equal(pattern.test(`${ready.ExistingGFailureQueueArn}.fifo`), false)
  assert.equal(pattern.test(`unexpected-prefix-${ready.ExistingGFailureQueueArn}`), false)
  assert.equal(evaluate(template.Conditions.CreateGAsyncFailureQueue, ready), false)
  assert.equal(evaluate(template.Conditions.CreateGAsyncFailureQueue,
    { ...ready, EnableGReconcile: 'false', ExistingGFailureQueueArn: '' }), true)
})

test('scheduled reconciliation invokes only the verified API function or alias with exact source rule permission', () => {
  const rule = template.Resources.GReconcileRule
  assert.ok(rule, 'G reconcile rule missing')
  assert.equal(rule.Condition, 'GReconcileEnabled')
  assert.equal(rule.Properties.ScheduleExpression, 'rate(1 minute)')
  assert.equal(rule.Properties.Targets.length, 1)
  const target = rule.Properties.Targets[0]
  assert.deepEqual(JSON.parse(target.Input), { kind: 'icaros.g.reconcile' })
  assert.deepEqual(target.Arn, { 'Fn::If': ['InvokeLatest',
    { 'Fn::Sub': 'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${GApiFunctionName}' },
    { 'Fn::Sub': 'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${GApiFunctionName}:${InvocationQualifier}' }] })
  const permission = template.Resources.GReconcilePermission
  assert.equal(permission.Condition, 'GReconcileEnabled')
  assert.deepEqual(permission.Properties.FunctionName, target.Arn)
  assert.equal(permission.Properties.Principal, 'events.amazonaws.com')
  assert.equal(permission.Properties.Action, 'lambda:InvokeFunction')
  assert.deepEqual(permission.Properties.SourceArn, { 'Fn::GetAtt': ['GReconcileRule', 'Arn'] })
  assert.deepEqual(permission.Properties.SourceAccount, { Ref: 'AWS::AccountId' })
  assert.deepEqual(template.Resources.GAsyncInvokeConfig.Properties.Qualifier, { Ref: 'InvocationQualifier' })
})

test('LATEST is the default verified path and alias scheduling requires completion self-invoke qualifier evidence', () => {
  assert.equal(template.Parameters.InvocationQualifier.Default, '$LATEST')
  assert.equal(template.Parameters.AliasCompletionQualifierVerified?.Default, 'false')
  const rule = template.Rules.RequireReconcilerQualifierMatch
  const allowed = parameters => !evaluate(rule.RuleCondition, parameters) ||
    rule.Assertions.every(item => evaluate(item.Assert, parameters))
  const latest = { EnableGReconcile: 'true', InvocationQualifier: '$LATEST', AliasCompletionQualifierVerified: 'false' }
  assert.equal(allowed(latest), true)
  assert.equal(allowed({ ...latest, InvocationQualifier: 'production' }), false)
  assert.equal(allowed({ ...latest, InvocationQualifier: 'production', AliasCompletionQualifierVerified: 'true' }), true)
})
