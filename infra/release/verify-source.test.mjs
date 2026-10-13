import test from 'node:test'
import assert from 'node:assert/strict'
import { verifySource, assertSource } from './verify-source.mjs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const revision = 'a'.repeat(40)
const execute = (calls, failure) => (file, args) => {
  calls.push([file, args])
  if (args.join(' ') === failure) throw new Error('synthetic check failed')
  if (file === 'git' && args[0] === 'rev-parse') return `${revision}\n`
  return ''
}

test('checks run on the approved clean SHA and include egress before returning verification', () => {
  const calls = []
  assert.equal(verifySource(revision, execute(calls)), revision)
  assert.deepEqual(calls.filter(([file]) => file === 'npm').map(([, args]) => args), [
    ['run', 'typecheck'], ['run', 'lint'], ['run', 'test'],
    ['audit', '--omit=dev', '--audit-level=moderate'],
    ['run', 'test:infra'],
    ['run', 'build:web:fixture'], ['run', 'build', '--workspace', '@icaros/cms'],
    ['run', 'test:browser'],
  ])
  assert.ok(calls.some(([file, args]) => file === 'npm' && args.join(' ') === 'run test:infra'))
  assert.equal(calls.filter(([, args]) => args[0] === 'rev-parse').length, 2)
})

test('a failed required check stops subsequent checks and never returns a verified SHA', () => {
  const calls = []
  assert.throws(() => verifySource(revision, execute(calls, 'run lint')), /synthetic check failed/)
  assert.equal(calls.some(([, args]) => args.join(' ') === 'run test'), false)
})

test('wrong revision, modified tracked files, and untracked source all block verification', () => {
  assert.throws(() => assertSource('b'.repeat(40), execute([])), /approved revision/)
  assert.throws(() => assertSource(revision, execute([], 'diff --quiet HEAD --')), /synthetic check failed/)
  assert.throws(() => assertSource(revision, (file, args) => args[0] === 'rev-parse' ? revision :
    args[0] === 'ls-files' ? 'new-source.mjs\n' : ''), /Untracked source/)
  assert.throws(() => assertSource('main', execute([])), /Invalid source revision/)
})

test('check-induced source changes invalidate the SHA before any release work', () => {
  let headReads = 0
  const run = (file, args) => file === 'git' && args[0] === 'rev-parse'
    ? (++headReads === 1 ? revision : 'b'.repeat(40)) : ''
  assert.throws(() => verifySource(revision, run), /approved revision/)
})

