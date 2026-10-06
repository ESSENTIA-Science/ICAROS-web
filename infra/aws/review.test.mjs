import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { validateConfig, parameterSets, readiness } from './review.mjs'
import { createMediaProxy, validateMediaIndex } from './media-proxy.mjs'

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
const config = read('config.example.json')
const clone = () => structuredClone(config)
const id = '00000000-0000-0000-0000-000000000001'
const bytes = Buffer.from('synthetic media')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const index = { version: '2', media: { [id]: { key: `published/${id}/${sha256}.webp`,
  sha256, size: bytes.length, mime: 'image/webp', entityType: 'post', storage: 'public' } } }
const event = { rawPath: `/api/media/${id}`, requestContext: { http: { method: 'GET' } } }
function proxy(value = index, objectBytes = bytes) {
  return createMediaProxy({ getRelease: async () => `releases/v2-${'a'.repeat(64)}`,
    getObject: async (kind) => {
      const data = kind === 'release' ? Buffer.from(JSON.stringify(value)) : objectBytes
      return { size: data.length, mime: kind === 'release' ? 'application/json' : 'image/webp', bytes: async () => data }
    } })
}

test('example config is valid and records unresolved production blockers', () => {
  assert.equal(validateConfig(config), config)
  assert.ok(readiness(config).includes('gates.databaseTlsVerified'))
  assert.ok(readiness(config).includes('codeFixes.bucketSplit'))
  assert.equal(config.approvals.domainCutover, true)
})
test('branch heads, shared buckets, ambiguous booleans and unknown keys are rejected', () => {
  for (const mutate of [c => { c.webSourceRevision = 'main' },
    c => { c.foundation.publicMediaBucket = c.foundation.privateMediaBucket },
    c => { c.approvals.deploy = 'yes' }, c => { c.secretValue = 'synthetic-sensitive' }]) {
    const c = clone(); mutate(c); assert.throws(() => validateConfig(c))
  }
})
test('subnets must be disjoint, inside VPC, aligned and in distinct AZs', () => {
  for (const mutate of [c => { c.network.privateCidrB = c.network.privateCidrA },
    c => { c.network.publicCidr = '192.168.0.0/24' },
    c => { c.network.publicCidr = '10.200.240.1/24' },
    c => { c.network.azB = c.network.azA }]) {
    const c = clone(); mutate(c); assert.throws(() => validateConfig(c))
  }
})
test('all rendered parameters exist and safety defaults remain disabled', () => {
  const sets = parameterSets(config)
  for (const [name, parameters] of Object.entries(sets)) {
    const template = read(name === 'runtime' ? 'runtime.blocked.template.json' : `${name}.template.json`)
    for (const key of Object.keys(parameters)) assert.ok(Object.hasOwn(template.Parameters, key), key)
    for (const [key, rule] of Object.entries(template.Parameters)) {
      assert.ok(Object.hasOwn(rule, 'Default') || Object.hasOwn(parameters, key), `Missing ${name}.${key}`)
    }
  }
  assert.equal(sets.foundation.AttachDomains, 'false')
  assert.equal(sets.foundation.EnableDistributions, 'false')
  assert.equal(sets.network.ManageDbIngress, 'false')
  assert.equal(sets.runtime.EnableBuildEvents, 'false')
  assert.equal(sets.runtime.CompatibilityReviewed, 'false')
})
test('foundation embeds reviewed router and OAC never reads private media', () => {
  const r = read('foundation.template.json').Resources
  assert.equal(r.ReleaseRouter.Properties.FunctionCode, readFileSync(new URL('../cloudfront/release-router.js', import.meta.url), 'utf8'))
  assert.equal(r.PrivateMediaBucketPolicy.Properties.PolicyDocument.Statement.filter(x => x.Effect === 'Allow').length, 0)
  assert.equal(r.WebDistribution.Properties.DistributionConfig.CustomErrorResponses, undefined)
  assert.deepEqual(r.WebDistribution.Properties.DistributionConfig.CacheBehaviors.map(x => x.PathPattern), ['/admin', '/admin/*', '/api', '/api/*'])
  assert.equal(r.ReleaseBucketPolicy.Properties.PolicyDocument.Statement.filter(x => x.Sid === 'RequireConditionalCreate').length, 1)
})
test('proxy streams validated media without redirect or persistent caching', async () => {
  const result = await proxy()(event)
  assert.equal(result.statusCode, 200)
  assert.equal(Buffer.from(result.body, 'base64').toString(), bytes.toString())
  assert.equal(result.isBase64Encoded, true)
  assert.equal(result.headers['cache-control'], 'private, no-store')
  assert.equal(result.headers.location, undefined)
  const head = await proxy()({ ...event, requestContext: { http: { method: 'HEAD' } } })
  assert.equal(head.statusCode, 200); assert.equal(head.body, '')
})
test('proxy rejects public member copies, foreign keys, oversized media and version mismatch', () => {
  for (const mutate of [x => { x.media[id].entityType = 'member' },
    x => { x.media[id].key = 'private/portrait.webp' },
    x => { x.media[id].size = 4 * 1024 * 1024 }, x => { x.version = '3' }]) {
    const value = structuredClone(index); mutate(value)
    assert.throws(() => validateMediaIndex(value, '2'))
  }
})
test('proxy fails closed for corrupt media/index, missing UUID and unavailable KVS', async () => {
  assert.equal((await proxy(index, Buffer.from('wrong checksum'))(event)).statusCode, 503)
  assert.equal((await proxy({ ...index, version: '3' })(event)).statusCode, 503)
  assert.equal((await proxy()({ ...event, rawPath: '/api/media/invalid' })).statusCode, 404)
  assert.equal((await proxy({ version: '2', media: {} })(event)).statusCode, 404)
  const unavailable = createMediaProxy({ getRelease: async () => { throw Error('synthetic') }, getObject: async () => null })
  assert.equal((await unavailable(event)).statusCode, 503)
})
test('runtime isolates proxy from VPC and has separate delivery and execution DLQs', () => {
  const r = read('runtime.blocked.template.json').Resources
  assert.equal(r.MediaProxyFunction.Properties.VpcConfig, undefined)
  assert.ok(r.ApiFunction.Properties.VpcConfig)
  assert.notDeepEqual(r.BuildEvents.Properties.Targets[0].DeadLetterConfig.Arn,
    r.CallbackAsyncConfig.Properties.DestinationConfig.OnFailure.Destination)
  assert.ok(r.BuildEvents.Properties.EventPattern.detail['build-status'].includes('TIMED_OUT'))
})

