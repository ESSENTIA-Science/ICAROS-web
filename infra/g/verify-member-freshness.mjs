import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import net from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
// Run after a synthetic OpenNext build. Only generated files receive fixture adapters.
const root = fileURLToPath(new URL('../..', import.meta.url))
const output = resolve(root, 'apps/web/.open-next/server-functions/default')
const compiledConfig = resolve(output, 'apps/web/open-next.config.mjs')
const originalConfig = readFileSync(compiledConfig, 'utf8')
const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function() { throw new Error('Fixture forbids network connections') }
const sdk = await import(pathToFileURL(resolve(root, 'node_modules/@aws-sdk/client-s3/dist-cjs/index.js')).href)
const objects = new Map()
const puts = []
let pausedKey, pauseEntered, releaseSnapshot
const pausedSnapshot = new Promise(resolve => { pauseEntered = resolve })
const snapshotGate = new Promise(resolve => { releaseSnapshot = resolve })
const s3 = { async send(command) {
  const input = command.input
  if (command.constructor.name.startsWith('GetObjectCommand')) {
    if (!objects.has(input.Key)) { const error = new Error('NoSuchKey'); error.name = 'NoSuchKey'; throw error }
    const bytes = objects.get(input.Key)
    if (input.Key === pausedKey) { pauseEntered(); await snapshotGate }
    return { Body: { transformToByteArray: async () => bytes, transformToString: async () => bytes.toString() }, LastModified: new Date() }
  }
  if (command.constructor.name.startsWith('PutObjectCommand')) { objects.set(input.Key, Buffer.from(input.Body)); puts.push(input.Key); return {} }
  throw new Error('Unexpected synthetic S3 command: ' + command.constructor.name)
} }
sdk.S3Client.prototype.send = s3.send
Object.assign(process.env, { ICAROS_SNAPSHOT_BUCKET: 'synthetic', ICAROS_POINTER_KEY: 'control/g-pointer.json', ICAROS_RUNTIME_POINTER: '/tmp/icaros-pointer.json', CACHE_BUCKET_NAME: 'synthetic-cache', OPEN_NEXT_BUILD_ID: readFileSync(resolve(root, 'apps/web/.next/BUILD_ID'), 'utf8').trim(), AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic' })
globalThis.__icarosSyntheticS3 = s3
const config = originalConfig.replace('s3: new import_client_s3.S3Client({ region: process.env.CACHE_BUCKET_REGION })', 's3: globalThis.__icarosSyntheticS3')
  .replace('var open_next_config_default = config;', "config.dangerous = { disableTagCache: true }; config.default.override.queue = () => Promise.resolve({name: 'fixture', send: async () => {}}); var open_next_config_default = config;")
writeFileSync(compiledConfig, config)
copyFileSync(resolve(root, 'infra/g/visible-posts.mjs'), resolve(output, 'visible-posts.mjs'))
let wrapper = readFileSync(resolve(root, 'infra/g/server-wrapper.mjs'), 'utf8').replace("'./open-next-entry.mjs'", "'./index.mjs'")
  .replace("'@aws-sdk/client-s3'", JSON.stringify(pathToFileURL(resolve(root, 'node_modules/@aws-sdk/client-s3/dist-cjs/index.js')).href))
// Synthetic adapter pauses a request before invoking the real generated Next handler.
wrapper = wrapper.replace('scope.run(snapshotSha, () => openNextHandler(event, context))',
  'scope.run(snapshotSha, async () => { await globalThis.__icarosBeforeRender?.(event); return openNextHandler(event, context) })')
writeFileSync(resolve(output, 'g-wrapper.test.mjs'), wrapper)
try {
  const { handler } = await import(pathToFileURL(resolve(output, 'g-wrapper.test.mjs')).href)
  const fixture = JSON.parse(readFileSync(resolve(root, 'apps/web/fixtures/public.synthetic.json'), 'utf8'))
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
  const select = (version, rename) => {
    const data = {...fixture, version: String(version), departments: [{id:a, name:rename ? 'Updated Department' : 'Original Department', sortOrder: rename ? 0 : 10}, {id:b,name:'Other Department',sortOrder:rename ? 20 : 0}], members: [{...fixture.members[0], id:'member-a', name:'Synthetic Member A', role:'Historical Role', squad:'Old squad', squads:[], departmentIds:[a], imageSrc:'/assets/img/member/profile.webp', hasPhoto:false,bioMd:null}, {...fixture.members[0],id:'member-b',name:'Synthetic Member B',squad:'Other',squads:[],departmentIds:[b],imageSrc:'/assets/img/member/profile.webp',hasPhoto:false,bioMd:null}]}
    const bytes = Buffer.from(JSON.stringify(data)); const sha = createHash('sha256').update(bytes).digest('hex'); const key=`snapshots/v${version}/${sha}.json`
    objects.set(key, bytes); objects.set('control/g-pointer.json', Buffer.from(JSON.stringify({version,key,sha256:sha}))); return sha
  }
  const request = { version:'2.0',routeKey:'$default',rawPath:'/member/',rawQueryString:'',headers:{host:'localhost'},requestContext:{http:{method:'GET',path:'/member/',protocol:'HTTP/1.1',sourceIp:'127.0.0.1',userAgent:'Synthetic G verification'}},isBase64Encoded:false }
  const context = {getRemainingTimeInMillis:()=>30000,callbackWaitsForEmptyEventLoop:false}
  const firstSha = select(1,false)
  const first = await handler(request, context)
  const secondSha = select(2,true)
  const second = await handler(request, context)
  assert.equal(first.statusCode,200);assert.match(first.body,/Original Department/)
  assert.equal(second.statusCode,200);assert.match(second.body,/Updated Department/);assert.doesNotMatch(second.body,/Original Department/)
  assert.ok(first.body.indexOf('Other Department') < first.body.indexOf('Original Department'))
  assert.ok(second.body.indexOf('Updated Department') < second.body.indexOf('Other Department'))
  assert.equal(second.headers['x-icaros-snapshot-sha'], secondSha)
  assert.ok(puts.some(key => key.startsWith(firstSha+'/')))
  assert.ok(puts.some(key => key.startsWith(secondSha+'/')))
  const writesBeforeWarm = puts.length
  const warm = await handler(request, context)
  assert.equal(warm.statusCode, 200)
  assert.match(warm.body, /Updated Department/)
  assert.doesNotMatch(warm.body, /Original Department/)
  assert.equal(puts.length, writesBeforeWarm, 'warm response must reuse its versioned cache')
  let secondEntered, releaseRender
  const secondWaiting = new Promise(resolve => { secondEntered = resolve })
  const renderGate = new Promise(resolve => { releaseRender = resolve })
  globalThis.__icarosBeforeRender = async event => {
    if (event.headers?.['x-fixture'] === 'second') { secondEntered(); await renderGate }
  }
  const concurrentFirstSha = select(3, false)
  pausedKey = `snapshots/v3/${concurrentFirstSha}.json`
  const concurrentFirst = handler(request, context)
  await pausedSnapshot
  const concurrentSecondSha = select(4, true)
  const concurrentSecond = handler({ ...request, headers: { ...request.headers, 'x-fixture': 'second' } }, context)
  await secondWaiting
  releaseSnapshot()
  const firstConcurrentResponse = await concurrentFirst
  releaseRender()
  const secondConcurrentResponse = await concurrentSecond
  assert.equal(firstConcurrentResponse.statusCode, 200)
  assert.match(firstConcurrentResponse.body, /Original Department/)
  assert.doesNotMatch(firstConcurrentResponse.body, /Updated Department/)
  assert.equal(firstConcurrentResponse.headers['x-icaros-snapshot-sha'], concurrentFirstSha)
  assert.equal(secondConcurrentResponse.statusCode, 200)
  assert.match(secondConcurrentResponse.body, /Updated Department/)
  assert.doesNotMatch(secondConcurrentResponse.body, /Original Department/)
  assert.equal(secondConcurrentResponse.headers['x-icaros-snapshot-sha'], concurrentSecondSha)
  assert.ok(puts.some(key => key.startsWith(concurrentFirstSha + '/')))
  assert.ok(puts.some(key => key.startsWith(concurrentSecondSha + '/')))
  const afterOverlap = await handler(request, context)
  assert.match(afterOverlap.body, /Updated Department/)
  assert.equal(afterOverlap.headers['x-icaros-snapshot-sha'], concurrentSecondSha)
  assert.deepEqual([firstSha, secondSha, concurrentFirstSha, concurrentSecondSha]
    .filter(sha => existsSync(`/tmp/icaros-snapshot-${sha}.json`)), [concurrentSecondSha])
  console.log(JSON.stringify({ok:true, boundedRetainedFiles:1, syntheticOverlappingRequests:true, changedMemberNameAndOrder:true, versionedCacheWrites:puts.length, networkAllowed:false}))
} catch(error) { process.exitCode=1; console.error(error) } finally { writeFileSync(compiledConfig, originalConfig); net.Socket.prototype.connect=originalConnect }
