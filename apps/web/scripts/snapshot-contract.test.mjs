import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { getVehicleSpecs, vehicleSpecFacts } from '../src/lib/vehicle-specs.ts'
import { loadAndValidateSnapshot, validateSnapshot } from './snapshot-contract.mjs'
import { memberPortraitMedia } from './public-member-media.mjs'

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixturePath = resolve(webRoot, 'fixtures/public.synthetic.json')
const publicRoot = resolve(webRoot, 'public')
const fixtureBytes = readFileSync(fixturePath)
const pin = createHash('sha256').update(fixtureBytes).digest('hex')
const fixture = JSON.parse(fixtureBytes.toString('utf8'))
const clone = () => structuredClone(fixture)
// G emits server artifacts rather than a static out/ directory.
function gOutput(...parts) {
  let path = parts.join('/').replace(/^out\//, '')
  if (path === 'index.html') path = 'index.html'
  else if (path.endsWith('/index.html')) path = path.slice(0, -11) + '.html'
  if (path === 'robots.txt') path += '.body'
  return resolve(webRoot, '.next/server/app', path)
}
let selectedSnapshot, selectedHash
function gBuild(file, bytes) {
  selectedSnapshot = file; selectedHash = createHash('sha256').update(bytes).digest('hex')
  return spawnSync('npm', ['run', 'build', '-w', '@icaros/web', ...(process.env.ICAROS_TEST_WEBPACK === '1' ? ['--', '--webpack'] : [])], {
    cwd: resolve(webRoot, '../..'),
    env: { ...process.env, ICAROS_SNAPSHOT: selectedSnapshot, ICAROS_SNAPSHOT_SHA256: selectedHash },
    encoding: 'utf8', maxBuffer: 1024 * 1024 * 5,
  })
}
function sitemapBody() {
  const code = `
    const { spawn } = await import('node:child_process');
    const port = 26000 + process.pid % 10000;
    const server = spawn(process.execPath, ['../../node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { stdio: 'ignore' });
    try {
      let response;
      for (let attempt = 0; attempt < 50; attempt++) {
        try { response = await fetch('http://127.0.0.1:' + port + '/sitemap.xml'); if (response.ok) break } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!response?.ok) throw new Error('Synthetic G sitemap failed');
      process.stdout.write(await response.text());
    } finally { server.kill('SIGTERM') }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: webRoot,
    env: { ...process.env, ICAROS_SNAPSHOT: selectedSnapshot, ICAROS_SNAPSHOT_SHA256: selectedHash },
    encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}


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
  const portrait = '/assets/models/icx-2-poster.png'
  data.media.portrait = portrait
  data.members = [null, '', '   ', '소개글이 있는 카드입니다.'].map((bioMd, index) => ({
    ...data.members[0], id: `member-layout-${index}`, name: `합성 부원 ${index}`,
    squad: `합성 단일 부서 ${index}`, squads: index === 0 ? ['합성 단일 부서 0', '합성 부서 추가'] : [`합성 단일 부서 ${index}`],
    bioMd, imageSrc: portrait, hasPhoto: true,
    school: index === 0 ? '합성긴학교명을공백없이표시하는검증학교' : null,
  }))
  const temp = resolve(webRoot, 'fixtures/.archive-only-snapshot.test.json')
  try {
    const bytes = Buffer.from(JSON.stringify(data))
    writeFileSync(temp, bytes)
    const result = gBuild(temp, bytes)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(existsSync(gOutput('posts/__empty-community')), false)
    const customVehicle = readFileSync(gOutput('vehicles/test-vehicle/index.html'), 'utf8')
    assert.match(customVehicle, /data-columns="2"/)
    assert.match(customVehicle, /설계 버전/)
    assert.match(customVehicle, /회수 방식 낙하산/)
    assert.match(customVehicle, /전장 1.20 m/)
    const emptyVehicle = readFileSync(gOutput('vehicles/test-uav/index.html'), 'utf8')
    assert.doesNotMatch(emptyVehicle, />Specifications<|최대 고도|페이로드/)
    const legacyVehicle = readFileSync(gOutput('vehicles/test-vehicle-two/index.html'), 'utf8')
    assert.match(legacyVehicle, /data-columns="1"/)
    assert.match(legacyVehicle, /전장/)
    const vehicles = readFileSync(gOutput('vehicles/index.html'), 'utf8')
    assert.match(vehicles, /설계 버전/)
    assert.match(vehicles, /Rev. B/)
    const robots = readFileSync(gOutput('robots.txt'), 'utf8')
    assert.match(robots, /Sitemap: https:\/\/icaros\.kr\/sitemap\.xml/)
    const home = readFileSync(gOutput('index.html'), 'utf8')
    assert.match(home, /<a[^>]*href="\/missions\/"[^>]*>(?:(?!<\/a>)[\s\S])*미션 보기/)
    assert.match(home, /<a[^>]*href="\/posts"[^>]*>(?:(?!<\/a>)[\s\S])*기록 보기/)
    const post = readFileSync(gOutput('posts/legacy/test-legacy/index.html'), 'utf8')
    assert.match(post, /<meta name="description" content="정적 아카이브 본문 검증용 텍스트입니다\."/)
    assert.match(post, /<meta property="og:url" content="https:\/\/icaros\.kr\/posts\/legacy\/test-legacy\/"/)
    assert.match(post, /aria-label="사진 모음"/)
    assert.match(post, /<img[^>]+alt="IMG_0001.jpeg"/)
    assert.match(post, /<img[^>]+alt="IMG_0002.jpeg"/)
    const members = readFileSync(gOutput('member/index.html'), 'utf8')
    const cards = [...members.matchAll(/<li\b[^>]*data-reveal-item=""[^>]*>[\s\S]*?<\/li>/g)].map(match => match[0])
    assert.match(members, /합성 부서 추가/)
    assert.equal(cards.length, 5)
    for (const card of cards) assert.doesNotMatch(card, /data-bio=|소개글이 있는 카드입니다\./)
    for (let index = 0; index < cards.length; index++) {
      assert.match(cards[index], new RegExp(`alt="합성 부원 ${[0, 0, 1, 2, 3][index]} 프로필 사진"`))
      assert.match(cards[index], /src="\/assets\/models\/icx-2-poster.png"/)
      assert.doesNotMatch(cards[index], /data-empty=/)
    }
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

test('explicit member photo accepts only an allowlisted existing local image', () => {
  const data = clone()
  const src = '/assets/models/icx-2-poster.png'
  data.media.portrait = src
  data.members[0].imageSrc = src
  data.members[0].hasPhoto = true
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  for (const imageSrc of [
    '/assets/missing.webp', '/assets/models/icx-2.glb', '/assets/../private.webp',
    '/api/media/private', 'https://example.com/photo.webp',
    'https://bucket.s3.amazonaws.com/photo.webp', `${src}?token=private`,
    '/assets/img/member/profile.webp',
  ]) {
    const invalid = structuredClone(data)
    invalid.members[0].imageSrc = imageSrc
    invalid.media.portrait = imageSrc
    assert.throws(() => validateSnapshot(invalid, publicRoot), /Member/)
  }
  for (const hasPhoto of [false, undefined, 'true', 1]) {
    const invalid = structuredClone(data)
    invalid.members[0].hasPhoto = hasPhoto
    assert.throws(() => validateSnapshot(invalid, publicRoot), /Member/)
  }
  data.media = {}
  assert.throws(() => validateSnapshot(data, publicRoot), /Member/)
})

test('member bios cannot publish inline, reference, or HTML images', () => {
  for (const bioMd of [
    '![사진](/assets/models/icx-2-poster.png)',
    '![사진][portrait]\n\n[portrait]: /assets/models/icx-2-poster.png',
    '<img src="/assets/models/icx-2-poster.png">',
    '<picture><source srcset="/assets/models/icx-2-poster.png"></picture>',
    '/api/media/private',
  ]) {
    const data = clone()
    data.members[0].bioMd = bioMd
    assert.throws(() => validateSnapshot(data, publicRoot), /Member/)
  }
})

test('member portrait export excludes unpublished, missing, deleted, pending, and non-image media', () => {
  const member = { published: true, image_media_id: 'PORTRAIT' }
  const image = { id: 'portrait', status: 'ready', deleted_at: null, mime: 'image/webp' }
  const select = (person, media) => memberPortraitMedia(person, new Map(media ? [['portrait', media]] : []))
  assert.strictEqual(select(member, image), image)
  assert.equal(select({ ...member, published: false }, image), null)
  assert.equal(select({ ...member, image_media_id: null }, image), null)
  assert.equal(select(member, undefined), null)
  for (const change of [{ status: 'pending' }, { deleted_at: new Date() }, { mime: 'application/pdf' }, { mime: 'image/svg+xml' }]) {
    assert.equal(select(member, { ...image, ...change }), null)
  }
})

test('home CTA destinations stay on public site routes', () => {
  const valid = clone()
  valid.panels[0].ctaLabel = '미션 보기'
  valid.panels[0].ctaHref = '/missions'
  valid.site['donate.cta_href'] = '/posts'
  assert.doesNotThrow(() => validateSnapshot(valid, publicRoot))

  const unsafe = clone()
  unsafe.panels[0].ctaHref = '//other.example'
  assert.throws(() => validateSnapshot(unsafe, publicRoot), /panel/)
  unsafe.panels[0].ctaHref = '/vehicles'
  unsafe.site['donate.cta_href'] = 'javascript:alert(1)'
  assert.throws(() => validateSnapshot(unsafe, publicRoot), /donation CTA/)
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
  const gallery = ':::gallery{columns=2}\n\n![발사대](/assets/img/rocket/icx1.webp "점화 직전")\n\n![기체](/assets/models/icx-2-poster.png)\n\n:::'
  data.posts[0].contentMd = gallery
  data.missions = [{ id: '123e4567-e89b-42d3-a456-426614174000', title: '시험 발사', launchDate: '2026-07-18', vehicleName: null, location: '제주', outcome: 'success', summary: '회수 성공', bodyMd: `${gallery}\n\n![단독](/assets/img/rocket/icx1.webp)`, imageSrc: null, published: true }]
  const temp = resolve(webRoot, 'fixtures/.short-snapshot.test.json')
  try {
    const bytes = Buffer.from(JSON.stringify(data))
    writeFileSync(temp, bytes)
    const result = gBuild(temp, bytes)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(existsSync(gOutput('posts/page/2')), false)
    assert.equal(existsSync(gOutput('posts/page/2.html')), false)
    assert.equal(existsSync(gOutput('posts/index.html')), true)
    assert.doesNotMatch(sitemapBody(), /\/posts\/page\/2/)
    const post = readFileSync(gOutput('posts/test-community/index.html'), 'utf8')
    assert.match(post, /aria-label="사진 모음"/)
    assert.match(post, /<img[^>]+alt="발사대"/)
    assert.match(post, /<img[^>]+alt="기체"/)
    for (const page of ['posts/test-community', 'missions/123e4567-e89b-42d3-a456-426614174000']) {
      const html = readFileSync(gOutput(`${page}/index.html`), 'utf8')
      assert.match(html, /data-gallery-columns="2"/)
      assert.match(html, /<figcaption>점화 직전<\/figcaption>/)
      assert.ok(html.indexOf('alt="발사대"') < html.indexOf('alt="기체"'))
    }
    const mission = readFileSync(gOutput('missions/123e4567-e89b-42d3-a456-426614174000/index.html'), 'utf8')
    assert.match(mission, /<img[^>]+alt="단독"[^>]+loading="lazy"/)
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

test('post image dimensions must be paired positive integers', () => {
  const data = clone()
  data.posts[0].attachments[0].height = 0
  assert.throws(() => validateSnapshot(data, publicRoot), /Post/)
  data.posts[0].attachments[0].height = 1024
  delete data.posts[0].attachments[0].width
  assert.throws(() => validateSnapshot(data, publicRoot), /Post/)
})

test('gallery blocks reject unsafe image URLs in posts and missions', () => {
  const data = clone()
  const body = ':::gallery{columns=2}\n\n![비공개](https://example.com/photo.jpg?token=abc)\n\n:::'
  data.posts[0].contentMd = body
  assert.throws(() => validateSnapshot(data, publicRoot), /Post/)
  data.posts[0].contentMd = '공개 기록'
  data.missions = [{ id: '123e4567-e89b-42d3-a456-426614174000', title: '시험 발사', launchDate: '2026-07-18', vehicleName: null, location: '제주', outcome: 'success', summary: '회수 성공', bodyMd: body, imageSrc: null, published: true }]
  assert.throws(() => validateSnapshot(data, publicRoot), /Mission/)
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


test('vehicle specs support old snapshots, explicit removal, and up to six textual entries', () => {
  for (const specs of [undefined, [], [{ label: '회수 방식', value: '낙하산', unit: '' }],
    Array.from({ length: 6 }, () => ({ label: '상태', value: '시험 중', unit: '' }))]) {
    const data = clone()
    if (specs === undefined) delete data.vehicles[0].specs
    else data.vehicles[0].specs = specs
    assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  }
})

test('vehicle specs reject oversized lists and non-textual fields without truncating', () => {
  for (const specs of [null, {}, 'specs', [null], [[]], [{}],
    [{ label: 3, value: 'test', unit: '' }],
    [{ label: 'test', value: 0, unit: '' }],
    [{ label: 'test', value: 'test', unit: null }],
    Array.from({ length: 7 }, () => ({ label: 'test', value: '0', unit: '' }))]) {
    const data = clone()
    data.vehicles[0].specs = specs
    assert.throws(() => validateSnapshot(data, publicRoot), /invalid specs/)
    assert.deepEqual(data.vehicles[0].specs, specs)
  }
})


test('shared vehicle spec resolution honors empty/custom arrays and preserves textual values', () => {
  const legacy = { maxAltitudeM: '00300', sizeM: '1.20', payloadKg: null }
  assert.deepEqual(getVehicleSpecs(legacy), [
    { label: '최대 고도', value: '00300', unit: 'm' },
    { label: '전장', value: '1.20', unit: 'm' },
    { label: '페이로드', value: null, unit: 'kg' },
  ])
  assert.deepEqual(getVehicleSpecs({ ...legacy, specs: [] }), [])
  assert.deepEqual(vehicleSpecFacts({ ...legacy, specs: [] }), [])
  const specs = [{ label: '회수 방식', value: '낙하산 / 시험 중', unit: '' },
    { label: '전장', value: '약 01.20', unit: 'm' }]
  assert.strictEqual(getVehicleSpecs({ ...legacy, specs }), specs)
  assert.deepEqual(vehicleSpecFacts({ ...legacy, specs }), ['회수 방식 낙하산 / 시험 중', '전장 약 01.20 m'])
  assert.deepEqual(vehicleSpecFacts(legacy), ['최대 고도 00300 m', '전장 1.20 m'])
})

test('empty published collections are valid and still reject malformed entries', () => {
  const data = clone()
  data.sections = []; data.panels = []; data.vehicles = []; data.members = []; data.posts = []; data.missions = []
  data.taxonomy = { types: [], series: [] }; data.media = {}
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  data.taxonomy.series = [{ id: 'orphan', label: 'Orphan', typeId: 'missing' }]
  assert.throws(() => validateSnapshot(data, publicRoot), /series/)
})

test('reserved empty route params are pruned recursively without deleting real routes', async () => {
  const { mkdtempSync, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pruneEmptyPages } = await import('./prune-empty-pages.mjs')
  const root = mkdtempSync(resolve(tmpdir(), 'icaros-prune-'))
  try {
    for (const path of ['vehicles/__empty-vehicle', 'vehicles/types/type/__empty-series', 'posts/page/__empty-page', 'vehicles/real']) {
      mkdirSync(resolve(root, path), { recursive: true }); writeFileSync(resolve(root, path, 'index.html'), 'page')
    }
    writeFileSync(resolve(root, 'vehicles/__empty-vehicle.txt'), 'RSC')
    pruneEmptyPages(root)
    assert.equal(existsSync(resolve(root, 'vehicles/__empty-vehicle')), false)
    assert.equal(existsSync(resolve(root, 'vehicles/__empty-vehicle.txt')), false)
    assert.equal(existsSync(resolve(root, 'vehicles/types/type/__empty-series')), false)
    assert.equal(existsSync(resolve(root, 'posts/page/__empty-page')), false)
    assert.equal(existsSync(resolve(root, 'vehicles/real/index.html')), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('all-empty snapshot builds listing routes and exports no sentinel pages or sitemap entries', () => {
  const data = clone()
  data.sections = []; data.panels = []; data.vehicles = []; data.members = []; data.posts = []; data.missions = []
  data.taxonomy = { types: [], series: [] }; data.media = {}
  const temp = resolve(webRoot, 'fixtures/.empty-collections.test.json')
  try {
    const bytes = Buffer.from(JSON.stringify(data)); writeFileSync(temp, bytes)
    const result = gBuild(temp, bytes)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    for (const path of ['index.html', 'vehicles/index.html', 'missions/index.html', 'posts/index.html', 'member/index.html']) assert.equal(existsSync(gOutput(path)), true, path)
    assert.doesNotMatch(sitemapBody(), /__empty-|\/posts\/page\/2/)
    for (const path of ['vehicles/__empty-vehicle', 'vehicles/types/__empty-type', 'posts/__empty-community', 'posts/legacy/__empty-legacy', 'posts/page/__empty-page', 'missions/__empty-mission']) assert.equal(existsSync(gOutput(path)), false, path)
  } finally { rmSync(temp, { force: true }) }
})

test('private member checksum metadata permits only selected no-store portrait URLs', () => {
  const data = clone()
  const id = '123e4567-e89b-42d3-a456-426614174000'; const sha = 'a'.repeat(64)
  const entry = { key: `published/${id}/${sha}.webp`, sha256: sha, mime: 'image/webp', size: 123, entityType: 'member', storage: 'private' }
  data.members[0].hasPhoto = true; data.members[0].imageSrc = `/api/media/${id}`
  data.media[id] = `/api/media/${id}`
  data.compatMediaIndex = { version: data.version, media: { [id]: entry } }
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  for (const change of [{ storage: 'public' }, { entityType: 'rocket' }, { mime: 'image/svg+xml' }, { size: 3 * 1024 * 1024 + 1 }, { key: 'private/original.webp' }]) {
    const invalid = structuredClone(data)
    Object.assign(invalid.compatMediaIndex.media[id], change)
    assert.throws(() => validateSnapshot(invalid, publicRoot), /compatibility/)
  }
  const orphan = structuredClone(data); orphan.members = []
  assert.throws(() => validateSnapshot(orphan, publicRoot), /Orphan/)
  const missing = structuredClone(data); delete missing.compatMediaIndex
  assert.throws(() => validateSnapshot(missing, publicRoot), /Member/)
  const wrong = structuredClone(data); wrong.compatMediaIndex.version = 'other'
  assert.throws(() => validateSnapshot(wrong, publicRoot), /index/)
})

test('public compatibility metadata matches immutable CDN paths and never original bucket keys', () => {
  const data = clone(); const id = '123e4567-e89b-42d3-a456-426614174000'; const sha = 'b'.repeat(64)
  const entry = { key: `published/${id}/${sha}.mp4`, sha256: sha, mime: 'video/mp4', size: 32 * 1024 * 1024, entityType: 'post', storage: 'public' }
  data.media[id] = `https://media.example.test/${entry.key}`
  data.compatMediaIndex = { version: data.version, media: { [id]: entry } }
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  data.media[id] = 'https://media.example.test/private/original.mp4'
  assert.throws(() => validateSnapshot(data, publicRoot), /mismatch/)
})

