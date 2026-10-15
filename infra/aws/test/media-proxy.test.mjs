import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createMediaProxy } from '../media-proxy.mjs'
import * as proxyModule from '../media-proxy.mjs'
const id = '11111111-1111-4111-8111-111111111111'
const bytes = Buffer.from('synthetic portrait')
const sha = createHash('sha256').update(bytes).digest('hex')
const entry = { key: `published/${id}/${sha}.webp`, sha256: sha, mime: 'image/webp', size: bytes.length, entityType: 'member', storage: 'private' }
const event = method => ({ rawPath: `/api/media/${id}`, requestContext: { http: { method } } })
const object = (body, mime = 'application/json') => ({ size: body.length, mime, async bytes() { return body } })
function fixture(options = {}) {
  const snapshot = Buffer.from(JSON.stringify({ version: '1', members: [{ imageSrc: `/api/media/${id}`, published: true }], compatMediaIndex: { version: '1', media: { [id]: entry } } }))
  const snapshotSha = createHash('sha256').update(snapshot).digest('hex')
  const pointer = { version: 1, key: `snapshots/v1/${snapshotSha}.json`, sha256: snapshotSha }
  const proxy = createMediaProxy({ async getSnapshotPointer() { return pointer }, async getRelease() { throw new Error('G must not consult release pointer') }, async getObject(kind) { return kind === 'snapshot' ? object(snapshot) : object(bytes, 'image/webp') }, ...options })
  return { proxy, pointer }
}
test('G proxy resolves the active checksummed snapshot compatibility index for GET and HEAD', async () => {
  const f = fixture()
  assert.equal((await f.proxy(event('GET'))).statusCode, 200)
  const head = await f.proxy(event('HEAD')); assert.equal(head.statusCode, 200); assert.equal(head.body, '')
})
test('G snapshot checksum mismatch denies bytes', async () => {
  const f = fixture(); f.pointer.sha256 = 'a'.repeat(64); f.pointer.key = `snapshots/v1/${f.pointer.sha256}.json`
  assert.equal((await f.proxy(event('GET'))).statusCode, 503)
})
test('current member authority can deny an old snapshot for both GET and HEAD', async () => {
  const f = fixture({ async getMemberPublished() { return false }, requireCurrentMemberState: true })
  for (const method of ['GET', 'HEAD']) assert.equal((await f.proxy(event(method))).statusCode, 404)
})
test('strict current-member guard fails closed when the authority is absent', async () => {
  const f = fixture({ requireCurrentMemberState: true })
  assert.equal((await f.proxy(event('GET'))).statusCode, 503)
})

test('Lambda authority uses a bounded synchronous IAM invoke and rereads on every request', async () => {
  assert.equal(typeof proxyModule.createLambdaMemberMediaAuthority, 'function')
  let live = true
  const calls = []
  const authority = proxyModule.createLambdaMemberMediaAuthority({ functionName: 'fixture-api:live', lambda: {
    async send(command, options) {
      calls.push(command.input)
      assert.ok(options.abortSignal instanceof AbortSignal)
      return { StatusCode: 200, Payload: Buffer.from(JSON.stringify({ authorized: live })) }
    },
  } })
  const f = fixture({ getMemberPublished: authority, requireCurrentMemberState: true })
  assert.equal((await f.proxy(event('GET'))).statusCode, 200)
  live = false
  for (const method of ['GET', 'HEAD']) assert.equal((await f.proxy(event(method))).statusCode, 404)
  assert.equal(calls.length, 3, 'allow results must not survive a warm request')
  for (const call of calls) {
    assert.equal(call.FunctionName, 'fixture-api:live')
    assert.equal(call.InvocationType, 'RequestResponse')
    assert.deepEqual(JSON.parse(Buffer.from(call.Payload).toString('utf8')), { kind: 'icaros.media.authorize', mediaId: id, sha256: sha, member: true })
  }
})

test('Lambda authority errors and malformed responses never fall back to snapshot permission', async () => {
  assert.equal(typeof proxyModule.createLambdaMemberMediaAuthority, 'function')
  for (const result of [
    { StatusCode: 202, Payload: Buffer.from('{"authorized":true}') },
    { StatusCode: 200, FunctionError: 'Unhandled', Payload: Buffer.from('{"authorized":true}') },
    { StatusCode: 200, Payload: Buffer.from('{"authorized":"true"}') },
    { StatusCode: 200, Payload: Buffer.from('{"authorized":true,"extra":true}') },
    { StatusCode: 200, Payload: Buffer.from('invalid JSON') },
    { StatusCode: 200, Payload: Buffer.alloc(1025) },
    { StatusCode: 200 },
    null,
  ]) {
    const authority = proxyModule.createLambdaMemberMediaAuthority({ functionName: 'fixture-api', lambda: {
      async send() { if (result === null) throw new Error('unavailable'); return result },
    } })
    const f = fixture({ getMemberPublished: authority, requireCurrentMemberState: true })
    for (const method of ['GET', 'HEAD']) assert.equal((await f.proxy(event(method))).statusCode, 503)
  }
})

test('legacy current allow still requires private immutable object checksum verification', async () => {
  const f = fixture({ getMemberPublished: async () => true, requireCurrentMemberState: true,
    getObject: async (kind) => kind === 'snapshot' ? (() => {
      const snapshot = Buffer.from(JSON.stringify({ version: '1', members: [{ imageSrc: `/api/media/${id}`, published: true }], compatMediaIndex: { version: '1', media: { [id]: entry } } }))
      return object(snapshot)
    })() : object(Buffer.alloc(bytes.length), 'image/webp') })
  for (const method of ['GET', 'HEAD']) assert.equal((await f.proxy(event(method))).statusCode, 503)
})

test('old public compatibility index cannot bypass current sticky member protection', async () => {
  const publicEntry = { ...entry, entityType: 'post', storage: 'public' }
  const snapshot = Buffer.from(JSON.stringify({ version: '1', members: [], compatMediaIndex: { version: '1', media: { [id]: publicEntry } } }))
  const digest = createHash('sha256').update(snapshot).digest('hex')
  let invokes = 0
  const authority = proxyModule.createLambdaMemberMediaAuthority({ functionName: 'fixture-api', lambda: {
    async send(command) {
      invokes++
      assert.equal(JSON.parse(Buffer.from(command.input.Payload).toString('utf8')).member, false)
      return { StatusCode: 200, Payload: Buffer.from('{"authorized":false}') }
    },
  } })
  const run = createMediaProxy({ requireCurrentMemberState: true, getMemberPublished: authority,
    getSnapshotPointer: async () => ({ version: 1, key: `snapshots/v1/${digest}.json`, sha256: digest }),
    getObject: async kind => {
      assert.equal(kind, 'snapshot', 'denied historical portrait must not fetch a public copy')
      return object(snapshot)
    },
  })
  for (const method of ['GET', 'HEAD']) assert.equal((await run(event(method))).statusCode, 404)
  assert.equal(invokes, 2)
})
