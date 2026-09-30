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
  assert.equal((await route('/admin')).uri, '/admin')
  assert.equal((await route('/admin/edit')).uri, '/admin/edit')
  assert.equal((await route('/api/admin/posts')).uri, '/api/admin/posts')
  assert.equal((await route('/__releases/x')).statusCode, 404)
})
test('fails closed for missing pointer; unknown pages reach S3 as missing files', async () => {
  assert.equal((await route('/', 'bad')).statusCode, 503)
  assert.equal((await route('/missing')).uri, `/${release}/missing/index.html`)
})
