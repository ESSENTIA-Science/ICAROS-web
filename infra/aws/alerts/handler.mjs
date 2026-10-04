import { DynamoDBClient, PutItemCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { createNotifier } from './notifier.mjs'
import { gunzipSync } from 'node:zlib'

const table = process.env.DEDUP_TABLE
const secretId = process.env.WEBHOOK_SECRET_ARN
const project = process.env.CODEBUILD_PROJECT
const selfArn = process.env.ALERT_FUNCTION_ARN
if (!table || !secretId || !project) throw new Error('Missing alert configuration')

const dynamo = new DynamoDBClient({})
const secrets = new SecretsManagerClient({})
const lambda = new LambdaClient({})
let cachedSecret
let cachedUntil = 0

const notifier = createNotifier({
  project,
  async readSecrets() {
    if (cachedSecret && Date.now() < cachedUntil) return cachedSecret
    const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }))
    if (!result.SecretString) throw new Error('Missing webhook secret value')
    const value = JSON.parse(result.SecretString)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid webhook secret value')
    cachedSecret = value
    cachedUntil = Date.now() + 300_000
    return value
  },
  async claim(key, lease) {
    const now = Math.floor(Date.now() / 1000)
    try {
      await dynamo.send(new PutItemCommand({
        TableName: table,
        Item: { pk: { S: key }, state: { S: 'leased' }, lease: { S: lease },
          leaseUntil: { N: String(now + 60) }, expiresAt: { N: String(now + 604800) } },
        ConditionExpression: 'attribute_not_exists(pk) OR (#state = :leased AND leaseUntil < :now)',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':leased': { S: 'leased' }, ':now': { N: String(now) } }
      }))
      return true
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') return false
      throw error
    }
  },
  async markSent(key, lease) {
    await dynamo.send(new UpdateItemCommand({
      TableName: table, Key: { pk: { S: key } },
      UpdateExpression: 'SET #state = :sent REMOVE lease, leaseUntil',
      ConditionExpression: 'lease = :lease AND #state = :leased',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: { ':sent': { S: 'sent' }, ':leased': { S: 'leased' }, ':lease': { S: lease } }
    }))
  },
  async release(key, lease) {
    await dynamo.send(new DeleteItemCommand({
      TableName: table, Key: { pk: { S: key } },
      ConditionExpression: 'lease = :lease', ExpressionAttributeValues: { ':lease': { S: lease } }
    }))
  },
  async post(url, body) {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(4_000), redirect: 'error'
    })
    if (!response.ok) throw new Error('Webhook rejected notification')
  }
})

export function publicationEventsFromLogs(event) {
  const data = event?.awslogs?.data
  if (typeof data !== 'string' || data.length > 400_000) throw new Error('Invalid log subscription')
  const decoded = gunzipSync(Buffer.from(data, 'base64'), { maxOutputLength: 1_000_000 })
  const batch = JSON.parse(decoded.toString('utf8'))
  if (batch.messageType === 'CONTROL_MESSAGE') return []
  if (batch.messageType !== 'DATA_MESSAGE' || !Array.isArray(batch.logEvents)) throw new Error('Invalid log batch')
  return batch.logEvents.flatMap(entry => {
    if (typeof entry.message !== 'string') return []
    let value
    const message = entry.message.trim()
    try { value = JSON.parse(message) } catch {
      const start = message.indexOf('{')
      if (start < 0) return []
      try { value = JSON.parse(message.slice(start)) } catch { return [] }
    }
    if (typeof value?.message === 'string') {
      try { value = JSON.parse(value.message) } catch { return [] }
    }
    if (value?.event !== 'publication.terminal') return []
    return [{ source: 'icaros.publication', 'detail-type': 'Publication State Change',
      detail: { status: value.status, jobId: value.jobId, version: value.version, attempt: value.attempt } }]
  })
}

export async function forwardPublicationLogs(event, invoke) {
  for (const item of publicationEventsFromLogs(event)) {
    const result = await invoke(item)
    if (result?.StatusCode !== 202) throw new Error('Alert enqueue failed')
  }
}

export async function handler(event) {
  if (event?.awslogs) {
    if (!selfArn) throw new Error('Missing asynchronous alert destination')
    await forwardPublicationLogs(event, item => lambda.send(new InvokeCommand({ FunctionName: selfArn,
      InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(item)) })))
  } else await notifier(event)
}
