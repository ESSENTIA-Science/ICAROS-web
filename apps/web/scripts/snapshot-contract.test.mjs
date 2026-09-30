import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadAndValidateSnapshot, validateSnapshot } from './snapshot-contract.mjs'

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixturePath = resolve(webRoot, 'fixtures/public.synthetic.json')
const publicRoot = resolve(webRoot, 'public')
const fixtureBytes = readFileSync(fixturePath)
const pin = createHash('sha256').update(fixtureBytes).digest('hex')
const fixture = JSON.parse(fixtureBytes.toString('utf8'))
const clone = () => structuredClone(fixture)

test('pinned public fixture is accepted', () => {
  assert.equal(loadAndValidateSnapshot(fixturePath, pin, publicRoot).version, fixture.version)
})

test('local snapshot with only archived posts is accepted', () => {
  const data = clone()
  data.posts = data.posts.filter((post) => post.source === 'legacy')
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
})

test('archive-only snapshot exports no placeholder community route', () => {
  const data = clone()
  data.posts = data.posts.filter((post) => post.source === 'legacy')
  const temp = resolve(webRoot, 'fixtures/.archive-only-snapshot.test.json')
  try {
    const bytes = Buffer.from(JSON.stringify(data))
    writeFileSync(temp, bytes)
    const result = spawnSync('npm', ['run', 'build', '-w', '@icaros/web'], {
      cwd: resolve(webRoot, '../..'),
      env: { ...process.env, ICAROS_SNAPSHOT: temp, ICAROS_SNAPSHOT_SHA256: createHash('sha256').update(bytes).digest('hex') },
      encoding: 'utf8', maxBuffer: 1024 * 1024 * 5,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(existsSync(resolve(webRoot, 'out/posts/__empty-community')), false)
  } finally {
    rmSync(temp, { force: true })
  }
})

test('missing snapshot and invalid hashes are rejected', () => {
  assert.throws(() => loadAndValidateSnapshot(undefined, undefined, publicRoot), /required/)
  assert.throws(() => loadAndValidateSnapshot('/missing.json', pin, publicRoot), /ENOENT/)
  assert.throws(() => loadAndValidateSnapshot(fixturePath, 'bad', publicRoot), /required/)
  assert.throws(() => loadAndValidateSnapshot(fixturePath, '0'.repeat(64), publicRoot), /mismatch/)
})

test('private member portrait and embedded media are rejected', () => {
  const portrait = clone()
  portrait.members[0].imageSrc = 'https://example.com/private.jpg'
  portrait.members[0].hasPhoto = true
  assert.throws(() => validateSnapshot(portrait, publicRoot), /Member/)

  const bio = clone()
  bio.members[0].bioMd = '![개인 사진](/api/media/private)'
  assert.throws(() => validateSnapshot(bio, publicRoot), /Member/)
})

test('unpublished vehicle, post, member, and panel are rejected', async (t) => {
  for (const [collection, index] of [['vehicles', 0], ['posts', 0], ['members', 0], ['panels', 0]]) {
    await t.test(collection, () => {
      const data = clone()
      data[collection][index].published = false
      assert.throws(() => validateSnapshot(data, publicRoot))
    })
  }
})

test('snapshot with one posts page publishes no phantom page 2', () => {
  const data = clone()
  data.posts = data.posts.slice(0, 2)
  const temp = resolve(webRoot, 'fixtures/.short-snapshot.test.json')
  try {
    const bytes = Buffer.from(JSON.stringify(data))
    writeFileSync(temp, bytes)
    const result = spawnSync('npm', ['run', 'build', '-w', '@icaros/web'], {
      cwd: resolve(webRoot, '../..'),
      env: {
        ...process.env,
        ICAROS_SNAPSHOT: temp,
        ICAROS_SNAPSHOT_SHA256: createHash('sha256').update(bytes).digest('hex'),
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 5,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(existsSync(resolve(webRoot, 'out/posts/page/2')), false)
    assert.equal(existsSync(resolve(webRoot, 'out/posts/page/2.html')), false)
    assert.equal(existsSync(resolve(webRoot, 'out/posts/index.html')), true)
    assert.doesNotMatch(readFileSync(resolve(webRoot, 'out/sitemap.xml'), 'utf8'), /\/posts\/page\/2/)
  } finally {
    rmSync(temp, { force: true })
  }
})

test('vehicle model and gallery accept public local assets', () => {
  const data = clone()
  data.vehicles[0].model = { src: '/assets/models/icx-2.glb', posterSrc: '/assets/models/icx-2-poster.png' }
  data.vehicles[0].gallery = [{ src: '/assets/models/icx-2-poster.png', alt: '사진', width: 10, height: 10 }]
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
})

test('vehicle model, poster, and gallery reject private URLs', async (t) => {
  for (const field of ['model', 'poster', 'gallery']) {
    await t.test(field, () => {
      const data = clone()
      if (field === 'model') data.vehicles[0].model = { src: '/api/media/private' }
      if (field === 'poster') data.vehicles[0].model = { src: '/assets/models/icx-2.glb', posterSrc: '/api/media/private' }
      if (field === 'gallery') data.vehicles[0].gallery = [{ src: '/api/media/private', alt: '사진', width: 10, height: 10 }]
      assert.throws(() => validateSnapshot(data, publicRoot), /Vehicle/)
    })
  }
})

test('post attachment and poster reject private URLs', async (t) => {
  for (const field of ['src', 'posterSrc']) {
    await t.test(field, () => {
      const data = clone()
      data.posts[0].attachments = [{ kind: 'video', src: '/assets/models/icx-2-poster.png', title: '영상', posterSrc: '/assets/models/icx-2-poster.png' }]
      data.posts[0].attachments[0][field] = '/api/media/private'
      assert.throws(() => validateSnapshot(data, publicRoot), /Post/)
    })
  }
})


test('missions accept an empty fixture and reject unsafe or duplicate entries', () => {
  assert.doesNotThrow(() => validateSnapshot(clone(), publicRoot))
  const mission = { id: '123e4567-e89b-42d3-a456-426614174000', title: '시험 발사', launchDate: '2026-07-18', vehicleName: null, location: '제주', outcome: 'success', summary: '회수 성공', bodyMd: '## 결과\n회수했습니다.', imageSrc: null, published: true }
  const data = clone()
  data.missions = [mission]
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  for (const change of [
    { launchDate: '2026-02-30' }, { outcome: 'unknown' }, { imageSrc: '/api/media/private' },
    { bodyMd: '![사진](/api/media/private)' }, { published: false }, { id: 'bad' },
  ]) {
    const invalid = clone()
    invalid.missions = [{ ...mission, ...change }]
    assert.throws(() => validateSnapshot(invalid, publicRoot), /Mission/)
  }
  const withImages = clone()
  withImages.missions = [{ ...mission, bodyMd: '![발사](/assets/models/icx-2-poster.png)\n\n![회수][recovery]\n\n[recovery]: /assets/models/icx-2-poster.png' }]
  assert.doesNotThrow(() => validateSnapshot(withImages, publicRoot))
  for (const bodyMd of [
    '![비공개](/api/media/private)',
    '![비공개][image]\n\n[image]: /api/media/private',
    '![원격](javascript:alert(1))',
    '<img src="/assets/models/icx-2-poster.png">',
  ]) {
    const invalid = clone()
    invalid.missions = [{ ...mission, bodyMd }]
    assert.throws(() => validateSnapshot(invalid, publicRoot), /Mission/)
  }
  data.missions.push({ ...mission })
  assert.throws(() => validateSnapshot(data, publicRoot), /Duplicate mission ID/)
})
