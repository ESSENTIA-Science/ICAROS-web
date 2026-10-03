import '@aws-sdk/signature-v4a'
import { createHash } from 'node:crypto'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const RELEASE = /^releases\/v([1-9][0-9]*)-[a-f0-9]{64}$/
const TYPES = new Set(['post', 'panel', 'rocket', 'mission', 'member'])
const MIME_EXT = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'],
  ['image/avif', 'avif'], ['image/gif', 'gif'], ['video/mp4', 'mp4'],
  ['application/pdf', 'pdf'], ['model/gltf-binary', 'glb'],
])
const MAX_BYTES = 3 * 1024 * 1024
const MAX_INDEX_BYTES = 1024 * 1024
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const response = (statusCode, body = '', mime = 'text/plain; charset=utf-8', binary = false) => ({
  statusCode,
  headers: { 'content-type': mime, 'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff' },
  body, isBase64Encoded: binary,
})

/** Exact selected-publication contract; private entries are member raster copies only. */
export function validateMediaIndex(value, version) {
  if (!value || Array.isArray(value) || Object.keys(value).some(k => !['version', 'media'].includes(k)) || value.version !== version ||
      !value.media || typeof value.media !== 'object' || Array.isArray(value.media) ||
      Object.keys(value.media).length > 10000) throw new Error('Invalid media index')
  for (const [id, media] of Object.entries(value.media)) {
    if (!UUID.test(id) || !media || Object.keys(media).some(k => !['key', 'sha256', 'mime', 'size', 'entityType', 'storage'].includes(k)) || !TYPES.has(media.entityType) ||
        !MIME_EXT.has(media.mime) || !/^[a-f0-9]{64}$/.test(media.sha256) ||
        !Number.isSafeInteger(media.size) || media.size < 1 || media.size > (media.mime === 'video/mp4' ? 32 * 1024 * 1024 : ['application/pdf', 'model/gltf-binary'].includes(media.mime) ? 8 * 1024 * 1024 : MAX_BYTES) ||
        (media.entityType === 'member' ? media.storage !== 'private' || !media.mime.startsWith('image/') : media.storage !== 'public') ||
        media.key !== `published/${id}/${media.sha256}.${MIME_EXT.get(media.mime)}`) {
      throw new Error('Invalid selected media entry')
    }
  }
  return value
}

/** Injected ports keep tests offline. Nothing queries the shared database. */
export function createMediaProxy({ getRelease, getObject, getMemberPublished }) {
  return async (event) => {
    const method = event.requestContext?.http?.method
    const id = /^\/api\/media\/([a-f0-9-]{36})$/i.exec(event.rawPath ?? '')?.[1]?.toLowerCase()
    if (!id || !UUID.test(id)) return response(404)
    if (!['GET', 'HEAD'].includes(method)) return response(405)
    try {
      const release = await getRelease()
      const match = RELEASE.exec(release)
      if (!match) return response(503)
      const indexObject = await getObject('release', `${release}/compat-media-index.json`)
      if (!indexObject || indexObject.size < 1 || indexObject.size > MAX_INDEX_BYTES) return response(503)
      const indexBytes = await indexObject.bytes()
      if (indexBytes.length !== indexObject.size || indexBytes.length > MAX_INDEX_BYTES) return response(503)
      const index = validateMediaIndex(JSON.parse(Buffer.from(indexBytes).toString('utf8')), match[1])
      if (!Object.hasOwn(index.media, id)) return response(404)
      const media = index.media[id]
      if (media.entityType === 'member') {
        // Every request uses the active publication allowlist. Withdrawal takes
        // effect on publish. A parent live-state verifier can tighten this further.
        const allowObject = await getObject('release', `${release}/published-member-media.json`)
        if (!allowObject || allowObject.size < 1 || allowObject.size > MAX_INDEX_BYTES) return response(503)
        const allowBytes = await allowObject.bytes()
        if (allowBytes.length !== allowObject.size) return response(503)
        const allow = JSON.parse(Buffer.from(allowBytes).toString('utf8'))
        if (allow.version !== match[1] || !Array.isArray(allow.mediaIds) ||
            Object.keys(allow).some(k => !['version', 'mediaIds'].includes(k)) ||
            allow.mediaIds.length > 10000 || allow.mediaIds.some(x => typeof x !== 'string' || !UUID.test(x)) ||
            new Set(allow.mediaIds).size !== allow.mediaIds.length) return response(503)
        if (!allow.mediaIds.includes(id) || (getMemberPublished && await getMemberPublished(id, media.sha256) !== true)) return response(404)
      }
      // Buffered Lambda + base64 cannot carry the publisher's 8/32 MiB files.
      // Preserve the valid index; fail this request explicitly until streaming is designed.
      if (media.size > MAX_BYTES) return response(413)
      const object = await getObject(media.storage, media.key)
      if (!object || object.size !== media.size || object.mime !== media.mime) return response(503)
      const bytes = await object.bytes()
      if (bytes.length !== media.size || digest(bytes) !== media.sha256) return response(503)
      // API Gateway binary response; no redirect to a signed URL, no UUID cache.
      return response(200, method === 'HEAD' ? '' : Buffer.from(bytes).toString('base64'), media.mime, method !== 'HEAD')
    } catch {
      return response(503)
    }
  }
}

let active
export async function handler(event) {
  try {
    if (!active) {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')
      const { CloudFrontKeyValueStoreClient, GetKeyCommand } = await import('@aws-sdk/client-cloudfront-keyvaluestore')
      const releaseBucket = process.env.RELEASE_BUCKET
      const publicBucket = process.env.PUBLIC_MEDIA_BUCKET
      const privateBucket = process.env.PRIVATE_MEDIA_BUCKET
      const kvsArn = process.env.CLOUDFRONT_KVS_ARN
      if (!releaseBucket || !publicBucket || !privateBucket || new Set([releaseBucket, publicBucket, privateBucket]).size !== 3 || !kvsArn) return response(503)
      const s3 = new S3Client({})
      const kvs = new CloudFrontKeyValueStoreClient({})
      active = createMediaProxy({
        getRelease: async () => (await kvs.send(new GetKeyCommand({ KvsARN: kvsArn, Key: 'release' }))).Value ?? '',
        getObject: async (kind, key) => {
          const result = await s3.send(new GetObjectCommand({ Bucket: kind === 'release' ? releaseBucket : kind === 'private' ? privateBucket : publicBucket, Key: key }))
          if (!result.Body) return null
          return { size: result.ContentLength ?? 0, mime: result.ContentType ?? '',
            bytes: () => result.Body.transformToByteArray() }
        },
      })
    }
    return await active(event)
  } catch { return response(503) }
}
