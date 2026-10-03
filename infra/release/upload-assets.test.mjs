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

test('shared assets bind checksum and create-only condition, then exact existing metadata permits dedupe', () => {
  const config = input(); const calls = []
  try {
    uploadSharedAssets({ ...config, aws: args => {
      calls.push(args)
      if (args[1] === 'put-object') return { status: 1, stderr: 'An error occurred (PreconditionFailed) (412)' }
      return { status: 0, stdout: JSON.stringify({ ContentLength: bytes.length, ChecksumSHA256: sha.toString('base64'), ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' }) }
    } })
    assert.equal(calls.length, 2)
    assert.equal(calls[0][calls[0].indexOf('--if-none-match') + 1], '*')
    assert.equal(calls[0][calls[0].indexOf('--checksum-sha256') + 1], sha.toString('base64'))
    assert.ok(calls[1].includes('--checksum-mode'))
  } finally { rmSync(config.root, { recursive: true }) }
})

test('existing divergent assets and upload permission failures cannot publish a successful manifest', () => {
  const config = input()
  try {
    assert.throws(() => uploadSharedAssets({ ...config, aws: args => args[1] === 'put-object' ? { status: 1, stderr: 'PreconditionFailed' } : { status: 0, stdout: JSON.stringify({ ContentLength: bytes.length, ChecksumSHA256: 'wrong' }) } }), /differs/)
    let count = 0
    assert.throws(() => uploadSharedAssets({ ...config, aws: () => { count++; return { status: 1, stderr: 'AccessDenied' } } }), /upload failed/)
    assert.equal(count, 1)
    writeFileSync(join(config.root, 'assets/image.webp'), 'changed')
    assert.throws(() => uploadSharedAssets({ ...config, aws: () => { throw new Error('must not upload') } }), /changed/)
  } finally { rmSync(config.root, { recursive: true }) }
})
