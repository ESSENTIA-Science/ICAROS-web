import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))

const execute = (file, args) => execFileSync(file, args, {
  cwd: sourceRoot, encoding: 'utf8', stdio: file === 'git' ? 'pipe' : 'inherit',
})

export function assertSource(revision, run = execute) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid source revision')
  const head = run('git', ['rev-parse', 'HEAD']).trim().toLowerCase()
  if (head !== revision) throw new Error('Checked-out source differs from approved revision')
  run('git', ['diff', '--quiet', 'HEAD', '--'])
  if (run('git', ['ls-files', '--others', '--exclude-standard']).trim()) throw new Error('Untracked source blocks release verification')
  return revision
}

export function verifySource(revision, run = execute) {
  assertSource(revision, run)
  for (const check of ['typecheck', 'lint', 'test']) run('npm', ['run', check])
  run('npm', ['audit', '--omit=dev', '--audit-level=moderate'])
  run('npm', ['run', 'test:infra'])
  run('npm', ['run', 'build:web:fixture'])
  run('npm', ['run', 'build', '--workspace', '@icaros/cms'])
  run('npm', ['run', 'test:browser'])
  run('npm', ['run', 'build:g:fixture'])
  run('npm', ['run', 'test:g:runtime'])
  return assertSource(revision, run)
}
