import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { packageGenerated, packageGRelease, readTree, sha256, treeManifest, zipFiles } from './package-g-release.mjs'

const revision = 'a'.repeat(40)
function zipContents(bytes) {
  const files = new Map()
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString()
    offset += 30 + nameLength + extra
    files.set(name, inflateRawSync(bytes.subarray(offset, offset + size)))
    offset += size
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50)
  return files
}

test('ZIP is deterministic and round trips safe file contents', () => {
  const files = new Map([['apps/web/index.mjs', Buffer.from('export const test = 1')], ['index.mjs', Buffer.from('entry')]])
  const first = zipFiles(files)
  assert.deepEqual(first, zipFiles(new Map([...files].reverse())))
  assert.deepEqual(zipContents(first), new Map([...files].sort(([a], [b]) => a.localeCompare(b, 'en'))))
  for (const path of ['../escape', '/absolute', 'folder/../escape', 'folder\\escape', 'folder//file']) assert.throws(() => zipFiles(new Map([[path, Buffer.from('x')]])), /Unsafe ZIP path/)
})

test('artifact manifest pins every file hash to the exact source revision', () => {
  const manifest = treeManifest(new Map([['index.mjs', Buffer.from('entry')]]), revision)
  assert.equal(manifest.files[0].sourceRevision, revision)
  assert.equal(manifest.files[0].sha256, sha256('entry'))
  assert.equal(manifest.sourceRevision, revision)
})

test('dirty source blocks release before any build or output', async () => {
  let verified = false
  await assert.rejects(packageGRelease({}, { assertSource() { throw new Error('dirty source') }, verifySource() { verified = true } }), /dirty source/)
  assert.equal(verified, false)
})

test('packaging rejects fixture contents and unsupported Node before running checks', async () => {
  const fixture = new URL('../apps/web/fixtures/public.synthetic.json', import.meta.url)
  const args = { revision, snapshot: fixture.pathname, snapshotSha256: sha256(readFileSync(fixture)), output: resolve(tmpdir(), 'unused-g-release') }
  const hooks = { nodeVersion: '22.15.0', assertSource() {}, verifySource() { assert.fail('verification must not start') } }
  await assert.rejects(packageGRelease(args, hooks), /Synthetic snapshot/)
  await assert.rejects(packageGRelease(args, { ...hooks, nodeVersion: '26.0.0' }), /Node 22/)
})