test('member Markdown images and references accept only index-verified private member proxy URLs', () => {
  const data = clone(); const id = '123e4567-e89b-42d3-a456-426614174000'; const sha = 'c'.repeat(64)
  data.media[id] = `/api/media/${id}`
  data.compatMediaIndex = { version: data.version, media: { [id]: { key: `published/${id}/${sha}.png`, mime: 'image/png', size: 321, sha256: sha, entityType: 'member', storage: 'private' } } }
  data.members[0].bioMd = `![활동](/api/media/${id})\n\n![사진][image]\n\n[image]: /api/media/${id}`
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  for (const bioMd of [
    '![외부](https://example.com/private.webp)',
    '![파일](/assets/models/icx-2-poster.png)',
    `![쿼리](/api/media/${id}?token=abc)`,
    '![미확인](/api/media/223e4567-e89b-42d3-a456-426614174000)',
    `<img src="/api/media/${id}">`,
    `![참조][unknown]\n\n[unknown]: /api/media/${id}/extra`,
  ]) {
    const invalid = structuredClone(data); invalid.members[0].bioMd = bioMd
    assert.throws(() => validateSnapshot(invalid, publicRoot), /Member|Orphan/)
  }
  const invalid = structuredClone(data)
  invalid.posts[0].contentMd = `![멤버](/api/media/${id})`
  assert.throws(() => validateSnapshot(invalid, publicRoot), /Post/)
})

