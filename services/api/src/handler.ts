import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { S3Client } from '@aws-sdk/client-s3'
import { BatchGetBuildsCommand, CodeBuildClient } from '@aws-sdk/client-codebuild'
import { CloudFrontKeyValueStoreClient } from '@aws-sdk/client-cloudfront-keyvaluestore'
import { createApiHandler } from './api.js'
import type { HttpEvent } from './http.js'
import { createPostgresAuthAdapters } from './adapters/postgres-auth.js'
import { verifyAdminPassword } from './auth/password.js'
import { createPostgresContentRepository } from './adapters/postgres-content.js'
import { createPostgresDepartmentRepository } from './adapters/postgres-departments.js'
import { createContentReaders } from './adapters/content-readers.js'
import { createEssentiaPostsAdapter } from './essentia/posts.js'
import { createPostgresPublicationRepository, createPostgresPublicationSource } from './adapters/postgres-publication.js'
import { createPostgresMediaRecords } from './adapters/postgres-media.js'
import { createS3MediaObjects } from './adapters/s3-media.js'
import { createPostgresDonationRepository } from './adapters/postgres-donation.js'
import { createVehicleMediaRepository } from './adapters/vehicle-media.js'
import { createSnapshotExporter } from './snapshot.js'
import { createPostgresSnapshotSource } from './publication-runtime/source.js'
import { createImmutableSnapshotStore, createSnapshotVerifier } from './publication-runtime/objects.js'
import { createBuildLauncher } from './publication-runtime/build.js'
import { createAwsBuildRuntime } from './publication-runtime/aws.js'
import { createLocalPublication } from './local-publication.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value
}

function runtime() {
  const local = process.env.API_LOCAL === '1'
  const url = new URL(local ? process.env.ICAROS_LOCAL_DATABASE_URL ?? required('DATABASE_URL') : required('DATABASE_URL'))
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) throw new Error('Invalid DATABASE_URL')
  if (local && (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '5435')) throw new Error('Local database must use loopback port 5435')
  if (local && process.env.S3_ENDPOINT) {
    const endpoint = new URL(process.env.S3_ENDPOINT)
    if (!['http:', 'https:'].includes(endpoint.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Local S3 endpoint must use loopback')
  }
  const allowedOrigins = required('ADMIN_ALLOWED_ORIGINS').split(',').map(value => value.trim())
  if (allowedOrigins.some(value => !/^https:\/\/[^/?#]+$/.test(value) && !(local && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(value)))) throw new Error('Invalid admin origin')
  const ssl = local ? undefined : { ca: readFileSync(required('DB_CA_BUNDLE_PATH'), 'utf8'), rejectUnauthorized: true }
  const pool = new Pool({ connectionString: url.toString(), max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, options: '-c search_path=icaros', ...(ssl ? { ssl } : {}) })
  const db = { query: async (sql: string, params?: readonly unknown[]) => {
    const result = await pool.query(sql, params as unknown[] | undefined)
    return { rows: result.rows as Record<string, unknown>[] }
  } }
  const auth = createPostgresAuthAdapters(db, { verifyPassword: verifyAdminPassword })
  const contentRepository = createPostgresContentRepository(db)
  const essentiaNames = ['ESSENTIA_SERVICE_ORIGIN', 'ESSENTIA_SERVICE_TOKEN', 'ESSENTIA_SERVICE_CATEGORY', 'ESSENTIA_AUTHOR_LABEL']
  const posts = essentiaNames.every(name => process.env[name]?.trim())
    ? createEssentiaPostsAdapter({ origin: required('ESSENTIA_SERVICE_ORIGIN'), token: required('ESSENTIA_SERVICE_TOKEN'),
      category: required('ESSENTIA_SERVICE_CATEGORY'), authorLabel: required('ESSENTIA_AUTHOR_LABEL') })
    : undefined
  const readers = createContentReaders(contentRepository, posts)
  const bucket = process.env.S3_BUCKET
  const prefix = process.env.S3_PREFIX
  const workerToken = process.env.BUILD_WORKER_TOKEN
  const sourceRevision = process.env.WEB_SOURCE_REVISION
  const unavailable = async (): Promise<never> => { throw new Error('Publication adapters not configured') }
  const essentiaPosts = posts ?? { create: unavailable, update: unavailable, delete: unavailable }
  const mediaOrigin = process.env.PUBLIC_MEDIA_ORIGIN
  const codeBuildProject = process.env.CODEBUILD_PROJECT
  const kvsArn = process.env.CLOUDFRONT_KVS_ARN
  const publicationReady = local ? !!workerToken : !!(posts && bucket && workerToken && sourceRevision && mediaOrigin && codeBuildProject && kvsArn)
  let snapshotExporter: { export(version: number): Promise<{ snapshotRef: string; snapshotSha256: string }> } = { export: unavailable }
  let buildLauncher: { launch(job: import('./publish/index.js').PublicationJob): Promise<void>; promote(job: import('./publish/index.js').PublicationJob): Promise<void> } = { launch: unavailable, promote: unavailable }
  if (local && publicationReady) {
    const localPublication = createLocalPublication(job => {
      const callback = async (result: 'complete' | 'fail') => {
        const response = await active?.api({ rawPath: `/api/internal/publish/${job.id}/${result}`,
          requestContext: { http: { method: 'POST' } },
          headers: { authorization: `Bearer ${workerToken}` }, body: JSON.stringify({ attempt: job.attempt }) })
        if (!response || response.statusCode !== 200) throw new Error('Local publication callback failed')
      }
      void callback('complete').catch(() => callback('fail').catch(() => {}))
    })
    snapshotExporter = localPublication.snapshotExporter
    buildLauncher = localPublication.buildLauncher
  } else if (publicationReady) {
    if (!/^[a-fA-F0-9]{40}$/.test(sourceRevision!) || process.env.S3_ENDPOINT) throw new Error('Invalid production publication configuration')
    const origin = new URL(mediaOrigin!)
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
        origin.hostname.endsWith('amazonaws.com')) throw new Error('Invalid public media origin')
    const s3 = new S3Client({})
    const source = createPostgresSnapshotSource({ pool, essentia: posts!, media: {
      async url(_id, media) {
        if (media.bucket !== bucket || typeof media.key !== 'string' || !/^[a-zA-Z0-9/_-]+\/[a-zA-Z0-9/_.-]+$/.test(media.key) ||
            media.key.includes('..')) throw new Error('Invalid public media key')
        return new URL(media.key, origin).toString()
      },
    } })
    snapshotExporter = createSnapshotExporter(source, createImmutableSnapshotStore({ bucket: bucket!, prefix: 'snapshots', client: s3 }))
    const runner = createAwsBuildRuntime({ codeBuild: new CodeBuildClient({}), s3,
      kvs: new CloudFrontKeyValueStoreClient({}), bucket: bucket!, kvsArn: kvsArn!, releasePrefix: 'releases' })
    buildLauncher = createBuildLauncher({ project: codeBuildProject!, stagingPrefix: '__staging', runtime: runner,
      verifySnapshot: createSnapshotVerifier({ bucket: bucket!, prefix: 'snapshots', client: s3 }) })
  }
  const api = createApiHandler({ allowedOrigins, ...auth, contentRepository,
    donation: createPostgresDonationRepository(pool),
    vehicleMedia: createVehicleMediaRepository(pool),
    departmentRepository: createPostgresDepartmentRepository(pool), essentiaPosts, ...readers,
    ...(posts ? { publishPost: (id: string, version: string) => posts.publishDraft(id, version) } : {}),
    publicationRepository: createPostgresPublicationRepository(pool),
    publicationSource: sourceRevision ? createPostgresPublicationSource(pool, sourceRevision) : { prepare: unavailable },
    ...(bucket && prefix ? { media: { bucket, prefix, records: createPostgresMediaRecords(db), objects: createS3MediaObjects({ bucket, prefix,
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}) }) } } : {}),
    snapshotExporter, buildLauncher,
    requireBuildWorker: async event => {
      const auth = Object.entries(event.headers ?? {}).filter(([key]) => key.toLowerCase() === 'authorization')
      if (!workerToken || auth.length !== 1 || auth[0]?.[1] !== `Bearer ${workerToken}`) throw new Error('DENIED')
      return true
    }, newJobId: randomUUID })
  return { api, publicationReady }
}

let active: ReturnType<typeof runtime> | undefined
export async function handler(event: HttpEvent) {
  try {
    active ??= runtime()
    if (!active.publicationReady && event.requestContext.http.method === 'POST' && event.rawPath === '/api/admin/publish') {
      return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
        body: JSON.stringify({ ok: false, message: 'UNAVAILABLE' }) }
    }
    return await active.api(event)
  } catch {
    return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
      body: JSON.stringify({ ok: false, message: 'UNAVAILABLE' }) }
  }
}

