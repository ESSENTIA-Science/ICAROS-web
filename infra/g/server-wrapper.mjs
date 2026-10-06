import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { handler as openNextHandler } from './open-next-entry.mjs'
import { visiblePosts } from './visible-posts.mjs'

const bucket = process.env.ICAROS_SNAPSHOT_BUCKET
const pointerKey = process.env.ICAROS_POINTER_KEY ?? 'control/pointer.json'
const pointerFile = '/tmp/icaros-pointer.json'
const snapshotFile = '/tmp/icaros-snapshot.json'
const client = new S3Client({ region: process.env.AWS_REGION })
const scope = globalThis.__icarosSnapshotContext ??= new AsyncLocalStorage()
let cachedPointer = ''
let cachedSha = ''

async function loadSnapshot(pointerText) {
  if (!bucket) throw new Error('Snapshot bucket missing')
  if (pointerText === cachedPointer) return cachedSha
  const pointer = JSON.parse(pointerText)
  if (!Number.isSafeInteger(pointer.version) || pointer.version < 1 ||
      !/^snapshots\/[a-zA-Z0-9/_-]+\.json$/.test(pointer.key) ||
      !/^[a-f0-9]{64}$/.test(pointer.sha256)) {
    throw new Error('Invalid public snapshot pointer')
  }
  const snapshotResult = await client.send(new GetObjectCommand({ Bucket: bucket, Key: pointer.key }))
  const bytes = Buffer.from(await snapshotResult.Body.transformToByteArray())
  if (createHash('sha256').update(bytes).digest('hex') !== pointer.sha256) {
    throw new Error('Public snapshot hash mismatch')
  }
  writeFileSync(`${snapshotFile}.next`, bytes)
  renameSync(`${snapshotFile}.next`, snapshotFile)
  writeFileSync(`${pointerFile}.next`, JSON.stringify({ path: snapshotFile, sha256: pointer.sha256 }))
  renameSync(`${pointerFile}.next`, pointerFile)
  cachedPointer = pointerText
  cachedSha = pointer.sha256
  return cachedSha
}

async function refreshSnapshot() {
  const pointerResult = await client.send(new GetObjectCommand({ Bucket: bucket, Key: pointerKey }))
  return loadSnapshot(await pointerResult.Body.transformToString())
}

async function preflight(event, context) {
  const { snapshot } = event
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid preflight request')
  const sha = await loadSnapshot(JSON.stringify(snapshot))
  const data = JSON.parse(readFileSync(snapshotFile, 'utf8'))
  const paths = new Set(['/', '/member/', '/vehicles/', '/posts/', '/missions/', '/sitemap.xml'])
  for (const type of data.taxonomy.types) paths.add(`/vehicles/types/${type.id}/`)
  for (const series of data.taxonomy.series) paths.add(`/vehicles/types/${series.typeId}/${series.id}/`)
  for (const vehicle of data.vehicles) paths.add(`/vehicles/${vehicle.slug}/`)
  for (const mission of data.missions) paths.add(`/missions/${mission.id}/`)
  for (const post of data.posts) paths.add(post.source === 'legacy' ? `/posts/legacy/${post.slug}/` : `/posts/${post.id}/`)
  for (let page = 2; page <= Math.ceil(visiblePosts(data.posts).length / 15); page++) paths.add(`/posts/page/${page}/`)
  for (const path of paths) {
    const request = { version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '',
      headers: { host: 'icaros.kr' }, requestContext: { http: { method: 'GET', path, protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1', userAgent: 'ICAROS preflight' } }, isBase64Encoded: false }
    const response = await scope.run(sha, () => openNextHandler(request, context))
    if (response.statusCode !== 200) throw new Error(`Preflight failed: ${path}: ${response.statusCode}`)
  }
  return { ok: true, sha256: sha, routes: paths.size }
}

export async function handler(event, context) {
  if (event?.kind === 'icaros.g.preflight') return preflight(event, context)
  const snapshotSha = await refreshSnapshot()
  const response = await scope.run(snapshotSha, () => openNextHandler(event, context))
  return { ...response, headers: { ...response.headers, 'x-icaros-snapshot-sha': snapshotSha } }
}