test('member is read only from private published copy after active membership validation', async () => {
  const memberIndex = structuredClone(index)
  memberIndex.media[id].entityType = 'member'; memberIndex.media[id].storage = 'private'
  let allow = [id], live = true
  const calls = []
  const run = createMediaProxy({ getRelease: async () => `releases/v2-${'a'.repeat(64)}`,
    getMemberPublished: async () => live,
    getObject: async (kind, key) => {
      calls.push([kind, key])
      const data = key.endsWith('compat-media-index.json') ? Buffer.from(JSON.stringify(memberIndex)) :
        key.endsWith('published-member-media.json') ? Buffer.from(JSON.stringify({version:'2', mediaIds:allow})) : bytes
      return {size:data.length, mime:kind==='release'?'application/json':'image/webp', bytes:async()=>data}
    } })
  assert.equal((await run(event)).statusCode, 200)
  assert.ok(calls.some(([kind,key])=>kind==='private'&&key.startsWith('published/')))
  assert.ok(!calls.some(([kind])=>kind==='public'))
  allow=[]; assert.equal((await run(event)).statusCode,404)
  allow=[id]; live=false; assert.equal((await run(event)).statusCode,404)
})
test('valid large public entry does not poison image index and explicitly exceeds buffered proxy', async () => {
  const large = structuredClone(index)
  Object.assign(large.media[id], {mime:'video/mp4',size:32*1024*1024,key:`published/${id}/${sha256}.mp4`})
  assert.equal(validateMediaIndex(large,'2'),large)
  assert.equal((await proxy(large)(event)).statusCode,413)
})
test('separate CMS, retained policies, existing Cognito and least privilege proxy contracts',()=>{
  const f=read('foundation.template.json').Resources
  assert.ok(f.CmsDistribution)
  assert.ok(!JSON.stringify(f.WebDistribution.Properties.DistributionConfig.Origins).includes('CmsBucket'))
  assert.equal(f.ReleaseBucketPolicy.DeletionPolicy,'Retain')
  const r=read('runtime.blocked.template.json').Resources
  assert.ok(!Object.values(r).some(x=>x.Type.startsWith('AWS::Cognito::')))
  const policy=JSON.stringify(r.MediaProxyRole.Properties.Policies)
  assert.ok(policy.includes('${PrivateMediaBucketName}/published/*'))
  assert.ok(!policy.includes('icaros-web'))
  assert.ok(!policy.includes('s3:PutObject'))
  assert.ok(policy.includes('published-member-media.json'))
})

