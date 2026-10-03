import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
function route(file, uri, method='GET') {
 const context={}
 const source=readFileSync(new URL(file,import.meta.url),'utf8').replace('__CMS_ORIGIN__','https://cms.example.invalid')
 vm.runInNewContext(source,context)
 return context.handler({request:{uri,method,querystring:{code:{value:'synthetic'}}}})
}
test('public API admits only media UUID GET/HEAD, no admin or encoded path',()=>{
 const id='00000000-0000-0000-0000-000000000001'
 assert.equal(route('public-api-router.js',`/api/media/${id}`,'HEAD').uri,`/api/media/${id}`)
 for(const [path,method] of [['/api','GET'],['/api/admin/posts','GET'],[`/api/media/${id}`,'POST'],[`/api/media/${id}/`,'GET'],['/api/%6dedia/'+id,'GET']]) assert.equal(route('public-api-router.js',path,method).statusCode,404)
})
test('public admin only redirects to canonical CMS and drops auth query',()=>{
 const result=route('public-admin-router.js','/admin/edit')
 assert.equal(result.statusCode,308)
 assert.equal(result.headers.location.value,'https://cms.example.invalid/admin/')
 for(const path of ['/admin/../api','/admin/%2e%2e','/admin//edit']) assert.equal(route('public-admin-router.js',path).statusCode,404)
})
test('CMS root maps admin index without API SPA fallback',()=>{
 assert.equal(route('cms-router.js','/').uri,'/admin/index.html')
 assert.equal(route('cms-router.js','/admin').statusCode,308)
 assert.equal(route('cms-router.js','/admin/assets/a.js').uri,'/admin/assets/a.js')
 for(const path of ['/api/admin/auth','/missing','/admin/../api','/admin/%2e']) assert.equal(route('cms-router.js',path).statusCode,404)
})
test('media origin rejects listing, raw keys, and nonpublisher formats',()=>{
 const path=`/published/00000000-0000-0000-0000-000000000001/${'a'.repeat(64)}.webp`
 assert.equal(route('media-router.js',path).uri,path)
 for(const uri of ['/','/icaros-web/photo.webp',path.replace('.webp','.svg'),path.replace('/published/','/Published/')]) assert.equal(route('media-router.js',uri).statusCode,404)
})
