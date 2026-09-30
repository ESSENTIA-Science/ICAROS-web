import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createS3MediaObjects } from '../src/adapters/s3-media.js'

const bucket = 'private-bucket', key = 'icaros-web/media/object.webp'
test('signPut signs only a private PUT with content-type and host', async () => {
  let command: unknown, options: unknown
  const objects = createS3MediaObjects({ bucket, prefix: 'icaros-web', client: { async send() { return {} } },
    async sign(_client, input, opts) { command = input; options = opts; return 'signed' } })
  assert.equal(await objects.signPut({ bucket, key, contentType: 'image/webp', expiresIn: 600, signableHeaders: ['content-type', 'host'] }), 'signed')
  assert.equal((command as { input: Record<string, unknown> }).input.ContentType, 'image/webp')
  assert.deepEqual([...(options as { signableHeaders: Set<string> }).signableHeaders], ['content-type', 'host'])
})
test('rejects foreign bucket and sibling prefix before any S3 call', async () => {
  let calls = 0
  const objects = createS3MediaObjects({ bucket, prefix: 'icaros-web', client: { async send() { calls++; return {} } }, async sign() { calls++; return '' } })
  await assert.rejects(objects.remove('other', key))
  await assert.rejects(objects.head(bucket, 'icaros-web-extra/media/object.webp'))
  assert.equal(calls, 0)
})
test('head returns null for missing object and metadata for existing object', async () => {
  const objects = createS3MediaObjects({ bucket, prefix: 'icaros-web', client: { async send() { return { ContentLength: 9, ContentType: 'image/webp', ETag: '"etag"' } } }, async sign() { return '' } })
  assert.deepEqual(await objects.head(bucket, key), { size: 9, contentType: 'image/webp', etag: 'etag' })
})
test('prefix reads only requested byte range', async () => {
  let range: unknown
  const objects = createS3MediaObjects({ bucket, prefix: 'icaros-web', client: { async send(command) { range = (command.input as { Range?: string }).Range; return { Body: { async transformToByteArray() { return Uint8Array.of(1, 2) } } } } }, async sign() { return '' } })
  assert.deepEqual(await objects.prefix(bucket, key, 16), Uint8Array.of(1, 2))
  assert.equal(range, 'bytes=0-15')
})