test('empty series keep real type listing pages and prune nested series sentinels', () => {
  const data = clone(); data.taxonomy.series = []; data.vehicles = []
  const temp = resolve(webRoot, 'fixtures/.empty-series.test.json')
  try {
    const bytes = Buffer.from(JSON.stringify(data)); writeFileSync(temp, bytes)
    const result = gBuild(temp, bytes)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    for (const type of data.taxonomy.types) {
      assert.equal(existsSync(gOutput(`vehicles/types/${type.id}/index.html`)), true)
      assert.equal(existsSync(gOutput(`vehicles/types/${type.id}/__empty-series`)), false)
    }
    assert.doesNotMatch(sitemapBody(), /__empty-/)
  } finally { rmSync(temp, { force: true }) }
})


test('public panels reject missing or malformed render scalars', () => {
  for (const [field, invalids] of Object.entries({
    mime: [undefined, null, 0, '', 'image/svg+xml', 'text/html'],
    width: [undefined, null, '20', 0, -1, 1.5, NaN, Infinity],
    height: [undefined, null, '20', 0, -1, 1.5, NaN, Infinity],
    headline: [undefined, null, 7], alt: [undefined, null, 7],
    focalX: [undefined, null, '50', -1, 101, NaN, Infinity],
    focalY: [undefined, null, '50', -1, 101, NaN, Infinity],
    posterSrc: ['/api/media/private', 'https://example.test/poster.png?token=secret'],
  })) {
    for (const invalid of invalids) {
      const data = clone(); data.panels[0][field] = invalid
      assert.throws(() => validateSnapshot(data, publicRoot), /panel/, `${field}: ${String(invalid)}`)
    }
  }
  const data = clone(); data.panels[0].posterSrc = '/assets/models/icx-2-poster.png'
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
})

