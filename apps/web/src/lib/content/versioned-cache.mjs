import path from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const shaPattern = /^[a-f0-9]{64}$/

/** Each immutable snapshot owns a separate ISR cache namespace. */
export function createVersionedIncrementalCache({ s3, bucket, buildId, prefix = '', currentSnapshot }) {
  if (!s3 || !bucket || !buildId || typeof currentSnapshot !== 'function') {
    throw new TypeError('Invalid versioned cache configuration')
  }
  const objectKey = (key, cacheType = 'cache') => {
    const snapshot = currentSnapshot()
    if (typeof snapshot !== 'string' || !shaPattern.test(snapshot)) {
      throw new Error('Missing immutable snapshot context')
    }
    if (typeof key !== 'string' || !key || key.split('/').includes('..') || !['cache', 'fetch'].includes(cacheType)) {
      throw new TypeError('Invalid incremental cache key')
    }
    return path.posix.join(prefix, snapshot, cacheType === 'fetch' ? '__fetch' : '', buildId,
      cacheType === 'fetch' ? key : `${key}.cache`)
  }
  return {
    name: 'icaros-versioned-s3',
    async get(key, cacheType) {
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(key, cacheType) }))
      return {
        value: JSON.parse(await response.Body.transformToString()),
        lastModified: response.LastModified?.getTime(),
      }
    },
    async set(key, value, cacheType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey(key, cacheType),
        Body: JSON.stringify(value), ContentType: 'application/json' }))
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key, 'cache') }))
    },
  }
}

let runtimeCache
function getRuntimeCache() {
  runtimeCache ??= createVersionedIncrementalCache({
    s3: new S3Client({ region: process.env.CACHE_BUCKET_REGION }),
    bucket: process.env.CACHE_BUCKET_NAME,
    buildId: process.env.OPEN_NEXT_BUILD_ID,
    prefix: process.env.CACHE_BUCKET_KEY_PREFIX,
    currentSnapshot: () => globalThis.__icarosSnapshotContext?.getStore(),
  })
  return runtimeCache
}

const versionedCache = {
  name: 'icaros-versioned-s3',
  get: (...args) => getRuntimeCache().get(...args),
  set: (...args) => getRuntimeCache().set(...args),
  delete: (...args) => getRuntimeCache().delete(...args),
}

export default versionedCache
