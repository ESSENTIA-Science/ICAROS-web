import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { awsCredentialsProvider } from '@vercel/functions/oidc'
import type { MediaDependencies } from '../media/index.js'

type Client = Pick<S3Client, 'send'>
type Sign = (client: S3Client, command: PutObjectCommand, options: { expiresIn: number; signableHeaders: Set<string> }) => Promise<string>
export interface S3MediaOptions {
  bucket: string
  prefix: string
  region?: string
  endpoint?: string
  roleArn?: string
  client?: Client
  sign?: Sign
}
function missing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = 'name' in error ? error.name : undefined
  const status = '$metadata' in error && error.$metadata && typeof error.$metadata === 'object' && 'httpStatusCode' in error.$metadata ? error.$metadata.httpStatusCode : undefined
  return code === 'NotFound' || code === 'NoSuchKey' || status === 404
}
function etag(raw: string | undefined): string | null { return raw?.replace(/^W\//i, '').replace(/^"|"$/g, '') || null }

export function createS3MediaObjects(options: S3MediaOptions): MediaDependencies['objects'] {
  const { bucket, prefix } = options
  if (!bucket || !/^[a-z0-9][a-z0-9-]*$/.test(prefix) || prefix === 'forum') throw new TypeError('Private S3 configuration required')
  const region = options.region ?? process.env.AWS_REGION
  const client = options.client ?? new S3Client({ ...(region ? { region } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
    ...((options.roleArn ?? process.env.AWS_ROLE_ARN) ? { credentials: awsCredentialsProvider({ roleArn: (options.roleArn ?? process.env.AWS_ROLE_ARN)! }) } : {}) })
  const sign = options.sign ?? getSignedUrl
  function check(actualBucket: string, key: string) {
    if (actualBucket !== bucket || !key.startsWith(`${prefix}/`) || key.includes('//') || key.includes('\\') || key.split('/').some(part => part === '.' || part === '..')) throw new TypeError('Foreign media object')
  }
  return {
    async signPut(input) {
      check(input.bucket, input.key)
      if (input.expiresIn !== 600 || input.signableHeaders.join(',') !== 'content-type,host') throw new TypeError('Invalid signature policy')
      return sign(client as S3Client, new PutObjectCommand({ Bucket: input.bucket, Key: input.key, ContentType: input.contentType }),
        { expiresIn: input.expiresIn, signableHeaders: new Set(input.signableHeaders) })
    },
    async head(actualBucket, key) {
      check(actualBucket, key)
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: actualBucket, Key: key }))
        return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? null, etag: etag(result.ETag) }
      } catch (error) { if (missing(error)) return null; throw error }
    },
    async prefix(actualBucket, key, bytes) {
      check(actualBucket, key)
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 4096) throw new TypeError('Invalid prefix length')
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: actualBucket, Key: key, Range: `bytes=0-${bytes - 1}` }))
        return result.Body ? await result.Body.transformToByteArray() : new Uint8Array()
      } catch (error) {
        if (missing(error)) return null
        if (error && typeof error === 'object' && '$metadata' in error && error.$metadata && typeof error.$metadata === 'object' && 'httpStatusCode' in error.$metadata && error.$metadata.httpStatusCode === 416) return new Uint8Array()
        throw error
      }
    },
    async remove(actualBucket, key) {
      check(actualBucket, key)
      try { await client.send(new DeleteObjectCommand({ Bucket: actualBucket, Key: key })) }
      catch (error) { if (!missing(error)) throw error }
    },
  }
}
