import test from 'node:test'
import assert from 'node:assert/strict'
import { verifySource, assertSource } from './verify-source.mjs'

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
    ['run', 'build:g:fixture'], ['run', 'build', '--workspace', '@icaros/cms'],
    ['run', 'test:browser'], ['run', 'test:g:runtime'],
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

test('an absolute G build validates its own repository when invoked from an unrelated directory', async () => {
  const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const temp = mkdtempSync(join(tmpdir(), 'icaros-g-cwd-'))
  const owned = join(temp, 'owned'), unrelated = join(temp, 'unrelated'), bin = join(temp, 'bin')
  const otherSha = 'b'.repeat(40)
  try {
    for (const directory of ['scripts', 'infra/g', 'apps/web/fixtures', 'node_modules/@opennextjs/aws/dist']) mkdirSync(join(owned, directory), { recursive: true })
    mkdirSync(unrelated); mkdirSync(bin)
    writeFileSync(join(owned, 'package.json'), '{"type":"module"}')
    writeFileSync(join(owned, 'infra/g/verify-source.mjs'), readFileSync(new URL('./verify-source.mjs', import.meta.url)))
    writeFileSync(join(owned, 'scripts/build-g-fixture.mjs'), readFileSync(new URL('../../scripts/build-g-fixture.mjs', import.meta.url)))
    writeFileSync(join(owned, 'apps/web/fixtures/public.synthetic.json'), '{}')
    const marker = join(temp, 'builder-ran')
    writeFileSync(join(owned, 'node_modules/@opennextjs/aws/dist/index.js'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)}, 'fixture');`)
    writeFileSync(join(bin, 'git'), `#!${process.execPath}\nif(process.argv[2] === 'rev-parse') console.log(require('node:fs').realpathSync(process.cwd()) === require('node:fs').realpathSync(${JSON.stringify(owned)}) ? ${JSON.stringify(revision)} : ${JSON.stringify(otherSha)});`, { mode: 0o700 })
    const run = sha => spawnSync(process.execPath, [join(owned, 'scripts/build-g-fixture.mjs')], { cwd: unrelated,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ICAROS_SOURCE_REVISION: sha }, encoding: 'utf8' })
    const wrong = run(otherSha)
    assert.notEqual(wrong.status, 0, 'unrelated HEAD must not authorize the target G build')
    assert.equal(existsSync(marker), false)
    const correct = run(revision)
    assert.equal(correct.status, 0, correct.stderr)
    assert.equal(existsSync(marker), true)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
