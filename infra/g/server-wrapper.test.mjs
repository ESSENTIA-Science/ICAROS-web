import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import { S3Client } from '@aws-sdk/client-s3'

// Only synthetic bytes are served; no AWS request is made.
test('G preflight renders the same visible posts and pages as the public feed', async () => {
  const original = S3Client.prototype.send
  const oldBucket = process.env.ICAROS_SNAPSHOT_BUCKET
  const requests = []
  const posts = Array.from({ length: 15 }, (_, index) => ({ id: `post-${index}`, source: 'community', title: `Post ${index}`, contentMd: `Body ${index}` }))
  posts.push({ ...posts[0], id: 'mirror', slug: 'mirror', source: 'legacy' })
  const bytes = Buffer.from(JSON.stringify({ taxonomy: { types: [], series: [] }, vehicles: [], missions: [], posts }))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const pointer = { version: 1, key: `snapshots/v1/${sha256}.json`, sha256 }
  S3Client.prototype.send = async () => ({ Body: { transformToByteArray: async () => bytes } })
  process.env.ICAROS_SNAPSHOT_BUCKET = 'synthetic-only'
  globalThis.__icarosWrapperTestRequests = requests
  try {
    const entry = `data:text/javascript,${encodeURIComponent('export async function handler(event) { globalThis.__icarosWrapperTestRequests.push(event.rawPath); return { statusCode: 200 } }')}`
    let source = readFileSync(new URL('./server-wrapper.mjs', import.meta.url), 'utf8')
    source = source.replace("'@aws-sdk/client-s3'", JSON.stringify(import.meta.resolve('@aws-sdk/client-s3')))
      .replace("'./open-next-entry.mjs'", JSON.stringify(entry))
      .replace("'./visible-posts.mjs'", JSON.stringify(new URL('./visible-posts.mjs', import.meta.url).href))
    const module = await import(`data:text/javascript,${encodeURIComponent(source)}`)
    const result = await module.handler({ kind: 'icaros.g.preflight', snapshot: pointer }, {})
    assert.equal(result.ok, true)
    assert.equal(requests.length, 21)
    assert.equal(requests.includes('/posts/legacy/mirror/'), false)
    assert.equal(requests.includes('/posts/page/2/'), false)
    assert.equal(result.sha256, sha256)
  } finally {
    S3Client.prototype.send = original
    if (oldBucket === undefined) delete process.env.ICAROS_SNAPSHOT_BUCKET
    else process.env.ICAROS_SNAPSHOT_BUCKET = oldBucket
    delete globalThis.__icarosWrapperTestRequests
  }
})


test('G packaged visible filter matches the public source contract', () => {
  assert.equal(readFileSync(new URL('./visible-posts.mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../../apps/web/src/lib/posts/visible.mjs', import.meta.url), 'utf8'))
})

