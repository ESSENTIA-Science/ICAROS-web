import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMediaService } from '../src/media/index.js'

test('presign records pending media before issuing a private PUT URL', async () => {
  const calls: string[] = []
  const service = createMediaService({ bucket: 'test-bucket', prefix: 'icaros-web',
    records: { async create(row) { calls.push(`create:${row.status}:${row.mime}`); return 'media-1' }, async find() { return null }, async ready() { return false }, async fail() {} },
    objects: { async signPut(input) { calls.push(`sign:${input.contentType}:${input.expiresIn}`); return 'https://upload.test/put' }, async head() { return null }, async prefix() { return null }, async remove() {} },
  })
  const result = await service.presign({ kind: 'media', contentType: 'image/webp', size: 100, originalFilename: 'photo.png' })
  assert.equal(result.status, 201)
  assert.deepEqual(calls, ['create:pending:image/webp', 'sign:image/webp:600'])
  assert.equal(result.body.ok, true)
})

test('presign rejects SVG and oversized video without touching storage', async () => {
  let touched = false
  const service = createMediaService({ bucket: 'b', prefix: 'icaros-web',
    records: { async create() { touched = true; return 'x' }, async find() { return null }, async ready() { return false }, async fail() {} },
    objects: { async signPut() { touched = true; return '' }, async head() { return null }, async prefix() { return null }, async remove() {} },
  })
  assert.equal((await service.presign({ kind: 'media', contentType: 'image/webp', size: 10, originalFilename: 'evil.svg' })).status, 415)
  assert.equal((await service.presign({ kind: 'video', contentType: 'video/mp4', size: 32 * 1024 * 1024 + 1, originalFilename: 'a.mp4' })).status, 413)
  assert.equal(touched, false)
})

test('confirm rejects wrong content even when HeadObject metadata claims the requested MIME', async () => {
  let failed = false
  const service = createMediaService({ bucket: 'b', prefix: 'icaros-web',
    records: { async create() { return 'x' }, async find() { return { id: 'x', bucket: 'b', key: 'icaros-web/media/x.webp', mime: 'image/webp', declaredSize: 100, status: 'pending' as const } }, async ready() { return true }, async fail() { failed = true } },
    objects: { async signPut() { return '' }, async head() { return { size: 10, contentType: 'image/webp', etag: 'e' } }, async prefix() { return new Uint8Array([60, 115, 118, 103, 62]) }, async remove() {} },
  })
  assert.equal((await service.confirm({ mediaId: 'x' })).status, 415)
  assert.equal(failed, true)
})

test('confirm accepts a measured PDF and publishes its measured size', async () => {
  let saved = 0
  const service = createMediaService({ bucket: 'b', prefix: 'icaros-web',
    records: { async create() { return 'x' }, async find() { return { id: 'x', bucket: 'b', key: 'icaros-web/media/x.pdf', mime: 'application/pdf', declaredSize: 100, status: 'pending' as const } }, async ready(_id, size) { saved = size; return true }, async fail() {} },
    objects: { async signPut() { return '' }, async head() { return { size: 20, contentType: 'application/pdf', etag: 'e' } }, async prefix() { return Buffer.from('%PDF-1.7') }, async remove() {} },
  })
  assert.equal((await service.confirm({ mediaId: 'x' })).status, 200)
  assert.equal(saved, 20)
})
