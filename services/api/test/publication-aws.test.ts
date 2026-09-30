import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { createAwsBuildRuntime } from '../src/publication-runtime/aws.js'
import type { BuildRequest } from '../src/publication-runtime/build.js'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const request: BuildRequest = { project: 'web', jobId: 'job1', attempt: 1, version: 2,
  snapshotRef: 's3://test/snapshot.json', snapshotSha256: 'a'.repeat(64),
  sourceRevision: 'b'.repeat(40), stagingPrefix: 'stage/v2/attempt-1-job1' }
const files = ['index.html', '404.html', 'sitemap.xml'].map(path => ({ path, sha256: digest(Buffer.from(path)) }))
const manifest = { buildId: 'web:build1', jobId: request.jobId, attempt: request.attempt, version: request.version,
  snapshotSha256: request.snapshotSha256, sourceRevision: request.sourceRevision,
  stagingPrefix: request.stagingPrefix, files }
type MockCommand = { constructor: { name: string }; input: Record<string, unknown> }

test('AWS runtime checks durable CodeBuild record and every export checksum before pointer update', async () => {
  const calls: { name: string; input: Record<string, unknown> }[] = []
  let bad = false
  const runtime = createAwsBuildRuntime({ bucket: 'test', kvsArn: 'arn:test', releasePrefix: 'releases',
    codeBuild: { send: async (command: MockCommand) => {
      calls.push({ name: command.constructor.name, input: command.input })
      if (command.constructor.name === 'StartBuildCommand') return { build: { id: 'web:build1' } }
      return { builds: [{ id: 'web:build1', projectName: 'web', buildStatus: bad ? 'FAILED' : 'SUCCEEDED',
        sourceVersion: request.sourceRevision, environment: { environmentVariables: (calls[0]?.input.environmentVariablesOverride ?? []) } }] }
    } } as never,
    s3: { send: async (command: MockCommand) => {
      calls.push({ name: command.constructor.name, input: command.input })
      if (command.constructor.name === 'PutObjectCommand') return {}
      const key = command.input.Key as string
      const value = key.endsWith('/manifest.json') ? JSON.stringify(manifest) : key.split('/').at(-1)!
      return { Body: { transformToByteArray: async () => Buffer.from(value) } }
    } } as never,
    kvs: { send: async (command: MockCommand) => {
      calls.push({ name: command.constructor.name, input: command.input })
      if (command.constructor.name === 'DescribeKeyValueStoreCommand') return { ETag: 'etag1' }
      if (command.constructor.name === 'GetKeyCommand') return { Value: `releases/v1-${'c'.repeat(64)}` }
      return {}
    } } as never })
  assert.deepEqual(await runtime.start(request), { buildId: 'web:build1' })
  await runtime.verifyBuildCallback(request, 'web:build1')
  bad = true
  await assert.rejects(runtime.verifyBuildCallback(request, 'web:build1'), /incomplete/)
  bad = false
  const staged = await runtime.readValidatedManifest(request)
  await runtime.activate(request, staged)
  assert.equal(calls.filter(c => c.name === 'PutObjectCommand').length, 3)
  assert.equal(calls.at(-1)?.name, 'UpdateKeysCommand')
  assert.equal(calls.at(-1)?.input.IfMatch, 'etag1')
})
