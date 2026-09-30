import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const code = `import { handler } from './src/handler.ts';
const result = await handler({ rawPath:'/api/admin/session', requestContext:{http:{method:'GET'}}, headers:{} });
process.stdout.write(String(result.statusCode));`
function status(databaseUrl: string, endpoint?: string) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, API_LOCAL: '1', ICAROS_LOCAL_DATABASE_URL: databaseUrl,
      ADMIN_ALLOWED_ORIGINS: 'http://127.0.0.1:5175', ...(endpoint ? { S3_ENDPOINT: endpoint } : {}) },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return Number(result.stdout)
}
test('loopback local handler returns 403 for an unauthenticated request', () => {
  assert.equal(status('postgres://local:local@127.0.0.1:5435/icaros'), 403)
})
test('local mode refuses nonlocal DB, wrong port and remote S3 endpoint', () => {
  assert.equal(status('postgres://local:local@example.invalid:5435/icaros'), 503)
  assert.equal(status('postgres://local:local@127.0.0.1:5432/icaros'), 503)
  assert.equal(status('postgres://local:local@127.0.0.1:5435/icaros', 'https://example.invalid'), 503)
})
