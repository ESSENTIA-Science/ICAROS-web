import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { LambdaClient } from '@aws-sdk/client-lambda'
import { parseDocument } from 'yaml'

const moduleUrl = new URL('./revalidation-wrapper.mjs', import.meta.url)
const record = (messageId, body = { host: 'public.example.test', url: '/member/' }) => ({ messageId, body: JSON.stringify(body) })
const encoded = response => Buffer.from(JSON.stringify(response))
const success = statusCode => ({ StatusCode: 200, Payload: encoded({ statusCode, headers: { 'x-nextjs-cache': 'REVALIDATED' } }) })

test('queue worker and synchronous public Invoke stay within the 10-slot account capacity budget', () => {
  const stack = parseDocument(readFileSync(new URL('./production-stack.yml', import.meta.url), 'utf8'))
  assert.deepEqual(stack.errors, [])
  const workers = stack.getIn(['Resources', 'RevalidationMapping', 'Properties', 'ScalingConfig', 'MaximumConcurrency'])
  const accountQuota = 10, slotsPerWorker = 2, slotsForOtherTraffic = 6
  assert.ok(Number.isInteger(workers) && workers >= 2, 'SQS mapping needs an explicit valid worker limit')
  assert.ok(workers * slotsPerWorker <= accountQuota - slotsForOtherTraffic,
    'each worker retains one slot while its public Lambda Invoke consumes another; leave six slots for other traffic')
})
async function create(options) {
  assert.equal(existsSync(moduleUrl), true, 'authenticated G revalidation wrapper must exist')
  const { createRevalidationHandler } = await import(moduleUrl.href)
  return createRevalidationHandler({ functionName: 'synthetic-web', previewModeId: 'current-build-secret', ...options })
}

test('G revalidation uses authenticated SDK Invoke and current preview token for HEAD', async () => {
  const requests = []
  const client = new LambdaClient({ region: 'ap-northeast-2', maxAttempts: 1,
    credentials: { accessKeyId: 'SYNTHETICACCESSKEY', secretAccessKey: 'synthetic-only-secret' },
    requestHandler: { async handle(request) {
      requests.push(request)
      // The IAM endpoint rejects the legacy unsigned HTTPS transport.
      const signed = request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')
      return { response: { statusCode: signed ? 200 : 403, headers: { 'content-type': 'application/json' },
        body: encoded(signed ? { statusCode: 200, headers: { 'X-Nextjs-Cache': 'REVALIDATED' } } : { message: 'Forbidden' }) } }
    } },
  })
  const handler = await create({ client })
  assert.deepEqual(await handler({ Records: [record('one', { host: 'public.example.test', url: '/member/?page=2' })] }), { batchItemFailures: [] })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].headers['x-amz-invocation-type'], 'RequestResponse')
  assert.equal(requests[0].path, '/2015-03-31/functions/synthetic-web/invocations')
  const event = JSON.parse(Buffer.from(requests[0].body).toString())
  assert.equal(event.version, '2.0')
  assert.equal(event.rawPath, '/member/')
  assert.equal(event.rawQueryString, 'page=2')
  assert.equal(event.requestContext.http.method, 'HEAD')
  assert.equal(event.headers.host, 'public.example.test')
  assert.equal(event.headers['x-isr'], '1')
  assert.equal(event.headers['x-prerender-revalidate'], 'current-build-secret')
  client.destroy()
})

test('runtime handler reads its packaged manifest token and disables SDK retries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'icaros-revalidation-'))
  const manifestPath = join(directory, 'prerender-manifest.json')
  writeFileSync(manifestPath, JSON.stringify({ preview: { previewModeId: 'packaged-current-token' } }))
  const original = LambdaClient.prototype.send, oldFunction = process.env.G_WEB_FUNCTION
  process.env.G_WEB_FUNCTION = 'synthetic-runtime-function'
  let request
  LambdaClient.prototype.send = async function (command) {
    assert.equal(await this.config.maxAttempts(), 1)
    assert.equal(command.input.FunctionName, 'synthetic-runtime-function')
    request = JSON.parse(Buffer.from(command.input.Payload).toString())
    return success(200)
  }
  try {
    const source = readFileSync(moduleUrl, 'utf8')
      .replace("'@aws-sdk/client-lambda'", JSON.stringify(import.meta.resolve('@aws-sdk/client-lambda')))
      .replace("'./prerender-manifest.json'", JSON.stringify(pathToFileURL(manifestPath).href))
    const runtime = await import(`data:text/javascript,${encodeURIComponent(source)}`)
    assert.deepEqual(await runtime.handler({ Records: [record('one')] }), { batchItemFailures: [] })
    assert.equal(request.headers['x-prerender-revalidate'], 'packaged-current-token')
  } finally {
    LambdaClient.prototype.send = original
    if (oldFunction === undefined) delete process.env.G_WEB_FUNCTION
    else process.env.G_WEB_FUNCTION = oldFunction
    rmSync(directory, { recursive: true, force: true })
  }
})