/** EventBridge invokes this export after CodeBuild reaches a terminal state. */
export async function buildEventHandler(event: unknown): Promise<void> {
  if (!event || typeof event !== 'object') throw new Error('Invalid build event')
  const envelope = event as Record<string, unknown>
  const detail = envelope.detail
  if (envelope.source !== 'aws.codebuild' || envelope['detail-type'] !== 'CodeBuild Build State Change' ||
      !detail || typeof detail !== 'object') throw new Error('Invalid build event')
  const fields = detail as Record<string, unknown>
  const buildId = fields['build-id']
  const status = fields['build-status']
  const project = process.env.CODEBUILD_PROJECT
  if (typeof buildId !== 'string' || !buildId || typeof project !== 'string' || !project ||
      fields['project-name'] !== project || !['SUCCEEDED', 'FAILED', 'STOPPED'].includes(String(status)))
    throw new Error('Unrecognized build event')
  active ??= runtime()
  if (!active.publicationReady || !process.env.BUILD_WORKER_TOKEN) throw new Error('Publication runtime unavailable')
  const result = await new CodeBuildClient({}).send(new BatchGetBuildsCommand({ ids: [buildId] }))
  const build = result.builds?.[0]
  const vars = new Map(build?.environment?.environmentVariables?.map(item => [item.name, item.value]))
  const jobId = vars.get('ICAROS_JOB_ID')
  const attempt = Number(vars.get('ICAROS_ATTEMPT'))
  if (!build || build.id !== buildId || build.projectName !== project || build.buildStatus !== status ||
      build.sourceVersion !== process.env.WEB_SOURCE_REVISION || typeof jobId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(jobId) || !Number.isSafeInteger(attempt) || attempt < 1)
    throw new Error('CodeBuild record mismatch')
  const path = `/api/internal/publish/${jobId}/${status === 'SUCCEEDED' ? 'complete' : 'fail'}`
  const response = await active.api({ rawPath: path, requestContext: { http: { method: 'POST' } },
    headers: { authorization: `Bearer ${process.env.BUILD_WORKER_TOKEN}` }, body: JSON.stringify({ attempt }) })
  if (response.statusCode !== 200 || JSON.parse(response.body).ok !== true) throw new Error('Publication callback failed')
}
