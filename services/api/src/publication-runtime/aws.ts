import { createHash } from 'node:crypto'
import { BatchGetBuildsCommand, StartBuildCommand, type CodeBuildClient } from '@aws-sdk/client-codebuild'
import { DescribeKeyValueStoreCommand, GetKeyCommand, UpdateKeysCommand, type CloudFrontKeyValueStoreClient } from '@aws-sdk/client-cloudfront-keyvaluestore'
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import type { BuildRequest, BuildRuntime, StagedBuild } from './build.js'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const hashPattern = /^[a-f0-9]{64}$/
const safePath = (value: string) => value.length > 0 && !value.startsWith('/') &&
  !value.split('/').some(part => part === '' || part === '.' || part === '..') &&
  /^[a-zA-Z0-9/_.,-]+$/.test(value)

export interface AwsBuildRuntimeOptions {
  codeBuild: Pick<CodeBuildClient, 'send'>
  s3: Pick<S3Client, 'send'>
  kvs: Pick<CloudFrontKeyValueStoreClient, 'send'>
  bucket: string
  kvsArn: string
  releasePrefix: string
}

/** Contract for the CodeBuild buildspec: write this JSON last, after every listed file is uploaded. */
export interface AwsStagedManifest {
  buildId: string
  jobId: string
  attempt: number
  version: number
  snapshotSha256: string
  sourceRevision: string
  stagingPrefix: string
  files: { path: string; sha256: string }[]
}

