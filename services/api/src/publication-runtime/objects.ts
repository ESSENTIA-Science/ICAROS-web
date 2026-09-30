import { createHash } from 'node:crypto'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { SnapshotStore } from '../snapshot.js'

type ObjectClient = Pick<S3Client, 'send'>
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const missing = (error: unknown) => error instanceof Error && ['NotFound', 'NoSuchKey'].includes(error.name)

/** A content-addressed object is never overwritten, including during retries. */
export function createImmutableSnapshotStore(options: {
  bucket: string; prefix: string; client: ObjectClient
}): SnapshotStore {
  const { bucket, prefix, client } = options
  if (!bucket || !/^[a-zA-Z0-9/_-]+$/.test(prefix) || prefix.includes('..') || prefix.endsWith('/'))
    throw new TypeError('Invalid snapshot location')
  return {
    async put({ version, bytes, sha256 }) {
      if (!Number.isSafeInteger(version) || version < 1 || !/^[a-f0-9]{64}$/.test(sha256) || hash(bytes) !== sha256)
        throw new TypeError('Invalid snapshot content')
      const key = `${prefix}/v${version}/${sha256}.json`
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
          ContentType: 'application/json; charset=utf-8', CacheControl: 'private, no-store', IfNoneMatch: '*' }))
      } catch (error) {
        // A retried write may encounter the exact same immutable object.
        if (!(error instanceof Error && ['PreconditionFailed', 'ConditionalRequestConflict'].includes(error.name))) throw error
        const existing = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        if (!existing.Body || hash(Buffer.from(await existing.Body.transformToByteArray())) !== sha256) throw new Error('Snapshot collision')
      }
      return `s3://${bucket}/${key}`
    },
  }
}

export function createSnapshotVerifier(options: { bucket: string; prefix: string; client: ObjectClient }) {
  return async (ref: string, sha256: string): Promise<void> => {
    if (!/^[a-f0-9]{64}$/.test(sha256) || !ref.startsWith(`s3://${options.bucket}/${options.prefix}/`) ||
      !ref.endsWith(`/${sha256}.json`)) throw new Error('Foreign snapshot reference')
    const key = ref.slice(`s3://${options.bucket}/`.length)
    try {
      const object = await options.client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }))
      if (!object.Body || hash(Buffer.from(await object.Body.transformToByteArray())) !== sha256) throw new Error('Snapshot digest mismatch')
    } catch (error) { if (missing(error)) throw new Error('Snapshot missing'); throw error }
  }
}