const departmentA = '123e4567-e89b-42d3-a456-426614174010'
const departmentB = '123e4567-e89b-42d3-a456-426614174011'
const departments = [
  { id: departmentB, name: '제작부', sortOrder: 5 },
  { id: departmentA, name: '전자부', sortOrder: 0 },
]
test('department catalogs and ID assignments validate while older snapshots remain supported', () => {
  assert.doesNotThrow(() => validateSnapshot(clone(), publicRoot))
  const data = clone(); data.departments = departments
  data.members[0].departmentIds = [departmentB, departmentA]
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  for (const catalog of [null, {}, [null], [{ ...departments[0], id: 'not-uuid' }],
    [{ ...departments[0], name: '' }], [{ ...departments[0], sortOrder: NaN }],
    [{ ...departments[0], sortOrder: '1' }], [departments[0], departments[0]]]) {
    const invalid = structuredClone(data); invalid.departments = catalog
    assert.throws(() => validateSnapshot(invalid, publicRoot), /department/i)
  }
  for (const ids of [null, 'id', ['not-uuid'], [departmentA, departmentA],
    ['123e4567-e89b-42d3-a456-426614174099']]) {
    const invalid = structuredClone(data); invalid.members[0].departmentIds = ids
    assert.throws(() => validateSnapshot(invalid, publicRoot), /department/i)
  }
  const invalid = structuredClone(data); delete invalid.departments
  assert.throws(() => validateSnapshot(invalid, publicRoot), /department/i)
  data.members[0].departmentIds = []
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
})