export function createAwsBuildRuntime(options: AwsBuildRuntimeOptions): BuildRuntime {
  const { codeBuild, s3, kvs, bucket, kvsArn, releasePrefix } = options
  if (!bucket || !kvsArn || !safePath(releasePrefix)) throw new TypeError('Invalid AWS publication configuration')
  const object = async (key: string): Promise<Uint8Array> => {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!result.Body) throw new Error('Missing build object')
    return result.Body.transformToByteArray()
  }
  const manifestKey = (request: BuildRequest) => `${request.stagingPrefix}/manifest.json`
  const read = async (request: BuildRequest) => {
    const bytes = await object(manifestKey(request))
    const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'))
    if (!value || typeof value !== 'object') throw new Error('Invalid staged manifest')
    const manifest = value as AwsStagedManifest
    if (manifest.jobId !== request.jobId || manifest.attempt !== request.attempt ||
      manifest.version !== request.version || manifest.snapshotSha256 !== request.snapshotSha256 ||
      manifest.sourceRevision !== request.sourceRevision || manifest.stagingPrefix !== request.stagingPrefix ||
      typeof manifest.buildId !== 'string' || !manifest.buildId ||
      !Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Staged manifest mismatch')
    const buildResult = await codeBuild.send(new BatchGetBuildsCommand({ ids: [manifest.buildId] }))
    const build = buildResult.builds?.[0]
    const vars = new Map(build?.environment?.environmentVariables?.map(v => [v.name, v.value]))
    if (!build || build.id !== manifest.buildId || build.projectName !== request.project ||
      build.buildStatus !== 'SUCCEEDED' || build.sourceVersion !== request.sourceRevision ||
      vars.get('ICAROS_SNAPSHOT') !== request.snapshotRef ||
      vars.get('ICAROS_SNAPSHOT_SHA256') !== request.snapshotSha256 ||
      vars.get('ICAROS_VERSION') !== String(request.version) ||
      vars.get('ICAROS_JOB_ID') !== request.jobId ||
      vars.get('ICAROS_ATTEMPT') !== String(request.attempt) ||
      vars.get('ICAROS_STAGING_PREFIX') !== request.stagingPrefix)
      throw new Error('Staged manifest build was not verified')
    const paths = new Set<string>()
    for (const file of manifest.files) {
      if (!file || typeof file.path !== 'string' || !safePath(file.path) ||
        typeof file.sha256 !== 'string' || !hashPattern.test(file.sha256) || paths.has(file.path))
        throw new Error('Invalid staged file list')
      paths.add(file.path)
    }
    for (const required of ['index.html', '404.html', 'sitemap.xml']) {
      if (!paths.has(required)) throw new Error(`Missing required export: ${required}`)
    }
    for (const file of manifest.files) {
      if (sha(await object(`${request.stagingPrefix}/${file.path}`)) !== file.sha256)
        throw new Error(`Staged file checksum mismatch: ${file.path}`)
    }
    return { manifest, manifestSha256: sha(bytes) }
  }
  return {
    async start(request) {
      if (!safePath(request.stagingPrefix) || !hashPattern.test(request.snapshotSha256) ||
        !/^[a-fA-F0-9]{40}$/.test(request.sourceRevision) ||
        !request.snapshotRef.startsWith('s3://')) throw new Error('Invalid immutable build inputs')
      const result = await codeBuild.send(new StartBuildCommand({ projectName: request.project,
        sourceVersion: request.sourceRevision,
        environmentVariablesOverride: [
          ['ICAROS_SNAPSHOT', request.snapshotRef], ['ICAROS_SNAPSHOT_SHA256', request.snapshotSha256],
          ['ICAROS_VERSION', String(request.version)], ['ICAROS_JOB_ID', request.jobId],
          ['ICAROS_ATTEMPT', String(request.attempt)], ['ICAROS_STAGING_PREFIX', request.stagingPrefix],
        ].map(([name, value]) => ({ name, value, type: 'PLAINTEXT' as const })) }))
      if (!result.build?.id) throw new Error('CodeBuild did not return a durable build ID')
      return { buildId: result.build.id }
    },
    async verifyBuildCallback(request, buildId) {
      const result = await codeBuild.send(new BatchGetBuildsCommand({ ids: [buildId] }))
      const build = result.builds?.[0]
      const vars = new Map(build?.environment?.environmentVariables?.map(v => [v.name, v.value]))
      if (!build || build.id !== buildId || build.projectName !== request.project ||
        build.buildStatus !== 'SUCCEEDED' || build.sourceVersion !== request.sourceRevision ||
        vars.get('ICAROS_SNAPSHOT') !== request.snapshotRef ||
        vars.get('ICAROS_SNAPSHOT_SHA256') !== request.snapshotSha256 ||
        vars.get('ICAROS_VERSION') !== String(request.version) ||
        vars.get('ICAROS_JOB_ID') !== request.jobId ||
        vars.get('ICAROS_ATTEMPT') !== String(request.attempt) ||
        vars.get('ICAROS_STAGING_PREFIX') !== request.stagingPrefix)
        throw new Error('CodeBuild record mismatch or build incomplete')
    },
    async readValidatedManifest(request) {
      const { manifestSha256 } = await read(request)
      return { jobId: request.jobId, attempt: request.attempt, version: request.version,
        snapshotSha256: request.snapshotSha256, sourceRevision: request.sourceRevision,
        stagingPrefix: request.stagingPrefix, manifestSha256, validated: true }
    },
    async activate(request, staged: StagedBuild) {
      const { manifest, manifestSha256 } = await read(request)
      if (manifestSha256 !== staged.manifestSha256) throw new Error('Manifest changed before promotion')
      const release = `${releasePrefix}/v${request.version}-${manifestSha256}`
      const etag = (await kvs.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }))).ETag
      if (!etag) throw new Error('Missing routing pointer ETag')
      const current = await kvs.send(new GetKeyCommand({ KvsARN: kvsArn, Key: 'release' }))
      const currentMatch = current.Value?.match(new RegExp(`^${releasePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/v(\\d+)-[a-f0-9]{64}$`))
      if (!currentMatch) throw new Error('Invalid current routing pointer')
      const currentVersion = Number(currentMatch[1])
      if (!Number.isSafeInteger(currentVersion) || request.version <= currentVersion)
        throw new Error('Stale publication version')
      for (const file of manifest.files) {
        const bytes = await object(`${request.stagingPrefix}/${file.path}`)
        if (sha(bytes) !== file.sha256) throw new Error('Staged file changed during promotion')
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${release}/${file.path}`,
          Body: bytes, IfNoneMatch: '*', ChecksumSHA256: Buffer.from(file.sha256, 'hex').toString('base64') }))
      }
      // The single conditional key update is the only public visibility change.
      await kvs.send(new UpdateKeysCommand({ KvsARN: kvsArn, IfMatch: etag,
        Puts: [{ Key: 'release', Value: release }] }))
    },
  }
}
