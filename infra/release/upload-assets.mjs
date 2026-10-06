import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sharedAssetPath } from './asset-contract.mjs'
import { createHash } from 'node:crypto'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

const immutableCache = 'public, max-age=31536000, immutable'
const sha = bytes => createHash('sha256').update(bytes).digest()
const status = error => error?.$metadata?.httpStatusCode

export async function boundedMap(items, concurrency, work) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 24) throw new TypeError('Invalid upload concurrency')
  let next = 0
  let firstError
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length && !firstError) {
      const item = items[next++]
      try { await work(item) } catch (error) { firstError ??= error }
    }
  }))
  if (firstError) throw firstError
}

/** Create-only immutable upload. Existing keys must match exact bytes and metadata. */
export async function uploadSharedAssets({ root, bucket, assets, s3, concurrency = 12 }) {
  if (!root || !bucket || !Array.isArray(assets) || !s3?.send) throw new TypeError('Invalid upload inputs')
  await boundedMap(assets, concurrency, async asset => {
    if (!sharedAssetPath(asset.path) || !/^release-assets\/[a-f0-9]{64}\//.test(asset.key) || asset.key.split('/').slice(2).join('/') !== asset.path)
      throw new Error('Invalid shared asset key')
    const bytes = readFileSync(join(root, asset.path))
    const digest = sha(bytes)
    if (digest.toString('hex') !== asset.sha256) throw new Error('Asset changed after export preparation')
    const checksum = digest.toString('base64')
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: asset.key, Body: bytes,
          IfNoneMatch: '*', ChecksumSHA256: checksum, ContentType: asset.contentType, CacheControl: immutableCache }))
        return
      } catch (error) {
        if (error?.name === 'PreconditionFailed' || status(error) === 412) {
          const existing = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.key, ChecksumMode: 'ENABLED' }))
          if (existing.ChecksumSHA256 !== checksum || existing.ContentLength !== bytes.length ||
            existing.ContentType !== asset.contentType || existing.CacheControl !== immutableCache)
            throw new Error('Existing shared asset differs from prepared bytes')
          return
        }
        if (status(error) !== 409 || attempt === 3) throw new Error('Shared immutable asset upload failed', { cause: error })
      }
    }
  })
}