test('packaged server uses wrapper entry, pinned bundled SDK, visible helper and original OpenNext entry', async () => {
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'g-source-'))
  const output = mkdtempSync(resolve(tmpdir(), 'g-artifacts-'))
  const write = (path, content) => { mkdirSync(resolve(sourceRoot, path, '..'), { recursive: true }); writeFileSync(resolve(sourceRoot, path), content) }
  try {
    const generated = 'apps/web/.open-next/'
    write(generated + 'server-functions/default/index.mjs', "export { handler } from './apps/web/index.mjs';")
    write(generated + 'server-functions/default/apps/web/index.mjs', 'export const handler = () => ({ statusCode: 200 });')
    for (const name of ['index.mjs', 'open-next.config.mjs', 'prerender-manifest.json']) write(generated + 'revalidation-function/' + name, '{"preview":{"previewModeId":"synthetic-packaging-test"}}')
    write(generated + 'assets/BUILD_ID', 'pinned-build-id'); write(generated + 'assets/_next/static/chunk.js', 'chunk')
    write(generated + 'cache/entry.json', '{}'); write('apps/cms/dist/index.html', '<html></html>')
    write('infra/g/server-wrapper.mjs', readFileSync(new URL('../infra/g/server-wrapper.mjs', import.meta.url), 'utf8').replace("'@aws-sdk/client-s3'", JSON.stringify(fileURLToPath(import.meta.resolve('@aws-sdk/client-s3')))))
    write('infra/g/visible-posts.mjs', 'export const visiblePosts = posts => posts;')
    write('infra/g/revalidation-wrapper.mjs', readFileSync(new URL('../infra/g/revalidation-wrapper.mjs', import.meta.url), 'utf8').replace("'@aws-sdk/client-lambda'", JSON.stringify(fileURLToPath(import.meta.resolve('@aws-sdk/client-lambda')))))
    write('package-lock.json', '{}'); write('node_modules/@aws-sdk/client-s3/package.json', '{"version":"3.test"}'); write('node_modules/@aws-sdk/client-lambda/package.json', '{"version":"3.test"}')
    const manifest = await packageGenerated({ sourceRoot, output, revision, snapshotSha256: 'b'.repeat(64), buildId: 'pinned-build-id' })
    const server = zipContents(readFileSync(resolve(output, 'server.zip')))
    assert.match(server.get('index.mjs').toString(), /open-next-entry\.mjs/)
    assert.match(server.get('index.mjs').toString(), /visible-posts\.mjs/)
    assert.equal(server.get('open-next-entry.mjs').toString(), "export { handler } from './apps/web/index.mjs';")
    assert.equal(server.has('visible-posts.mjs'), true)
    assert.doesNotMatch(server.get('index.mjs').toString(), /from ["']@aws-sdk\/client-s3["']/)
    for (const [name, bytes] of server) { mkdirSync(resolve(output, 'runtime', name, '..'), { recursive: true }); writeFileSync(resolve(output, 'runtime', name), bytes) }
    const wrapped = await import(pathToFileURL(resolve(output, 'runtime/index.mjs')).href)
    await assert.rejects(wrapped.handler({ kind: 'icaros.g.preflight' }, {}), /Invalid preflight request/)
    assert.equal(manifest.artifacts.server.archiveSha256, sha256(readFileSync(resolve(output, 'server.zip'))))
    assert.equal(manifest.bundledS3Version, '3.test')
    assert.equal(manifest.bundledLambdaVersion, '3.test')
    const revalidation = zipContents(readFileSync(resolve(output, 'revalidation.zip')))
    assert.match(revalidation.get('index.mjs').toString(), /batchItemFailures/)
    assert.ok(revalidation.has('prerender-manifest.json'))
    assert.doesNotMatch(revalidation.get('index.mjs').toString(), /from ["']@aws-sdk\/client-lambda["']/)
    for (const [name, bytes] of revalidation) { mkdirSync(resolve(output, 'revalidation-runtime', name, '..'), { recursive: true }); writeFileSync(resolve(output, 'revalidation-runtime', name), bytes) }
    const revalidationHandler = await import(pathToFileURL(resolve(output, 'revalidation-runtime/index.mjs')).href)
    assert.deepEqual(await revalidationHandler.handler({ Records: [] }), { batchItemFailures: [] })
    assert.equal(readFileSync(resolve(output, 'BUILD_ID'), 'utf8'), 'pinned-build-id\n')
    assert.equal(manifest.artifacts.cms.files[0].sourceRevision, revision)
    assert.equal(manifest.artifacts.assets.files.length, 2)
    write(generated + 'server-functions/default/g-wrapper.test.mjs', 'fixture')
    await assert.rejects(packageGenerated({ sourceRoot, output, revision, buildId: 'pinned-build-id' }), /fixture residue/)
  } finally { rmSync(sourceRoot, { recursive: true, force: true }); rmSync(output, { recursive: true, force: true }) }
})

test('tree reader rejects symlinks escaping artifact roots', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'g-link-'))
  try { symlinkSync('/etc/passwd', resolve(directory, 'outside')); assert.throws(() => readTree(directory), /Symlink/) }
  finally { rmSync(directory, { recursive: true, force: true }) }
})

test('Next BUILD_ID remains default outside a pinned production build', () => {
  const config = readFileSync(new URL('../apps/web/next.config.ts', import.meta.url), 'utf8')
  assert.match(config, /process\.env\.ICAROS_BUILD_ID \? \{ generateBuildId:/)
})
