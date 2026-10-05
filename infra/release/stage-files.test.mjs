import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'icaros-stage-'))
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'index.html'), '<h1>test</h1>')
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)')
  return { root, files: [
    { path: 'index.html', sha256: hash('<h1>test</h1>') },
    { path: 'assets/app.js', sha256: hash('console.log(1)') },
  ] }
}

test('stage uploads only verified files with their exact key, checksum and MIME', async () => {
  const { stageFiles } = await import('./stage-files.mjs')
  const data = fixture(); const calls = []
  try {
    await stageFiles({ ...data, bucket: 'release', prefix: '__staging/v11/attempt-1-test', s3: { async send(command) {
      calls.push(command.input)
      return {}
    } } })
    assert.deepEqual(calls.map(c => c.Key).sort(), [
      '__staging/v11/attempt-1-test/assets/app.js', '__staging/v11/attempt-1-test/index.html',
    ])
    const html = calls.find(c => c.Key.endsWith('/index.html'))
    assert.equal(html.ContentType, 'text/html; charset=utf-8')
    assert.equal(html.ChecksumSHA256, Buffer.from(data.files[0].sha256, 'hex').toString('base64'))
    assert.equal(html.IfNoneMatch, '*')
    writeFileSync(join(data.root, 'index.html'), 'corrupted')
    await assert.rejects(stageFiles({ ...data, bucket: 'release', prefix: '__staging/v11/attempt-1-test', s3: { async send() { throw new Error('must not upload corrupt file') } } }), /changed/)
  } finally { rmSync(data.root, { recursive: true }) }
})

test('manifest is withheld until every stage operation succeeds', async () => {
  const { publishStagedRelease } = await import('./stage-files.mjs')
  const calls = []
  let finishStage
  const stage = new Promise(resolve => { finishStage = resolve })
  const task = publishStagedRelease({ uploadAssets: async () => { calls.push('assets') },
    stage: async () => { calls.push('stage'); await stage },
    putManifest: async () => { calls.push('manifest') } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['assets', 'stage'])
  finishStage()
  await task
  assert.deepEqual(calls, ['assets', 'stage', 'manifest'])
  await assert.rejects(publishStagedRelease({ uploadAssets: async () => {},
    stage: async () => { throw new Error('put failed') },
    putManifest: async () => { throw new Error('manifest must not run') } }), /put failed/)
})
