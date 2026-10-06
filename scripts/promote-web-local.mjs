import { cpSync, mkdirSync, renameSync, symlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const releases = resolve(root, 'docs/.local/web-releases')
const current = resolve(root, 'docs/.local/web-current')
const release = resolve(releases, randomUUID())
mkdirSync(releases, { recursive: true, mode: 0o700 })
cpSync(resolve(root, 'apps/web/out'), release, { recursive: true })
const next = `${current}.next-${randomUUID()}`
symlinkSync(release, next)
renameSync(next, current)
console.log('Local public release promoted.')