test('proxy mode conditions every NAT resource and limits egress to proxy, DB, S3',()=>{
 const n=read('network.template.json');assert.equal(n.Parameters.EgressMode.Default,'proxy')
 for(const k of ['NatEip','NatGateway','PrivateDefaultRoute','PublicSubnet','PublicDefaultRoute','PublicRouteTable','PublicAssociation']) assert.equal(n.Resources[k].Condition,'UseNat')
 const e=n.Resources.LambdaSecurityGroup.Properties.SecurityGroupEgress
 assert.equal(e[2]['Fn::If'][1].FromPort,3128)
 assert.deepEqual(e[2]['Fn::If'][1].CidrIp,{'Fn::Sub':'${ProxyPrivateIpv4}/32'})
 assert.ok(read('foundation.template.json').Resources.ArtifactBucket.Properties.VersioningConfiguration)
})

test('S3 nested CorsRule uses CloudFormation ExposedHeaders schema, not SDK ExposeHeaders', () => {
  const resources = read('foundation.template.json').Resources
  // AWS::S3::Bucket CorsRule official describe-type schema, checked read-only.
  const allowed = new Set(['AllowedHeaders', 'AllowedMethods', 'AllowedOrigins', 'ExposedHeaders', 'Id', 'MaxAge'])
  for (const resource of Object.values(resources)) {
    if (resource.Type !== 'AWS::S3::Bucket') continue
    for (const rule of resource.Properties.CorsConfiguration?.CorsRules ?? []) {
      for (const key of Object.keys(rule)) assert.ok(allowed.has(key), `Unknown CorsRule property: ${key}`)
      assert.deepEqual(rule.ExposedHeaders, ['ETag'])
    }
  }
})

test('API and callback use private DATABASE_URL with a separate secret TLS servername', () => {
  const r = read('runtime.blocked.template.json').Resources
  for (const name of ['ApiFunction', 'CallbackFunction']) {
    const env = r[name].Properties.Environment.Variables
    assert.deepEqual(env.DB_TLS_SERVERNAME, { 'Fn::Sub': '{{resolve:secretsmanager:${DatabaseSecretArn}:SecretString:DB_TLS_SERVERNAME}}' })
    assert.deepEqual(env.DATABASE_URL, { 'Fn::Sub': '{{resolve:secretsmanager:${DatabaseSecretArn}:SecretString:DATABASE_URL}}' })
    assert.equal(env.DB_CA_BUNDLE_PATH, '/var/task/certs/rds.pem')
    assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, undefined)
    assert.equal(env.PGSSLMODE, undefined)
  }
})