test('overlapping pointer refreshes keep each request on its pinned snapshot bytes', async () => {
  const original = S3Client.prototype.send
  const oldBucket = process.env.ICAROS_SNAPSHOT_BUCKET
  const snapshots = ['first', 'second'].map(version => Buffer.from(JSON.stringify({ version })))
  const hashes = snapshots.map(bytes => createHash('sha256').update(bytes).digest('hex'))
  const pointers = hashes.map((sha256, index) => ({version: index + 1, key: `snapshots/v${index + 1}/${sha256}.json`, sha256}))
  let pointerReads = 0, releaseFirst, firstEntered, releaseSecond, secondEntered
  const firstWaiting = new Promise(resolve => { firstEntered = resolve })
  const firstGate = new Promise(resolve => { releaseFirst = resolve })
  const secondWaiting = new Promise(resolve => { secondEntered = resolve })
  const secondGate = new Promise(resolve => { releaseSecond = resolve })
  globalThis.__icarosConcurrentFixture = { secondEntered, secondGate }
  process.env.ICAROS_SNAPSHOT_BUCKET = 'synthetic-only'
  S3Client.prototype.send = async command => {
    if (command.input.Key === 'control/pointer.json') return {Body:{transformToString:async () => JSON.stringify(pointers[pointerReads++])}}
    const index = pointers.findIndex(pointer => pointer.key === command.input.Key)
    if (index === 0) { firstEntered(); await firstGate }
    return {Body:{transformToByteArray:async () => snapshots[index]}}
  }
  try {
    const entryCode = `import {existsSync,readFileSync} from 'node:fs'; import {createHash} from 'node:crypto';
      export async function handler(event) {
        const sha = globalThis.__icarosSnapshotContext.getStore();
        if(event.rawPath === '/second') { globalThis.__icarosConcurrentFixture.secondEntered(); await globalThis.__icarosConcurrentFixture.secondGate }
        const scopedFile = '/tmp/icaros-snapshot-' + sha + '.json';
        const pointerFile = JSON.parse(readFileSync('/tmp/icaros-pointer.json', 'utf8'));
        const path = existsSync(scopedFile) ? scopedFile : pointerFile.path;
        const selected = createHash('sha256').update(readFileSync(path)).digest('hex');
        return {statusCode:200, body:JSON.stringify({sha, selected})};
      }`
    let source = readFileSync(new URL('./server-wrapper.mjs', import.meta.url), 'utf8')
      .replace("'@aws-sdk/client-s3'", JSON.stringify(import.meta.resolve('@aws-sdk/client-s3')))
      .replace("'./open-next-entry.mjs'", JSON.stringify(`data:text/javascript,${encodeURIComponent(entryCode)}`))
      .replace("'./visible-posts.mjs'", JSON.stringify(new URL('./visible-posts.mjs', import.meta.url).href))
    const module = await import(`data:text/javascript,${encodeURIComponent(source)}`)
    const first = module.handler({rawPath:'/first'}, {})
    await firstWaiting
    const second = module.handler({rawPath:'/second'}, {})
    await secondWaiting
    releaseFirst()
    const firstResponse = await first
    assert.equal(existsSync(`/tmp/icaros-snapshot-${hashes[0]}.json`), true)
    assert.equal(existsSync(`/tmp/icaros-snapshot-${hashes[1]}.json`), true, 'active second request retains its SHA file')
    releaseSecond()
    const secondResponse = await second
    for (const result of [firstResponse, secondResponse]) {
      const body = JSON.parse(result.body)
      assert.equal(body.selected, body.sha, 'rendered bytes must match the request cache namespace')
    }
    assert.equal(existsSync(`/tmp/icaros-snapshot-${hashes[1]}.json`), false, 'inactive prior SHA is removed after request completion')
  } finally {
    releaseFirst?.(); releaseSecond?.()
    S3Client.prototype.send = original
    if(oldBucket === undefined) delete process.env.ICAROS_SNAPSHOT_BUCKET
    else process.env.ICAROS_SNAPSHOT_BUCKET = oldBucket
    delete globalThis.__icarosConcurrentFixture
  }
})


