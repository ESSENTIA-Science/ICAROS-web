import { createHash, randomUUID } from 'node:crypto'

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT'])
const OUTCOMES = new Set(['PUBLISHED', 'FAILED'])

function token(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function eventSummary(event, project) {
  if (!event || typeof event !== 'object' || !event.detail || typeof event.detail !== 'object') return null
  const detail = event.detail
  if (event.source === 'aws.codebuild' && event['detail-type'] === 'CodeBuild Build State Change') {
    const status = detail['build-status']
    const buildId = detail['build-id']
    if (detail['project-name'] !== project || !TERMINAL.has(status) || typeof buildId !== 'string' ||
        !/^arn:[^:]+:codebuild:[^:]+:\d{12}:build\/[^:]+:[a-zA-Z0-9-]+$/.test(buildId)) return null
    return { key: `build:${buildId}:${status}`, kind: 'build', status,
      text: `ICAROS 웹 빌드 ${status === 'SUCCEEDED' ? '성공 (게시 승격 확인 대기)' : `실패 (${status})`} · 빌드 ${token(buildId)}` }
  }
  if (event.source === 'icaros.publication' && event['detail-type'] === 'Publication State Change') {
    const { status, jobId, version, attempt } = detail
    if (!OUTCOMES.has(status) || typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(jobId) ||
        !Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(attempt) || attempt < 1) return null
    return { key: `publication:${jobId}:${version}:${attempt}:${status}`, kind: 'publication', status,
      text: `ICAROS 웹 게시 ${status === 'PUBLISHED' ? '완료' : '실패'} · 버전 ${version} · 시도 ${attempt} · 작업 ${token(jobId)}` }
  }
  if (event.source === 'aws.cloudwatch' && event['detail-type'] === 'CloudWatch Alarm State Change') {
    const name = detail.alarmName
    const value = detail.state?.value
    const timestamp = detail.state?.timestamp
    if (typeof name !== 'string' || !/^icaros-[A-Za-z0-9-]{1,200}$/.test(name) ||
        !['ALARM', 'OK'].includes(value) || typeof timestamp !== 'string') return null
    return { key: `alarm:${name}:${timestamp}:${value}`, kind: 'alarm', status: value,
      text: `ICAROS 운영 경보 ${value === 'ALARM' ? '발생' : '복구'} · ${name}` }
  }
  return null
}

function validWebhook(channel, raw) {
  const url = new URL(raw)
  const allowed = channel === 'slack' ? url.hostname === 'hooks.slack.com' :
    (url.hostname === 'discord.com' || url.hostname === 'discordapp.com')
  const path = channel === 'slack' ? /^\/services\/[^/]+\/[^/]+\/[^/]+$/ : /^\/api\/webhooks\/\d+\/[^/]+$/
  if (url.protocol !== 'https:' || !allowed || !path.test(url.pathname) || url.search || url.hash || url.username || url.password)
    throw new Error('Invalid webhook configuration')
  return url.toString()
}

/** Adapters keep AWS and HTTP out of the event contract and unit tests. */
export function createNotifier({ project, readSecrets, claim, markSent, release, post }) {
  if (!project) throw new Error('Missing CodeBuild project')
  return async event => {
    const summary = eventSummary(event, project)
    if (!summary) throw new Error('Unexpected notification event')
    console.info(JSON.stringify({ event: summary.kind === 'build' ? 'build.terminal' : 'alert.received',
      kind: summary.kind, status: summary.status }))
    const secrets = await readSecrets()
    const channels = [['slack', secrets.SLACK_WEBHOOK_URL], ['discord', secrets.DISCORD_WEBHOOK_URL]]
    if (channels.some(([, url]) => typeof url !== 'string' || !url)) throw new Error('Missing webhook configuration')
    const failures = []
    for (const [channel, raw] of channels) {
      const key = `${summary.key}:${channel}`
      const lease = randomUUID()
      if (!await claim(key, lease)) continue
      try {
        const url = validWebhook(channel, raw)
        await post(url, channel === 'slack' ? { text: summary.text } :
          { content: summary.text, allowed_mentions: { parse: [] } })
        await markSent(key, lease)
        console.info(JSON.stringify({ event: 'alert.delivered', kind: summary.kind, channel }))
      } catch {
        await release(key, lease).catch(() => {})
        failures.push(channel)
      }
    }
    if (failures.length) {
      // Webhook URLs and HTTP response bodies must never enter logs.
      console.error('Notification delivery failed', { kind: summary.kind, channels: failures })
      throw new Error('Notification delivery failed')
    }
  }
}

export { eventSummary, validWebhook }
