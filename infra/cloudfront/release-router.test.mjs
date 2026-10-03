import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('./release-router.js', import.meta.url), 'utf8')
const release = `releases/v7-${'a'.repeat(64)}`
function route(uri, value = release) {
  const context = { cf: { kvs: () => ({ get: async () => value }) } }
  vm.runInNewContext(source.replace("import cf from 'cloudfront';", ''), context)
  return context.handler({ request: { uri } })
}
test('routes public HTML and assets within one release', async () => {
  assert.equal((await route('/')).uri, `/${release}/index.html`)
  assert.equal((await route('/posts/123/')).uri, `/${release}/posts/123/index.html`)
  assert.equal((await route('/posts/123')).uri, `/${release}/posts/123/index.html`)
  assert.equal((await route('/_next/static/a.js')).uri, `/${release}/_next/static/a.js`)
})
test('keeps admin and api behaviors and rejects private prefixes', async () => {
  assert.equal((await route('/admin')).statusCode, 404)
  assert.equal((await route('/admin/edit')).statusCode, 404)
  assert.equal((await route('/api/admin/posts')).statusCode, 404)
  assert.equal((await route('/__releases/x')).statusCode, 404)
})
test('fails closed for missing pointer; unknown pages reach S3 as missing files', async () => {
  assert.equal((await route('/', 'bad')).statusCode, 503)
  assert.equal((await route('/missing')).uri, `/${release}/missing/index.html`)
})
test('blocks actual storage prefixes with and without trailing slash or encoded letters', async () => {
  for (const uri of ['/releases', '/releases/v1-a/index.html', '/__staging', '/__staging/x',
    '/snapshots', '/snapshots/v1/x.json', '/__releases', '/%72eleases/x', '/%73napshots/x']) {
    assert.equal((await route(uri)).statusCode, 404, uri)
  }
})
test('rejects traversal, separators, nested encoding, malformed escapes and controls', async () => {
  for (const uri of ['/../index.html', '/x/./a', '/x/../releases/x', '/x/%2e%2e/a',
    '/%2Freleases/x', '/x%5cy', '/%252e%252e/a', '//releases/x', '/x\\y',
    '/%00x', '/%7Fx', '/%ZZ', '/x?y', '/x#y']) {
    assert.equal((await route(uri)).statusCode, 404, uri)
  }
  assert.equal((await route('/assets/a.b.webp')).uri, `/${release}/assets/a.b.webp`)
})

test('shared asset namespace stays independent of pointer and denies private/metadata paths', async()=>{
 const sha='b'.repeat(64)
 assert.equal((await route(`/_release/${sha}/_next/static/a.js`,'bad')).uri,`/release-assets/${sha}/_next/static/a.js`)
 assert.equal((await route(`/_release/${sha}/assets/font.woff2`,'bad')).uri,`/release-assets/${sha}/assets/font.woff2`)
 for(const uri of ['/compat-media-index.json','/published-member-media.json','/manifest.json','/snapshot.json',
 `/release-assets/${sha}/assets/a.js`,`/_release/${sha}/assets/private/a.webp`,
 `/_release/${sha}/assets/local-media/a.webp`,`/_release/${sha}/assets/img/member/person.webp`,
 `/_release/${sha}/index.html`,`/_release/${sha}/assets/a.json`]) assert.equal((await route(uri)).statusCode,404,uri)
})

test('Next RSC !/$ are limited to __next txt basename and strict directories',async()=>{
 const name='__next.!KHB1YmxpYyk.posts.$d$id.__PAGE__.txt'
 assert.equal((await route('/posts/'+name)).uri,`/${release}/posts/${name}`)
 assert.equal((await route('/posts/'+name.replaceAll('$','%24').replace('!','%21'))).uri,`/${release}/posts/${name}`)
 const sha='b'.repeat(64)
 assert.equal((await route(`/_release/${sha}/_next/static/${name}`,'bad')).statusCode,404)
 for(const uri of ['/bad!dir/'+name,'/posts/other!file.txt','/posts/__next.bad$name.js',`/_release/${sha}/assets/a!b.js`,`/_release/${sha}/assets/__next.bad.txt/extra`]) assert.equal((await route(uri)).statusCode,404,uri)
})