test('warm snapshot changes retain only the current SHA after each completed request', async () => {
  const original = S3Client.prototype.send
  const oldBucket = process.env.ICAROS_SNAPSHOT_BUCKET
  const snapshots = Array.from({length: 5}, (_, index) => Buffer.from(JSON.stringify({version: `bounded-${index}`})))
  const hashes = snapshots.map(bytes => createHash('sha256').update(bytes).digest('hex'))
  let selected = 0
  const orphan = `/tmp/icaros-snapshot-${'f'.repeat(64)}.json.next`
  writeFileSync(orphan, 'synthetic interrupted staging')
  process.env.ICAROS_SNAPSHOT_BUCKET = 'synthetic-only'
  S3Client.prototype.send = async command => command.input.Key === 'control/pointer.json'
    ? {Body:{transformToString:async () => JSON.stringify({version: selected + 1, key: `snapshots/v${selected + 1}/${hashes[selected]}.json`,sha256:hashes[selected]})}}
    : {Body:{transformToByteArray:async () => snapshots[selected]}}
  try {
    const entry = `data:text/javascript,${encodeURIComponent('export async function handler(event) { if(event.rawPath === "/fail") throw new Error("Synthetic render failure"); return {statusCode:200} }')}`
    const source = readFileSync(new URL('./server-wrapper.mjs', import.meta.url), 'utf8')
      .replace("'@aws-sdk/client-s3'", JSON.stringify(import.meta.resolve('@aws-sdk/client-s3')))
      .replace("'./open-next-entry.mjs'", JSON.stringify(entry))
      .replace("'./visible-posts.mjs'", JSON.stringify(new URL('./visible-posts.mjs', import.meta.url).href))
    const module = await import(`data:text/javascript,${encodeURIComponent(source)}`)
    for (selected = 0; selected < snapshots.length; selected++) {
      if (selected === 0) {
        await assert.rejects(module.handler({rawPath:'/fail'}, {}), /Synthetic render failure/)
        await assert.rejects(module.handler({kind:'icaros.g.preflight', snapshot: {version:1,key:`snapshots/v1/${hashes[0]}.json`,sha256:hashes[0]}}, {}))
      }
      assert.equal((await module.handler({rawPath:'/warm'}, {})).statusCode, 200)
      assert.equal(existsSync(orphan), false, 'a previous interrupted staging file is reclaimed')
      assert.deepEqual(hashes.filter(sha => existsSync(`/tmp/icaros-snapshot-${sha}.json`)), [hashes[selected]])
    }
  } finally {
    S3Client.prototype.send = original
    if(oldBucket === undefined) delete process.env.ICAROS_SNAPSHOT_BUCKET
    else process.env.ICAROS_SNAPSHOT_BUCKET = oldBucket
  }
})

test('a failed temporary snapshot write leaves no per-SHA staging file', async () => {
  const original = S3Client.prototype.send
  const oldBucket = process.env.ICAROS_SNAPSHOT_BUCKET
  const bytes = Buffer.from('{"version":"failed-staging"}')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const pointer = {version:1,key:`snapshots/v1/${sha256}.json`,sha256}
  process.env.ICAROS_SNAPSHOT_BUCKET = 'synthetic-only'
  S3Client.prototype.send = async command => command.input.Key === 'control/pointer.json'
    ? {Body:{transformToString:async () => JSON.stringify(pointer)}}
    : {Body:{transformToByteArray:async () => bytes}}
  try {
    const entry = `data:text/javascript,${encodeURIComponent('export async function handler() { throw new Error("must not render") }')}`
    const source = readFileSync(new URL('./server-wrapper.mjs', import.meta.url), 'utf8')
      .replace("'@aws-sdk/client-s3'", JSON.stringify(import.meta.resolve('@aws-sdk/client-s3')))
      .replace("'./open-next-entry.mjs'", JSON.stringify(entry))
      .replace("'./visible-posts.mjs'", JSON.stringify(new URL('./visible-posts.mjs', import.meta.url).href))
      .replace('writeFileSync(`${selectedFile}.next`, bytes)', 'writeFileSync(`${selectedFile}.next`, bytes); throw new Error("Synthetic partial write failure")')
    const module = await import(`data:text/javascript,${encodeURIComponent(source)}`)
    await assert.rejects(module.handler({rawPath:'/failed'}, {}), /Synthetic partial write failure/)
    assert.equal(existsSync(`/tmp/icaros-snapshot-${sha256}.json.next`), false)
  } finally {
    S3Client.prototype.send = original
    if(oldBucket === undefined) delete process.env.ICAROS_SNAPSHOT_BUCKET
    else process.env.ICAROS_SNAPSHOT_BUCKET = oldBucket
  }
})
