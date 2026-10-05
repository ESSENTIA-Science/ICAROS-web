import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { uploadSharedAssets } from './upload-assets.mjs'

const bytes = Buffer.from('asset')
const sha = createHash('sha256').update(bytes).digest()
function input() {
  const root = mkdtempSync(join(tmpdir(), 'icaros-upload-'))
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'assets/image.webp'), bytes)
  return { root, bucket: 'example-release-bucket', assets: [{ path: 'assets/image.webp', key: `release-assets/${'a'.repeat(64)}/assets/image.webp`, sha256: sha.toString('hex'), contentType: 'image/webp' }] }
}

test('existing divergent assets and upload permission failures reject the stage', async () => {
  const config = input()
  try {
    await assert.rejects(uploadSharedAssets({ ...config, s3: { async send(command) {
      if (command.constructor.name === 'PutObjectCommand') throw Object.assign(new Error('exists'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } })
      return { ContentLength: bytes.length, ChecksumSHA256: 'wrong' }
    } } }), /differs/)
    let count = 0
    await assert.rejects(uploadSharedAssets({ ...config, s3: { async send() {
      count++; throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
    } } }), /upload failed/)
    assert.equal(count, 1)
    writeFileSync(join(config.root, 'assets/image.webp'), 'changed')
    await assert.rejects(uploadSharedAssets({ ...config, s3: { async send() { throw new Error('must not upload') } } }), /changed/)
  } finally { rmSync(config.root, { recursive: true }) }
})

test('SDK upload keeps at most twelve requests active and binds each file checksum', async () => {
  const config = input()
  const assets = Array.from({ length: 25 }, (_, n) => {
    const path = `assets/image-${n}.webp`
    writeFileSync(join(config.root, path), bytes)
    return { path, key: `release-assets/${'a'.repeat(64)}/${path}`, sha256: sha.toString('hex'), contentType: 'image/webp' }
  })
  let active = 0; let maximum = 0; const keys = []
  try {
    await uploadSharedAssets({ root: config.root, bucket: config.bucket, assets, concurrency: 12, s3: {
      async send(command) {
        active++; maximum = Math.max(maximum, active)
        try {
          assert.equal(command.constructor.name, 'PutObjectCommand')
          assert.equal(command.input.IfNoneMatch, '*')
          assert.equal(command.input.ChecksumSHA256, sha.toString('base64'))
          keys.push(command.input.Key)
          await new Promise(resolve => setTimeout(resolve, 2))
          return {}
        } finally { active-- }
      },
    } })
    assert.equal(keys.length, 25)
    assert.equal(new Set(keys).size, 25)
    assert.ok(maximum > 1 && maximum <= 12, `maximum=${maximum}`)
  } finally { rmSync(config.root, { recursive: true }) }
})

test('SDK upload reuses an object only after exact checksum and metadata verification', async () => {
  const config = input(); const calls = []
  try {
    await uploadSharedAssets({ ...config, s3: { async send(command) {
      calls.push(command.constructor.name)
      if (command.constructor.name === 'PutObjectCommand') throw Object.assign(new Error('exists'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } })
      return { ContentLength: bytes.length, ChecksumSHA256: sha.toString('base64'), ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' }
    } } })
    assert.deepEqual(calls, ['PutObjectCommand', 'HeadObjectCommand'])
    await assert.rejects(uploadSharedAssets({ ...config, s3: { async send(command) {
      if (command.constructor.name === 'PutObjectCommand') throw Object.assign(new Error('exists'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } })
      return { ContentLength: bytes.length, ChecksumSHA256: 'different', ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' }
    } } }), /differs/)
  } finally { rmSync(config.root, { recursive: true }) }
})
