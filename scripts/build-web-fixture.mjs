import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const fixture = resolve(root, 'apps/web/fixtures/public.synthetic.json')
const sha256 = createHash('sha256').update(readFileSync(fixture)).digest('hex')

const child = spawnSync('npm', ['run', 'build', '-w', '@icaros/web'], {
  cwd: root,
  env: {
    ...process.env,
    ICAROS_SNAPSHOT: fixture,
    ICAROS_SNAPSHOT_SHA256: sha256,
  },
  stdio: 'inherit',
})

if (child.error) throw child.error
process.exit(child.status ?? 1)
