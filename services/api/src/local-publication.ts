import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BuildLauncher, PublicationJob } from './publish/index.js'
import type { SnapshotExporter } from './snapshot.js'

const root = resolve(process.cwd())
const staging = resolve(root, 'docs/.local/staged-releases')
const current = resolve(root, 'docs/.local/web-current')
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const stage = (version: number) => {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid local publication version')
  return resolve(staging, `v${version}`)
}

/** Local-only static publication. The served symlink changes only after a complete build. */
export function createLocalPublication(onBuilt: (job: PublicationJob) => void): {
  snapshotExporter: SnapshotExporter; buildLauncher: BuildLauncher
} {
  return {
    snapshotExporter: {
      async export(version) {
        const directory = stage(version)
        const snapshot = resolve(directory, 'snapshot.json')
        if (!existsSync(snapshot)) {
          execFileSync(process.execPath, ['scripts/build-web-local.mjs'], { cwd: root, stdio: 'inherit' })
          mkdirSync(directory, { recursive: true, mode: 0o700 })
          cpSync(resolve(root, 'docs/.local/local-public-snapshot.json'), snapshot)
          cpSync(resolve(root, 'apps/web/out'), resolve(directory, 'web'), { recursive: true })
        }
        if (!existsSync(resolve(directory, 'web/index.html'))) throw new Error('Local export is incomplete')
        return { snapshotRef: snapshot, snapshotSha256: digest(readFileSync(snapshot)) }
      },
    },
    buildLauncher: {
      async launch(job) {
        if (job.snapshotRef !== resolve(stage(job.version), 'snapshot.json') ||
            digest(readFileSync(job.snapshotRef)) !== job.snapshotSha256) throw new Error('Local snapshot mismatch')
        setImmediate(() => onBuilt(job))
      },
      async promote(job) {
        const directory = stage(job.version)
        if (job.snapshotRef !== resolve(directory, 'snapshot.json') ||
            digest(readFileSync(job.snapshotRef)) !== job.snapshotSha256 ||
            !existsSync(resolve(directory, 'web/index.html'))) throw new Error('Local release mismatch')
        const next = `${current}.next-${randomUUID()}`
        symlinkSync(resolve(directory, 'web'), next)
        renameSync(next, current)
      },
    },
  }
}
