import '@aws-sdk/signature-v4a'
import { createHash } from 'node:crypto'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

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
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024
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

/** The API reads current DB references; IAM invocation never exposes its database credentials. */
export function createLambdaMemberMediaAuthority({ lambda, functionName }) {
  if (typeof functionName !== 'string' || !functionName.trim()) throw new Error('Current member authority required')
  return async (id, sha256, entityType) => {
    if (!UUID.test(id) || !/^[a-f0-9]{64}$/.test(sha256) || !TYPES.has(entityType)) throw new Error('Invalid authority request')
    const result = await lambda.send(new InvokeCommand({ FunctionName: functionName, InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ kind: 'icaros.media.authorize', mediaId: id, sha256, member: entityType === 'member' })) }),
    { abortSignal: AbortSignal.timeout(5000) })
    if (result.StatusCode !== 200 || result.FunctionError || !(result.Payload instanceof Uint8Array) ||
        result.Payload.length < 1 || result.Payload.length > 1024) throw new Error('Current member authority unavailable')
    const value = JSON.parse(Buffer.from(result.Payload).toString('utf8'))
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.authorized !== 'boolean')
      throw new Error('Invalid current member authority response')
    return value.authorized
  }
}

/** Injected ports keep tests offline. Nothing queries the shared database. */
export function createMediaProxy({ getRelease, getSnapshotPointer, getObject, getMemberPublished, requireCurrentMemberState = false }) {
  return async (event) => {
    const method = event.requestContext?.http?.method
    const id = /^\/api\/media\/([a-f0-9-]{36})$/i.exec(event.rawPath ?? '')?.[1]?.toLowerCase()
    if (!id || !UUID.test(id)) return response(404)
    if (!['GET', 'HEAD'].includes(method)) return response(405)
    try {
      let index
      let approvedMembers
      if (getSnapshotPointer) {
        const pointer = await getSnapshotPointer()
        if (!pointer || Object.keys(pointer).some(key => !['version', 'key', 'sha256'].includes(key)) ||
            !Number.isSafeInteger(pointer.version) || pointer.version < 1 || !/^[a-f0-9]{64}$/.test(pointer.sha256) ||
            pointer.key !== `snapshots/v${pointer.version}/${pointer.sha256}.json`) return response(503)
        const snapshotObject = await getObject('snapshot', pointer.key)
        if (!snapshotObject || snapshotObject.size < 1 || snapshotObject.size > MAX_SNAPSHOT_BYTES) return response(503)
        const snapshotBytes = await snapshotObject.bytes()
        if (snapshotBytes.length !== snapshotObject.size || digest(snapshotBytes) !== pointer.sha256) return response(503)
        const snapshot = JSON.parse(Buffer.from(snapshotBytes).toString('utf8'))
        if (snapshot.version !== String(pointer.version) || !Array.isArray(snapshot.members)) return response(503)
        index = validateMediaIndex(snapshot.compatMediaIndex, String(pointer.version))
        approvedMembers = new Set()
        for (const member of snapshot.members) {
          if (!member || member.published !== true) return response(503)
          const urls = [member.imageSrc, ...typeof member.bioMd === 'string'
            ? [...member.bioMd.matchAll(/\/api\/media\/([a-f0-9-]{36})/gi)].map(match => match[0]) : []]
          for (const url of urls) {
            const match = /^\/api\/media\/([a-f0-9-]{36})$/i.exec(url ?? '')
            if (!match) continue
            const memberId = match[1].toLowerCase()
            if (!Object.hasOwn(index.media, memberId) || index.media[memberId].entityType !== 'member') return response(503)
            approvedMembers.add(memberId)
          }
        }
      } else {
        const release = await getRelease()
        const match = RELEASE.exec(release)
        if (!match) return response(503)
        const indexObject = await getObject('release', `${release}/compat-media-index.json`)
        if (!indexObject || indexObject.size < 1 || indexObject.size > MAX_INDEX_BYTES) return response(503)
        const indexBytes = await indexObject.bytes()
        if (indexBytes.length !== indexObject.size || indexBytes.length > MAX_INDEX_BYTES) return response(503)
        index = validateMediaIndex(JSON.parse(Buffer.from(indexBytes).toString('utf8')), match[1])
        if (Object.hasOwn(index.media, id) && index.media[id].entityType === 'member') {
          const allowObject = await getObject('release', `${release}/published-member-media.json`)
          if (!allowObject || allowObject.size < 1 || allowObject.size > MAX_INDEX_BYTES) return response(503)
          const allowBytes = await allowObject.bytes()
          if (allowBytes.length !== allowObject.size) return response(503)
          const allow = JSON.parse(Buffer.from(allowBytes).toString('utf8'))
          if (allow.version !== match[1] || !Array.isArray(allow.mediaIds) ||
              Object.keys(allow).some(k => !['version', 'mediaIds'].includes(k)) ||
              allow.mediaIds.length > 10000 || allow.mediaIds.some(x => typeof x !== 'string' || !UUID.test(x)) ||
              new Set(allow.mediaIds).size !== allow.mediaIds.length) return response(503)
          approvedMembers = new Set(allow.mediaIds)
        }
      }
      if (!Object.hasOwn(index.media, id)) return response(404)
      const media = index.media[id]
      if (media.entityType === 'member') {
        if (!approvedMembers?.has(id)) return response(404)
      }
      // Historical indexes may label a portrait public; check current protection for every UUID.
      if (requireCurrentMemberState && typeof getMemberPublished !== 'function') return response(503)
      if (getMemberPublished && await getMemberPublished(id, media.sha256, media.entityType) !== true) return response(404)
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
async function handle(event) {
  try {
    if (!active) {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')
      const releaseBucket = process.env.RELEASE_BUCKET
      const publicBucket = process.env.PUBLIC_MEDIA_BUCKET
      const privateBucket = process.env.PRIVATE_MEDIA_BUCKET
      const kvsArn = process.env.CLOUDFRONT_KVS_ARN
      const gMode = process.env.ICAROS_PUBLICATION_MODE === 'g'
      const snapshotBucket = process.env.SNAPSHOT_BUCKET
      const authorityFunction = process.env.MEMBER_AUTHORITY_FUNCTION
      if (!publicBucket || !privateBucket || publicBucket === privateBucket ||
          !authorityFunction ||
          (gMode ? !snapshotBucket || new Set([snapshotBucket, publicBucket, privateBucket]).size !== 3 :
            !releaseBucket || new Set([releaseBucket, publicBucket, privateBucket]).size !== 3 || !kvsArn)) return response(503)
      const s3 = new S3Client({})
      const kvsSdk = gMode ? null : await import('@aws-sdk/client-cloudfront-keyvaluestore')
      const kvs = kvsSdk ? new kvsSdk.CloudFrontKeyValueStoreClient({}) : null
      active = createMediaProxy({
        requireCurrentMemberState: true,
        getMemberPublished: createLambdaMemberMediaAuthority({
          lambda: new LambdaClient({ maxAttempts: 1 }), functionName: authorityFunction,
        }),
        ...(gMode ? { getSnapshotPointer: async () => {
          const object = await s3.send(new GetObjectCommand({ Bucket: snapshotBucket, Key: 'control/g-pointer.json' }))
          if (!object.Body || !object.ContentLength || object.ContentLength > 4096) throw new Error('Invalid G pointer object')
          const bytes = await object.Body.transformToByteArray()
          if (bytes.length !== object.ContentLength) throw new Error('Invalid G pointer size')
          return JSON.parse(Buffer.from(bytes).toString('utf8'))
        } } : {}),
        getRelease: async () => {
          if (!kvs || !kvsSdk) throw new Error('Release pointer not configured')
          return (await kvs.send(new kvsSdk.GetKeyCommand({ KvsARN: kvsArn, Key: 'release' }))).Value ?? ''
        },
        getObject: async (kind, key) => {
          const result = await s3.send(new GetObjectCommand({ Bucket: kind === 'snapshot' ? snapshotBucket : kind === 'release' ? releaseBucket : kind === 'private' ? privateBucket : publicBucket, Key: key }))
          if (!result.Body) return null
          return { size: result.ContentLength ?? 0, mime: result.ContentType ?? '',
            bytes: () => result.Body.transformToByteArray() }
        },
      })
    }
    return await active(event)
  } catch { return response(503) }
}

/** Logs only coarse response fields; object IDs and private keys never enter logs. */
export async function handler(event) {
  const result = await handle(event)
  console.info(JSON.stringify({ event: 'media.response', statusCode: result.statusCode,
    method: ['GET', 'HEAD'].includes(event.requestContext?.http?.method) ? event.requestContext.http.method : 'OTHER',
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME, logGroup: process.env.AWS_LAMBDA_LOG_GROUP_NAME }))
  return result
}