function fixture() {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'icaros-source-cwd-')))
  const root = join(temp, 'module-repo')
  const caller = join(temp, 'caller-repo')
  const bin = join(temp, 'bin')
  const log = join(temp, 'commands.jsonl')
  for (const directory of [join(root, 'infra/release'), caller, bin, join(root, 'nested')]) mkdirSync(directory, { recursive: true })
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}')
  for (const file of ['verify-source.mjs', 'build.mjs', 'export.mjs', 'upload-assets.mjs', 'asset-contract.mjs', 'compat-media-index.mjs', 'stage-files.mjs'])
    copyFileSync(new URL(file, import.meta.url), join(root, 'infra/release', file))
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  for (const name of ['unified', 'remark-parse']) symlinkSync(new URL('../../node_modules/' + name, import.meta.url), join(root, 'node_modules', name), 'dir')
  const sdk = join(root, 'node_modules/@aws-sdk/client-s3')
  mkdirSync(sdk, { recursive: true })
  writeFileSync(join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }))
  writeFileSync(join(sdk, 'index.mjs'), `
import { appendFileSync } from 'node:fs';
export class HeadObjectCommand { constructor(input) { this.input = input } }
export class PutObjectCommand { constructor(input) { this.input = input } }
export class S3Client {
  async send(command) {
    if (command instanceof HeadObjectCommand) throw Object.assign(new Error('synthetic missing'), { $metadata: { httpStatusCode: 404 } });
    appendFileSync(process.env.ICAROS_TEST_COMMAND_LOG, JSON.stringify({ file: 'sdk', cwd: process.cwd(), key: command.input.Key, upload: command.input.Body.toString() }) + '\\n');
    return {};
  }
}
`)
  const shim = `#!${process.execPath}
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
const file = basename(process.argv[1]); const args = process.argv.slice(2); const cwd = process.cwd();
const own = resolve(cwd) === resolve(process.env.ICAROS_TEST_MODULE_ROOT);
const record = { file, args, cwd };
if (file === 'git') {
  if (args[0] === 'rev-parse') process.stdout.write(own ? process.env.ICAROS_TEST_ROOT_SHA : process.env.ICAROS_TEST_CALLER_SHA);
  if (args[0] === 'diff' && own && process.env.ICAROS_TEST_DIRTY === 'true') process.exitCode = 1;
} else if (file === 'npm' && args.join(' ') === 'run build --workspace @icaros/web') {
  const out = join(cwd, 'apps/web/out'); mkdirSync(join(out, 'assets'), { recursive: true });
  for (const name of ['index.html', '404.html']) writeFileSync(join(out, name), '<p>' + (own ? 'MODULE_TREE' : 'CALLER_TREE') + '</p>');
  writeFileSync(join(out, 'sitemap.xml'), '<urlset/>'); writeFileSync(join(out, 'assets/photo.webp'), 'synthetic-photo');
} else if (file === 'aws' && args[0] === 's3' && args[1] === 'cp') {
  if (args[2].startsWith('s3://')) writeFileSync(args[3], process.env.ICAROS_TEST_SNAPSHOT);
  else record.upload = readFileSync(args[2], 'utf8');
}
appendFileSync(process.env.ICAROS_TEST_COMMAND_LOG, JSON.stringify(record) + '\\n');
`
  for (const file of ['git', 'npm', 'aws']) writeFileSync(join(bin, file), shim, { mode: 0o700 })
  const snapshot = JSON.stringify({ version: '1', members: [], media: {} })
  const snapshotHash = createHash('sha256').update(snapshot).digest('hex')
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ICAROS_TEST_MODULE_ROOT: root,
    ICAROS_TEST_ROOT_SHA: revision, ICAROS_TEST_CALLER_SHA: 'b'.repeat(40), ICAROS_TEST_COMMAND_LOG: log,
    ICAROS_TEST_SNAPSHOT: snapshot, ICAROS_SNAPSHOT: `s3://synthetic-bucket/snapshots/v1/${snapshotHash}.json`,
    ICAROS_SNAPSHOT_SHA256: snapshotHash, ICAROS_STAGING_PREFIX: '__staging/synthetic', ICAROS_RELEASE_BUCKET: 'synthetic-bucket',
    CODEBUILD_RESOLVED_SOURCE_VERSION: revision, ICAROS_VERSION: '1', ICAROS_ATTEMPT: '1',
    ICAROS_JOB_ID: 'synthetic-job', CODEBUILD_BUILD_ID: 'synthetic:build' }
  return { root, caller, env, clean: () => rmSync(temp, { recursive: true, force: true }),
    records: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
    verify: (approved, override = {}) => spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { assertSource } from ${JSON.stringify(new URL(`file://${join(root, 'infra/release/verify-source.mjs')}`).href)}; assertSource(${JSON.stringify(approved)})`],
      { cwd: caller, env: { ...env, ...override }, encoding: 'utf8' }),
    build: cwd => spawnSync(process.execPath, [join(root, 'infra/release/build.mjs')],
      { cwd, env: { ...env, ICAROS_TEST_CALLER_SHA: revision }, encoding: 'utf8' }),
  }
}

test('default source guard verifies its module repository from an unrelated caller cwd', () => {
  const f = fixture()
  try {
    const result = f.verify(revision)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(f.records().every(record => resolve(record.cwd) === f.root))
  } finally { f.clean() }
})

test('a clean caller repository cannot authorize a different or dirty module repository', () => {
  const f = fixture()
  try {
    assert.notEqual(f.verify('b'.repeat(40)).status, 0)
    assert.notEqual(f.verify(revision, { ICAROS_TEST_CALLER_SHA: revision, ICAROS_TEST_DIRTY: 'true' }).status, 0)
  } finally { f.clean() }
})

test('offline release from unrelated and nested cwd builds and stages only the verified module tree', () => {
  for (const where of ['caller', 'nested']) {
    const f = fixture()
    try {
      const result = f.build(where === 'caller' ? f.caller : join(f.root, 'nested'))
      assert.equal(result.status, 0, result.stderr)
      const records = f.records()
      assert.ok(records.filter(record => record.file !== 'sdk').every(record => resolve(record.cwd) === f.root))
      const index = records.find(record => record.file === 'sdk' && record.key === '__staging/synthetic/index.html')
      assert.ok(index, 'module export index must be staged')
      assert.equal(index.upload, '<p>MODULE_TREE</p>')
      assert.equal(records.some(record => record.upload?.includes('CALLER_TREE')), false)
      const manifest = records.find(record => record.upload && record.args?.[3]?.endsWith('/manifest.json'))
      assert.equal(JSON.parse(manifest.upload).sourceRevision, revision)
    } finally { f.clean() }
  }
})