test('member department ID groups render catalog order and all affiliations on each card', () => {
  const data = clone(); const leadId = '123e4567-e89b-42d3-a456-426614174020'
  data.departments = departments.map(department => ({ ...department, leadMemberId: leadId }))
  const bioId = '123e4567-e89b-42d3-a456-426614174012'; const sha = 'c'.repeat(64)
  data.members = [{ ...data.members[0], id: '123e4567-e89b-42d3-a456-426614174021', name: '기존 첫 부원', departmentIds: [departmentA, departmentB] },
    { ...data.members[0], id: leadId, name: '합성 복수 부원', role: '저장된 역할',
    squad: '이전 부서명', squads: ['이전 부서명'], departmentIds: [departmentB, departmentA],
    bioMd: `텍스트 소개 ![승인 사진](/api/media/${bioId})` },
    { ...data.members[0], id: 'unassigned', name: '합성 미배정 부원', departmentIds: [] }]
  data.media[bioId] = `/api/media/${bioId}`
  data.compatMediaIndex = { version: data.version, media: { [bioId]: {
    key: `published/${bioId}/${sha}.webp`, sha256: sha, mime: 'image/webp', size: 123, entityType: 'member', storage: 'private',
  } } }
  const temp = resolve(webRoot, 'fixtures/.member-departments.test.json')
  try {
    const bytes = Buffer.from(JSON.stringify(data)); writeFileSync(temp, bytes)
    const result = spawnSync('npm', ['run', 'build', '-w', '@icaros/web', ...(process.env.ICAROS_TEST_WEBPACK === '1' ? ['--', '--webpack'] : [])], {
      cwd: resolve(webRoot, '../..'), encoding: 'utf8', maxBuffer: 1024 * 1024 * 5,
      env: { ...process.env, ICAROS_SNAPSHOT: temp, ICAROS_SNAPSHOT_SHA256: createHash('sha256').update(bytes).digest('hex') },
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const html = readFileSync(gOutput('member/index.html'), 'utf8').replace(/<script\b[\s\S]*?<\/script>/g, '')
    const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map(match => match[1])
    assert.deepEqual(headings, ['전자부', '제작부', '기타'])
    const cards = [...html.matchAll(/<li\b[^>]*data-reveal-item=""[^>]*>[\s\S]*?<\/li>/g)].map(match => match[0])
    assert.equal(cards.length, 5)
    assert.match(cards[0], /제작부 · 전자부/); assert.match(cards[0], /합성 복수 부원/)
    assert.match(cards[1], /전자부 · 제작부/); assert.match(cards[1], /기존 첫 부원/)
    assert.match(cards[2], /제작부 · 전자부/); assert.match(cards[2], /합성 복수 부원/)
    assert.match(cards[3], /전자부 · 제작부/); assert.match(cards[3], /기존 첫 부원/); assert.match(cards[4], /기타/)
    assert.doesNotMatch(html, /저장된 역할|이전 부서명|승인 사진|\/api\/media\//)
    assert.doesNotMatch(html, /텍스트 소개/)
  } finally { rmSync(temp, { force: true }) }
})


test('local member projection retains multiple department IDs and legacy labels', async () => {
  const { localMemberSnapshot } = await import('../../../scripts/build-web-local.mjs')
  const member = { id: 'local-multi', name: '합성 부원', role: '저장 역할', public_squad: '전자부',
    public_squads: ['전자부', '제작부'], department_ids: [departmentA, departmentB], school: null,
    bio_md: null }
  const result = localMemberSnapshot(member, null, () => { throw new Error('No media expected') })
  assert.deepEqual(result.departmentIds, [departmentA, departmentB])
  assert.deepEqual(result.squads, ['전자부', '제작부'])
  assert.equal(result.squad, '전자부')
  assert.equal(result.role, '저장 역할')
})

test('local member bio fingerprint keeps raster bytes private and rejects mismatched headers', async () => {
  const local = await import('../../../scripts/build-web-local.mjs')
  const id = '123e4567-e89b-42d3-a456-426614174012'
  const bytes = readFileSync(resolve(publicRoot, 'assets/models/icx-2-poster.png'))
  const media = { id, mime: 'image/png', size: bytes.length, declared_checksum_sha256: createHash('sha256').update(bytes).digest('base64') }
  const entry = local.localMemberCompatibilityEntry(media, bytes)
  assert.equal(entry.storage, 'private'); assert.equal(entry.entityType, 'member')
  assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'))
  for (const change of [{ mime: 'image/webp' }, { mime: 'image/svg+xml' }, { size: bytes.length + 1 },
    { declared_checksum_sha256: 'a'.repeat(44) }]) {
    assert.throws(() => local.localMemberCompatibilityEntry({ ...media, ...change }, bytes), /member media/i)
  }
  assert.throws(() => local.localMemberCompatibilityEntry(media, Buffer.from('<svg/>')), /member media/i)
})


test('local biography collection validates byte metadata and cleans private staging on success and failure', async () => {
  const { mkdtempSync, readdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { collectLocalMemberBioMedia, localMemberSnapshot } = await import('../../../scripts/build-web-local.mjs')
  const { selectedMemberMediaIds } = await import('../../../infra/release/compat-media-index.mjs')
  const id = '123e4567-e89b-42d3-a456-426614174012'
  const unused = '123e4567-e89b-42d3-a456-426614174013'
  const bytes = readFileSync(resolve(publicRoot, 'assets/models/icx-2-poster.png'))
  const bioMd = `![승인 사진][image]\n\n[image]: /api/media/${id} "사진 설명"\n\n[unused]: /api/media/${unused}`
  const data = clone()
  data.members = [localMemberSnapshot({ id: 'local-bio', name: '합성 소개', role: null, public_squad: null,
    department_ids: [], school: null, bio_md: bioMd }, null, () => '')]
  const ids = selectedMemberMediaIds(data)
  assert.deepEqual([...ids], [id])
  const directory = mkdtempSync(resolve(tmpdir(), 'icaros-local-bio-test-'))
  const media = new Map([[id, { id, mime: 'image/png', size: bytes.length }]])
  const destinations = []
  try {
    const result = await collectLocalMemberBioMedia(ids, media, directory, async (_media, destination) => {
      destinations.push(destination); writeFileSync(destination, bytes)
    })
    data.media = result.privateUrls; data.compatMediaIndex = { version: data.version, media: result.compatMedia }
    assert.throws(() => validateSnapshot(data, publicRoot), /Member/)
    data.members[0].bioMd = bioMd.replace(`\n\n[unused]: /api/media/${unused}`, '')
    assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
    assert.ok(destinations.every(destination => destination.startsWith(`${directory}/member-bio-`)))
    assert.deepEqual(readdirSync(directory), [])
    for (const bad of [Buffer.from('<svg/>'), null]) {
      await assert.rejects(collectLocalMemberBioMedia(ids, media, directory, async (_media, destination) => {
        writeFileSync(destination, bad ?? bytes)
        if (bad === null) throw new Error('download interrupted')
      }))
      assert.deepEqual(readdirSync(directory), [])
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})


test('video panels support legacy null dimensions but reject supplied invalid dimensions', () => {
  for (const dimensions of [{}, { width: null, height: null }, { width: 1920, height: 1080 }]) {
    const data = clone(); data.panels[0].mime = 'video/mp4'
    delete data.panels[0].width; delete data.panels[0].height
    Object.assign(data.panels[0], dimensions)
    assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  }
  for (const value of [0, -1, '1920', NaN, Infinity, 2.5]) {
    const data = clone(); data.panels[0].mime = 'video/mp4'; data.panels[0].width = value
    assert.throws(() => validateSnapshot(data, publicRoot), /panel/)
  }
})

test('department leaders must reference a visible member assigned to that exact department', () => {
  const leader = '123e4567-e89b-42d3-a456-426614174020'
  const data = clone(); data.departments = [{ ...departments[1], leadMemberId: leader }]
  data.members = [{ ...data.members[0], id: leader, departmentIds: [departmentA] }]
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  for (const leadMemberId of ['not-uuid', '', 3, [], '123e4567-e89b-42d3-a456-426614174099']) {
    const invalid = structuredClone(data); invalid.departments[0].leadMemberId = leadMemberId
    assert.throws(() => validateSnapshot(invalid, publicRoot), /department.*lead/i)
  }
  const detached = structuredClone(data); detached.members[0].departmentIds = []
  assert.throws(() => validateSnapshot(detached, publicRoot), /department.*lead/i)
  const hidden = structuredClone(data); hidden.members = []
  assert.throws(() => validateSnapshot(hidden, publicRoot), /department.*lead/i)
  data.departments[0].leadMemberId = null
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
  delete data.departments[0].leadMemberId
  assert.doesNotThrow(() => validateSnapshot(data, publicRoot))
})
test('local department projection exports visible assigned leaders and clears nonvisible leaders', async () => {
  const { localDepartmentSnapshot } = await import('../../../scripts/build-web-local.mjs')
  const leader = '123e4567-e89b-42d3-a456-426614174020'
  const row = { id: departmentA, name: '전자부', sort_order: 0, lead_member_id: leader }
  const visible = [{ id: leader, department_ids: [departmentA] }]
  assert.deepEqual(localDepartmentSnapshot(row, visible), { id: departmentA, name: '전자부', sortOrder: 0, leadMemberId: leader })
  for (const members of [[], [{ id: leader, department_ids: [departmentB] }]]) assert.equal(localDepartmentSnapshot(row, members).leadMemberId, null)
  assert.equal(localDepartmentSnapshot({ ...row, lead_member_id: null }, visible).leadMemberId, null)
})
