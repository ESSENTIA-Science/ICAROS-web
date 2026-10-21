import test from 'node:test'
import assert from 'node:assert/strict'
import { createNotifier, eventSummary, validWebhook } from './notifier.mjs'
import { gzipSync } from 'node:zlib'
import { template } from './template.mjs'

const project = 'synthetic-web'
const build = { source: 'aws.codebuild', 'detail-type': 'CodeBuild Build State Change',
  detail: { 'project-name': project, 'build-id': 'arn:aws:codebuild:us-east-1:000000000000:build/synthetic-web:12345678-1234-1234-1234-123456789abc',
    'build-status': 'SUCCEEDED' } }
const published = { source: 'icaros.publication', 'detail-type': 'Publication State Change',
  detail: { jobId: 'private-job', version: 23, attempt: 2, status: 'PUBLISHED' } }

test('build success is explicitly pending publication; publication is separate', () => {
  assert.match(eventSummary(build, project).text, /승격 확인 대기/)
  assert.match(eventSummary(published, project).text, /게시 완료/)
  assert.equal(eventSummary({ ...build, detail: { ...build.detail, 'project-name': 'other' } }, project), null)
  assert.equal(eventSummary({ ...published, detail: { ...published.detail, status: 'pending' } }, project), null)
})

test('only expected HTTPS webhook hosts and paths are accepted', () => {
  assert.equal(validWebhook('slack', 'https://hooks.slack.com/services/a/b/c'), 'https://hooks.slack.com/services/a/b/c')
  assert.equal(validWebhook('discord', 'https://discord.com/api/webhooks/123/token'), 'https://discord.com/api/webhooks/123/token')
  for (const bad of ['http://hooks.slack.com/services/a/b/c', 'https://hooks.slack.com.evil.test/services/a/b/c',
    'https://discord.com.evil.test/api/webhooks/123/token', 'https://discord.com/api/webhooks/123/token?wait=true']) {
    assert.throws(() => validWebhook(bad.includes('discord') ? 'discord' : 'slack', bad))
  }
})

test('duplicate publication records do not send twice and failed channel retries alone', async () => {
  const state = new Set()
  const posts = []
  let failDiscord = true
  const run = createNotifier({ project, readSecrets: async () => ({
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/a/b/c',
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/token'
  }), claim: async key => { if (state.has(key)) return false; state.add(key); return true },
  markSent: async () => {}, release: async key => { state.delete(key) },
  post: async (url, body) => {
    if (url.includes('discord') && failDiscord) throw new Error('secret-bearing network error')
    posts.push({ url, body })
  } })
  const original = console.error
  const errors = []
  console.error = (...args) => errors.push(args)
  try { await assert.rejects(run(published), /Notification delivery failed/) }
  finally { console.error = original }
  assert.equal(posts.length, 1)
  assert.equal(JSON.stringify(errors).includes('secret-bearing'), false)
  failDiscord = false
  await run(published)
  await run(published)
  assert.equal(posts.length, 2)
  assert.equal(posts[0].body.text.includes('private-job'), false)
  assert.deepEqual(posts[1].body.allowed_mentions, { parse: [] })
})

test('CloudWatch subscription decodes terminal records and skips unrelated logs', async () => {
  process.env.DEDUP_TABLE = 'synthetic-table'
  process.env.WEBHOOK_SECRET_ARN = 'synthetic-secret'
  process.env.CODEBUILD_PROJECT = project
  const { publicationEventsFromLogs, forwardPublicationLogs } = await import('./handler.mjs')
  const data = { messageType: 'DATA_MESSAGE', logEvents: [
    { message: `2026-10-04T00:00:00.000Z\tINFO\t${JSON.stringify({ event: 'publication.terminal', status: 'FAILED', jobId: 'private-job', version: 23, attempt: 2 })}` },
    { message: 'START RequestId: synthetic' }
  ] }
  const result = publicationEventsFromLogs({ awslogs: { data: gzipSync(JSON.stringify(data)).toString('base64') } })
  assert.equal(result.length, 1)
  assert.match(eventSummary(result[0], project).text, /게시 실패/)
  assert.deepEqual(publicationEventsFromLogs({ awslogs: { data: gzipSync(JSON.stringify({ messageType: 'CONTROL_MESSAGE' })).toString('base64') } }), [])
  const received = []
  const envelope = { awslogs: { data: gzipSync(JSON.stringify(data)).toString('base64') } }
  await forwardPublicationLogs(envelope, async item => { received.push(item); return { StatusCode: 202 } })
  assert.deepEqual(received, result)
  await assert.rejects(forwardPublicationLogs(envelope, async () => ({ StatusCode: 500 })), /Alert enqueue failed/)
})

test('template is dormant without webhooks and has callback subscription plus alarms', () => {
  assert.equal(template.Parameters.EnableDelivery.Default, 'false')
  assert.equal(template.Resources.PublicationLogs.Condition, 'DeliveryEnabled')
  assert.equal(template.Resources.PublicationLogs.Properties.FilterPattern, '"publication.terminal"')
  assert.equal(template.Resources.CallbackErrors.Type, 'AWS::CloudWatch::Alarm')
  assert.equal(template.Resources.CallbackAsyncDlq.Type, 'AWS::CloudWatch::Alarm')
  assert.equal(template.Resources.BuildRule.Properties.EventPattern.detail['build-status'].length, 5)
})
