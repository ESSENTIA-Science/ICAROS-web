import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { createImmutableSnapshotStore } from '../src/publication-runtime/objects.js'
import { createBuildLauncher } from '../src/publication-runtime/build.js'
import type { PublicationJob } from '../src/publish/index.js'

test('immutable snapshot uses a conditional, content-addressed write', async () => {
  const calls: unknown[] = []
  const bytes = Buffer.from('{"version":"1"}')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const store = createImmutableSnapshotStore({ bucket: 'test-bucket', prefix: 'snapshots', client: {
    send: async (command: { input: unknown }) => { calls.push(command.input); return {} as never },
  } as never })
  assert.equal(await store.put({ version: 1, bytes, sha256 }), `s3://test-bucket/snapshots/v1/${sha256}.json`)
  assert.equal((calls[0] as { IfNoneMatch: string }).IfNoneMatch, '*')
  await assert.rejects(store.put({ version: 1, bytes, sha256: '0'.repeat(64) }))
})

test('promotion rejects a staging manifest from another attempt', async () => {
  const job: PublicationJob = { id: 'job1', idempotencyKey: 'key', version: 1, attempt: 2,
    snapshotRef: 's3://test/snapshot', snapshotSha256: 'a'.repeat(64), sourceRevision: 'rev',
    status: 'publishing', error: null }
  let activated = false
  const launcher = createBuildLauncher({ project: 'web', stagingPrefix: 'staging', verifySnapshot: async () => {},
    runtime: { start: async () => ({ buildId: 'build1' }),
      verifyBuildCallback: async (_request, buildId) => { if (buildId !== 'build1') throw new Error('Unknown build callback') },
      readValidatedManifest: async request => ({ jobId: job.id, attempt: 1, version: job.version,
        snapshotSha256: job.snapshotSha256, sourceRevision: job.sourceRevision,
        stagingPrefix: request.stagingPrefix, manifestSha256: 'b'.repeat(64), validated: true }),
      activate: async () => { activated = true }, } })
  await launcher.launch(job)
  await launcher.verifyCallback(job, 'build1')
  await assert.rejects(launcher.verifyCallback(job, 'foreign'))
  await assert.rejects(launcher.promote(job), /Staged build mismatch/)
  assert.equal(activated, false)
})
