import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'

const script = `
import { mock } from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
const require = createRequire(process.cwd() + '/infra/aws/media-proxy.mjs');
const { S3Client } = await import(require.resolve('@aws-sdk/client-s3'));
const { LambdaClient } = await import(require.resolve('@aws-sdk/client-lambda'));
mock.method(Socket.prototype, 'connect', () => { throw new Error('Unexpected fixture network access'); });
const input = JSON.parse(process.argv[1]);
const id = 'a1111111-1111-4111-8111-111111111111';
const bytes = Buffer.from('fixture portrait');
const sha = createHash('sha256').update(bytes).digest('hex');
const snapshot = Buffer.from(JSON.stringify({ version: '1', members: [{ published: true, imageSrc: '/api/media/' + id }],
  compatMediaIndex: { version: '1', media: { [id]: { key: 'published/' + id + '/' + sha + '.webp',
    sha256: sha, mime: 'image/webp', size: bytes.length, entityType: 'member', storage: 'private' } } } }));
const snapshotSha = createHash('sha256').update(snapshot).digest('hex');
const pointer = Buffer.from(JSON.stringify({ version: 1, key: 'snapshots/v1/' + snapshotSha + '.json', sha256: snapshotSha }));
let live = true, invokes = 0, reads = [];
mock.method(S3Client.prototype, 'send', async command => {
  reads.push(command.input.Bucket);
  const body = command.input.Key === 'control/g-pointer.json' ? pointer : command.input.Key.startsWith('snapshots/') ? snapshot : bytes;
  return { ContentLength: body.length, ContentType: command.input.Key.startsWith('published/') ? 'image/webp' : 'application/json',
    Body: { transformToByteArray: async () => body } };
});
mock.method(LambdaClient.prototype, 'send', async command => {
  if (command.input.FunctionName !== 'fixture-api:live' || command.input.InvocationType !== 'RequestResponse') throw new Error('Wrong authority target');
  const payload = JSON.parse(Buffer.from(command.input.Payload).toString());
  if (payload.kind !== 'icaros.media.authorize' || payload.mediaId !== id || payload.sha256 !== sha || payload.member !== true) throw new Error('Wrong authority envelope');
  invokes++;
  return { StatusCode: 200, ...(input.failure ? { FunctionError: 'Unhandled' } : {}),
    Payload: Buffer.from(JSON.stringify({ authorized: live })) };
});
console.info = () => {};
const { handler } = await import('./infra/aws/media-proxy.mjs');
const first = await handler({ rawPath: '/api/media/' + id, requestContext: { http: { method: 'GET' } } });
live = false;
const second = await handler({ rawPath: '/api/media/' + id, requestContext: { http: { method: 'HEAD' } } });
process.stdout.write(JSON.stringify({ status: [first.statusCode, second.statusCode], invokes, reads,
  cache: [first.headers['cache-control'], second.headers['cache-control']] }));
`
function run(input = {}) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], {
    cwd: new URL('../../..', import.meta.url).pathname,
    env: { PATH: process.env.PATH ?? '', AWS_REGION: 'us-east-1', ICAROS_PUBLICATION_MODE: 'g',
      AWS_ACCESS_KEY_ID: 'fixture-only-access', AWS_SECRET_ACCESS_KEY: 'fixture-only-secret', AWS_EC2_METADATA_DISABLED: 'true',
      SNAPSHOT_BUCKET: 'fixture-snapshots', PRIVATE_MEDIA_BUCKET: 'fixture-private', PUBLIC_MEDIA_BUCKET: 'fixture-public',
      REQUIRE_CURRENT_MEMBER_STATE: 'false', ...(input.missing ? {} : { MEMBER_AUTHORITY_FUNCTION: 'fixture-api:live' }) },
    timeout: 10_000, encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('production proxy always queries current authority and denies warm rollback-era GET/HEAD', () => {
  const result = run()
  assert.deepEqual(result.status, [200, 404], JSON.stringify(result))
  assert.equal(result.invokes, 2)
  assert.deepEqual(result.reads, ['fixture-snapshots', 'fixture-snapshots', 'fixture-private', 'fixture-snapshots', 'fixture-snapshots'])
  assert.deepEqual(result.cache, ['private, no-store', 'private, no-store'])
})

test('production proxy cannot disable authority using the old opt-in env or failed Lambda', () => {
  const absent = run({ missing: true })
  assert.deepEqual(absent.status, [503, 503]); assert.equal(absent.invokes, 0); assert.deepEqual(absent.reads, [])
  const failed = run({ failure: true })
  assert.deepEqual(failed.status, [503, 503]); assert.equal(failed.invokes, 2)
  assert.ok(!failed.reads.includes('fixture-private'))
})
