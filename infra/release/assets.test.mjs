import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareReleaseExport, safeExportPath } from './export.mjs'

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'icaros-asset-test-'))
  for (const path of ['_next/static/chunks', '_next/static/media', 'assets/nested']) mkdirSync(join(root, path), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<script src="/_next/static/chunks/runtime.js"></script><img src="/assets/photo.webp"><img src="https://media.example.test/assets/public.webp"><a href="/vehicles/">Vehicles</a>')
  writeFileSync(join(root, '404.html'), '<img src="/assets/photo.webp">')
  writeFileSync(join(root, 'sitemap.xml'), '<urlset/>')
  writeFileSync(join(root, 'index.txt'), '0:{"src":"/assets/photo.webp"}')
  writeFileSync(join(root, '_next/static/chunks/runtime.js'), 'const base=typeof TURBOPACK_CHUNK_BASE_PATH==="string"?TURBOPACK_CHUNK_BASE_PATH:"/_next/";const marker=src.indexOf("/_next/");const css=`${ctx.assetPrefix}/_next/${file}`;const photo="/assets/photo.webp";')
  writeFileSync(join(root, '_next/static/chunks/site.css'), 'a{src:url(../media/font.woff2)}b{background:url(/assets/photo.webp)}c{background:url(../../../../assets/photo.webp)}d{background:url(https://media.example.test/assets/public.webp)}e{filter:url(#filter)}')
  writeFileSync(join(root, '_next/static/media/font.woff2'), 'font')
  writeFileSync(join(root, 'assets/photo.webp'), 'old-photo')
  writeFileSync(join(root, 'assets/nested/site.css'), '@import "../../_next/static/chunks/site.css";')
  return root
}

test('old HTML, CSS and delayed runtime requests stay pinned after release switch', () => {
  const old = tree(); const next = tree()
  try {
    const a = prepareReleaseExport(old, { version: '1', compatMediaIndex: { version: '1', media: {} } })
    writeFileSync(join(next, 'assets/photo.webp'), 'new-photo')
    const b = prepareReleaseExport(next, { version: '2' })
    assert.notEqual(a.assetHash, b.assetHash)
    const prefix = `/_release/${a.assetHash}`
    assert.match(readFileSync(join(old, 'index.html'), 'utf8'), new RegExp(`${prefix}/assets/photo.webp`))
    assert.match(readFileSync(join(old, 'index.txt'), 'utf8'), new RegExp(`${prefix}/assets/photo.webp`))
    const css = readFileSync(join(old, '_next/static/chunks/site.css'), 'utf8')
    assert.ok(css.includes(`${prefix}/_next/static/media/font.woff2`))
    assert.equal(css.split(`${prefix}/assets/photo.webp`).length - 1, 2)
    assert.ok(css.includes('https://media.example.test/assets/public.webp'))
    assert.ok(css.includes('url(#filter)'))
    const js = readFileSync(join(old, '_next/static/chunks/runtime.js'), 'utf8')
    assert.ok(js.includes(`TURBOPACK_CHUNK_BASE_PATH:"${prefix}/_next/"`))
    assert.ok(js.includes('src.indexOf("/_next/")'))
    assert.ok(js.includes(`ctx.assetPrefix||"${prefix}"`))
    const html = readFileSync(join(old, 'index.html'), 'utf8')
    assert.ok(html.includes('href="/vehicles/"'))
    assert.ok(html.includes('https://media.example.test/assets/public.webp'))
    const asset = a.assets.find(file => file.path === 'assets/photo.webp')
    assert.equal(asset.key, `release-assets/${a.assetHash}/assets/photo.webp`)
    assert.equal(readFileSync(join(old, asset.path), 'utf8'), 'old-photo')
    assert.ok(a.files.some(file => file.path === 'compat-media-index.json'))
    assert.deepEqual(JSON.parse(readFileSync(join(old, 'compat-media-index.json'), 'utf8')), { version: '1', media: {} })
  } finally { rmSync(old, { recursive: true }); rmSync(next, { recursive: true }) }
})

test('same asset tree has deterministic scope independently of HTML and snapshot metadata', () => {
  const a = tree(); const b = tree()
  try {
    writeFileSync(join(b, 'index.html'), '<p>Different HTML</p>')
    assert.equal(prepareReleaseExport(a, { version: '1' }).assetHash, prepareReleaseExport(b, { version: '2' }).assetHash)
  } finally { rmSync(a, { recursive: true }); rmSync(b, { recursive: true }) }
})

test('missing or escaping CSS dependencies and malformed compatibility metadata fail before upload', () => {
  const root = tree()
  try {
    writeFileSync(join(root, '_next/static/chunks/site.css'), 'x{src:url(../media/missing.woff2)}')
    assert.throws(() => prepareReleaseExport(root, { version: '1' }), /missing|dependency/i)
  } finally { rmSync(root, { recursive: true }) }
})

