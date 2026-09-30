import type { BuildLauncher, PublicationJob } from '../publish/index.js'

export interface BuildRequest {
  project: string
  jobId: string
  attempt: number
  version: number
  snapshotRef: string
  snapshotSha256: string
  sourceRevision: string
  stagingPrefix: string
}

export interface StagedBuild {
  jobId: string
  attempt: number
  version: number
  snapshotSha256: string
  sourceRevision: string
  stagingPrefix: string
  manifestSha256: string
  validated: true
}

/** Runner and promoter ports keep AWS SDK details outside the publication service. */
export interface BuildRuntime {
  start(request: BuildRequest): Promise<{ buildId: string }>
  /** Check a durable build record, authenticated caller, completion status, and exact request metadata. */
  verifyBuildCallback(request: BuildRequest, buildId: string): Promise<void>
  readValidatedManifest(request: BuildRequest): Promise<StagedBuild>
  /** Must atomically switch public routing to an immutable release, or fail without changing it. */
  activate(request: BuildRequest, manifest: StagedBuild): Promise<void>
}

export function createBuildLauncher(options: {
  project: string; stagingPrefix: string; runtime: BuildRuntime
  verifySnapshot: (ref: string, sha256: string) => Promise<void>
}): BuildLauncher & { verifyCallback(job: PublicationJob, buildId: string): Promise<void> } {
  if (!options.project || !/^[a-zA-Z0-9/_-]+$/.test(options.stagingPrefix) || options.stagingPrefix.includes('..'))
    throw new TypeError('Invalid build configuration')
  const request = (job: PublicationJob): BuildRequest => ({
    project: options.project, jobId: job.id, attempt: job.attempt, version: job.version,
    snapshotRef: job.snapshotRef, snapshotSha256: job.snapshotSha256,
    sourceRevision: job.sourceRevision,
    stagingPrefix: `${options.stagingPrefix}/v${job.version}/attempt-${job.attempt}-${job.id}`,
  })
  return {
    async launch(job) {
      if (job.status !== 'publishing' || job.attempt < 1 || !/^[a-zA-Z0-9_-]+$/.test(job.id) ||
        !/^[a-f0-9]{64}$/.test(job.snapshotSha256)) throw new Error('Invalid build job')
      await options.verifySnapshot(job.snapshotRef, job.snapshotSha256)
      const result = await options.runtime.start(request(job))
      if (!result.buildId) throw new Error('Build did not return an ID')
    },
    async verifyCallback(job, buildId) {
      if (!buildId) throw new Error('Missing build ID')
      await options.runtime.verifyBuildCallback(request(job), buildId)
    },
    async promote(job) {
      const expected = request(job)
      await options.verifySnapshot(job.snapshotRef, job.snapshotSha256)
      const manifest = await options.runtime.readValidatedManifest(expected)
      if (manifest.validated !== true || manifest.jobId !== job.id || manifest.attempt !== job.attempt ||
        manifest.version !== job.version || manifest.snapshotSha256 !== job.snapshotSha256 ||
        manifest.sourceRevision !== job.sourceRevision || manifest.stagingPrefix !== expected.stagingPrefix ||
        !/^[a-f0-9]{64}$/.test(manifest.manifestSha256)) throw new Error('Staged build mismatch')
      await options.runtime.activate(expected, manifest)
    },
  }
}
