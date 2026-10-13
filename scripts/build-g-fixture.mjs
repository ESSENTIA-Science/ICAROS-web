import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertSource } from '../infra/g/verify-source.mjs'

const root = resolve(import.meta.dirname, '..')
const fixture = resolve(root, 'apps/web/fixtures/public.synthetic.json')
const sha256 = createHash('sha256').update(readFileSync(fixture)).digest('hex')
const revision = process.env.ICAROS_SOURCE_REVISION ?? process.env.GITHUB_SHA
if (revision) assertSource(revision)
const child = spawnSync(process.execPath, [resolve(root, 'node_modules/@opennextjs/aws/dist/index.js'), 'build'], {
  cwd: resolve(root, 'apps/web'),
  env: { ...process.env, ICAROS_SNAPSHOT: fixture, ICAROS_SNAPSHOT_SHA256: sha256 },
  stdio: 'inherit',
})
if (child.error) throw child.error
if (child.status !== 0) process.exit(child.status ?? 1)
if (revision) assertSource(revision)