test('compat metadata is exported verbatim but private member portraits never enter shared files', () => {
  const root = tree()
  const id = '123e4567-e89b-42d3-a456-426614174000'; const sha = 'a'.repeat(64)
  const entry = { storage: 'private', entityType: 'member', key: `published/${id}/${sha}.webp`, mime: 'image/webp', size: 12, sha256: sha }
  try {
    const snapshot = { version: '3', members: [{ published: true, hasPhoto: true, imageSrc: `/api/media/${id}` }], media: { [id]: `/api/media/${id}` }, compatMediaIndex: { version: '3', media: { [id]: entry } } }
    const result = prepareReleaseExport(root, snapshot)
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'compat-media-index.json'))), snapshot.compatMediaIndex)
    assert.ok(result.files.some(file => file.path === 'compat-media-index.json'))
    assert.ok(result.assets.every(file => file.path !== 'compat-media-index.json'))
    assert.throws(() => prepareReleaseExport(root, { ...snapshot, compatMediaIndex: { version: '2', media: {} } }), /index/)
    assert.throws(() => prepareReleaseExport(root, { version: '3', members: [{ hasPhoto: true, imageSrc: '/assets/photo.webp' }] }), /member portraits/)
    assert.throws(() => prepareReleaseExport(root, { ...snapshot, members: [] }), /Orphan/)
  } finally { rmSync(root, { recursive: true }) }
})

test('scoped old assets resolve through the actual router without reading the current release pointer', async () => {
  const { runInNewContext } = await import('node:vm')
  const root = tree()
  try {
    const prepared = prepareReleaseExport(root, { version: '1' })
    const source = readFileSync(new URL('../cloudfront/release-router.js', import.meta.url), 'utf8').replace("import cf from 'cloudfront';", '')
    let reads = 0
    const router = runInNewContext(`${source}\nhandler`, { cf: { kvs: () => ({ get: async () => { reads++; return `releases/v2-${'b'.repeat(64)}` } }) } })
    for (const file of prepared.assets) {
      const request = await router({ request: { uri: `${prepared.assetPrefix}/${file.path}` } })
      assert.equal(request.uri, `/${file.key}`)
    }
    assert.equal(reads, 0)
    const js = readFileSync(join(root, '_next/static/chunks/runtime.js'), 'utf8')
    const result = runInNewContext(`${js};({base,marker,css,photo})`, { src: `${prepared.assetPrefix}/_next/static/chunks/runtime.js`, ctx: { assetPrefix: '' }, file: 'static/chunks/lazy.css' })
    assert.equal(result.base, `${prepared.assetPrefix}/_next/`)
    assert.equal(result.css, `${prepared.assetPrefix}/_next/static/chunks/lazy.css`)
    assert.equal(result.photo, `${prepared.assetPrefix}/assets/photo.webp`)
    assert.equal(result.marker, prepared.assetPrefix.length)
  } finally { rmSync(root, { recursive: true }) }
})

test('local/private files are excluded from both staged manifest and shared uploads', () => {
  const root = tree()
  try {
    for (const directory of ['assets/local-media', 'assets/private', 'assets/img/member']) mkdirSync(join(root, directory), { recursive: true })
    for (const path of ['assets/local-media/portrait.webp', 'assets/private/original.webp', 'assets/img/member/person.webp', 'assets/secrets.json']) writeFileSync(join(root, path), 'not-public')
    const prepared = prepareReleaseExport(root, { version: '1' })
    for (const file of prepared.files) assert.doesNotMatch(file.path, /local-media|private|person.webp|secrets.json/)
  } finally { rmSync(root, { recursive: true }) }
})


test('actual Next segmented RSC filenames and root font CSS survive release preparation', () => {
  const root = tree()
  try {
    const path = 'vehicles/a/__next.!KHB1YmxpYyk.vehicles.$d$slug.__PAGE__.txt'
    mkdirSync(join(root, 'vehicles/a'), { recursive: true }); writeFileSync(join(root, path), '{"src":"/assets/photo.webp"}')
    mkdirSync(join(root, 'fonts')); writeFileSync(join(root, 'fonts/pretendard.woff2'), 'root-font')
    writeFileSync(join(root, '_next/static/chunks/site.css'), 'a{src:url(/fonts/pretendard.woff2)}b{src:url(../../../fonts/pretendard.woff2)}')
    const prepared = prepareReleaseExport(root, { version: '1' })
    assert.ok(prepared.files.some(file => file.path === path))
    assert.ok(prepared.assets.some(file => file.path === 'assets/fonts/pretendard.woff2'))
    const css = readFileSync(join(root, '_next/static/chunks/site.css'), 'utf8')
    assert.equal(css.split(`${prepared.assetPrefix}/assets/fonts/pretendard.woff2`).length - 1, 2)
    assert.equal(safeExportPath(path), true)
    for (const invalid of ['vehicles/../__next.a.txt', 'vehicles/$unsafe/index.html', '__next.a.txt?secret', 'assets/secret!.json']) assert.equal(safeExportPath(invalid), false)
  } finally { rmSync(root, { recursive: true }) }
})