test('only revalidated success, redirects, and not-found responses acknowledge messages', async () => {
  for (const status of [200, 307, 308, 404]) {
    const handler = await create({ client: { send: async () => success(status) } })
    assert.deepEqual(await handler({ Records: [record('one')] }), { batchItemFailures: [] })
  }
  for (const response of [success(500), { StatusCode: 403 }, { StatusCode: 202 },
    { ...success(200), FunctionError: 'Unhandled' }, { StatusCode: 200, Payload: Buffer.from('invalid-json') },
    { StatusCode: 200, Payload: encoded(null) }, { StatusCode: 200, Payload: encoded({ statusCode: 200, headers: { 'x-nextjs-cache': 'HIT' } }) }]) {
    const handler = await create({ client: { send: async () => response } })
    assert.deepEqual(await handler({ Records: [record('one')] }), { batchItemFailures: [{ itemIdentifier: 'one' }] })
  }
})

test('FIFO stops on the first failure and returns failed and all unprocessed IDs', async () => {
  let calls = 0
  const handler = await create({ client: { send: async () => ++calls === 1 ? success(200) : success(500) } })
  assert.deepEqual(await handler({ Records: [record('one'), record('two'), record('three')] }),
    { batchItemFailures: [{ itemIdentifier: 'two' }, { itemIdentifier: 'three' }] })
  assert.equal(calls, 2)
})

test('malformed input never invokes another host or any Lambda', async () => {
  const bodies = [null, [], {}, { host: 'public.example.test\r\nx-secret: injected', url: '/' },
    { host: 'https://evil.example.test', url: '/' }, { host: 'public.example.test', url: '//evil.example.test/' },
    { host: 'public.example.test', url: 'https://evil.example.test/' },
    { host: 'public.example.test', url: '/foo/../api/' }, { host: 'public.example.test', url: '/%2e%2e/api/' },
    { host: 'public.example.test', url: '/foo%3f/../api/' },
    { host: 'public.example.test', url: '/%5cevil/' }, { host: 'public.example.test', url: '/%0a/' },
    { host: 'public.example.test', url: '/%zz/' }, { host: 'public.example.test', url: '/member/#fragment' }]
  for (const body of bodies) {
    let calls = 0
    const handler = await create({ client: { send: async () => { calls++; return success(200) } } })
    assert.deepEqual(await handler({ Records: [record('bad', body), record('later')] }),
      { batchItemFailures: [{ itemIdentifier: 'bad' }, { itemIdentifier: 'later' }] })
    assert.equal(calls, 0)
  }
  const handler = await create({ client: { send: async () => { assert.fail('invalid JSON must not invoke') } } })
  assert.deepEqual(await handler({ Records: [{ messageId: 'bad', body: 'invalid-json' }] }), { batchItemFailures: [{ itemIdentifier: 'bad' }] })
  await assert.rejects(handler({ Records: [{ body: '{}' }] }), /Invalid SQS event/)
})

test('transport errors stay in the queue and logs contain no message host, URL, token, or SDK error', async () => {
  const logs = [], original = console.warn
  console.warn = (...args) => logs.push(args)
  try {
    const handler = await create({ client: { send: async () => { throw new Error('public.example.test private failure') } } })
    assert.deepEqual(await handler({ Records: [record('one')] }), { batchItemFailures: [{ itemIdentifier: 'one' }] })
    const text = JSON.stringify(logs)
    for (const secret of ['public.example.test', '/member/', 'current-build-secret', 'private failure']) assert.equal(text.includes(secret), false)
    assert.ok(logs.length > 0)
  } finally { console.warn = original }
})

test('missing runtime function or preview token fails closed without invoking', async () => {
  for (const options of [{ functionName: '' }, { previewModeId: '' }]) {
    const handler = await create({ ...options, client: { send: async () => assert.fail('unconfigured Invoke') } })
    assert.deepEqual(await handler({ Records: [record('one')] }), { batchItemFailures: [{ itemIdentifier: 'one' }] })
  }
})

test('Invoke receives a bounded abort signal and exhausted Lambda budget does not invoke', async () => {
  let signal
  const handler = await create({ client: { send: async (_, options) => { signal = options.abortSignal; return success(200) } } })
  assert.deepEqual(await handler({ Records: [record('one')] }, { getRemainingTimeInMillis: () => 1005 }), { batchItemFailures: [] })
  assert.equal(signal instanceof AbortSignal, true)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(signal.aborted, true)
  const exhausted = await create({ client: { send: async () => assert.fail('budget exhausted') } })
  assert.deepEqual(await exhausted({ Records: [record('one')] }, { getRemainingTimeInMillis: () => 1000 }),
    { batchItemFailures: [{ itemIdentifier: 'one' }] })
})
