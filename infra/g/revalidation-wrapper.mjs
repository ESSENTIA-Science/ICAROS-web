import { readFileSync } from 'node:fs'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

const allowedStatuses = new Set([200, 307, 308, 404])

function headEvent(record, previewModeId) {
  if (typeof record.body !== 'string' || Buffer.byteLength(record.body) > 16384) throw new Error('Invalid message')
  const message = JSON.parse(record.body)
  const { host, url } = message ?? {}
  if (typeof host !== 'string' || host.length > 253 ||
      !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
      typeof url !== 'string' || url.length > 8192 || !url.startsWith('/') || url.startsWith('//') ||
      /[\s\\#]/u.test(url)) throw new Error('Invalid target')
  const queryIndex = url.indexOf('?')
  const rawPath = queryIndex < 0 ? url : url.slice(0, queryIndex)
  const rawQueryString = queryIndex < 0 ? '' : url.slice(queryIndex + 1)
  const decodedPath = decodeURIComponent(rawPath)
  if (/[\u0000-\u0020\u007f\\#]/u.test(decodeURIComponent(url)) || decodedPath.startsWith('//') ||
      decodedPath.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid path')
  return { version: '2.0', routeKey: '$default', rawPath, rawQueryString,
    headers: { host, 'x-prerender-revalidate': previewModeId, 'x-isr': '1' },
    requestContext: { http: { method: 'HEAD', path: rawPath, protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1', userAgent: 'ICAROS revalidation' } }, isBase64Encoded: false }
}

export function createRevalidationHandler({ functionName, previewModeId,
  client = new LambdaClient({ region: process.env.AWS_REGION, maxAttempts: 1 }) }) {
  return async (event, context) => {
    if (!Array.isArray(event?.Records) || event.Records.some(record =>
      !record || typeof record.messageId !== 'string' || !record.messageId)) throw new Error('Invalid SQS event')
    for (let index = 0; index < event.Records.length; index++) {
      let stage = 'configuration'
      try {
        if (typeof functionName !== 'string' || !functionName || typeof previewModeId !== 'string' || !previewModeId) {
          throw new Error('Missing revalidation configuration')
        }
        stage = 'message'
        const request = headEvent(event.Records[index], previewModeId)
        stage = 'invoke'
        const timeout = Math.min(25000, (context?.getRemainingTimeInMillis?.() ?? 30000) - 1000)
        if (timeout <= 0) throw new Error('Insufficient invocation time')
        // SDK signs a fixed Lambda target; the queued host never selects an outbound destination.
        const result = await client.send(new InvokeCommand({ FunctionName: functionName,
          InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(request)) }),
        { abortSignal: AbortSignal.timeout(timeout) })
        stage = 'response'
        if (result.StatusCode !== 200 || result.FunctionError || !result.Payload) throw new Error('Invoke failed')
        const response = JSON.parse(Buffer.from(result.Payload).toString('utf8'))
        const cacheHeader = Object.entries(response?.headers ?? {}).find(([key]) => key.toLowerCase() === 'x-nextjs-cache')?.[1]
        if (!allowedStatuses.has(response?.statusCode) || cacheHeader !== 'REVALIDATED') throw new Error('Revalidation failed')
      } catch {
        const batchItemFailures = event.Records.slice(index).map(record => ({ itemIdentifier: record.messageId }))
        console.warn('G revalidation batch failed', { failed: batchItemFailures.length, stage })
        // FIFO ordering requires returning every unprocessed message after the first failure.
        return { batchItemFailures }
      }
    }
    return { batchItemFailures: [] }
  }
}

let runtimeHandler
export async function handler(event, context) {
  runtimeHandler ??= createRevalidationHandler({ functionName: process.env.G_WEB_FUNCTION,
    previewModeId: JSON.parse(readFileSync(new URL('./prerender-manifest.json', import.meta.url), 'utf8')).preview?.previewModeId })
  return runtimeHandler(event, context)
}
