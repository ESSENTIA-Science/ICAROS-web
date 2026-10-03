import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { prepareReleaseExport, exportContentType } from './export.mjs'
import { uploadSharedAssets } from './upload-assets.mjs'

const required = (key) => {
  const value = process.env[key]
  if (!value) throw new Error(`Missing ${key}`)
  return value
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const safePath = (value) => value.length > 0 && !value.startsWith('/') &&
  !value.split('/').some((part) => !part || part === '.' || part === '..') &&
  /^[a-zA-Z0-9/_.,-]+$/.test(value)
const run = (file, args, options = {}) => execFileSync(file, args, { stdio: 'inherit', ...options })
const snapshot = required('ICAROS_SNAPSHOT')
const snapshotHash = required('ICAROS_SNAPSHOT_SHA256')
const stagingPrefix = required('ICAROS_STAGING_PREFIX')
const bucket = required('ICAROS_RELEASE_BUCKET')
const revision = required('CODEBUILD_RESOLVED_SOURCE_VERSION').toLowerCase()
const version = Number(required('ICAROS_VERSION'))
const attempt = Number(required('ICAROS_ATTEMPT'))
const jobId = required('ICAROS_JOB_ID')
const buildId = required('CODEBUILD_BUILD_ID')
if (!/^s3:\/\/[^/]+\/.+\/[a-f0-9]{64}\.json$/.test(snapshot) ||
  !snapshot.endsWith(`/${snapshotHash}.json`) || !/^[a-f0-9]{64}$/.test(snapshotHash) ||
  !safePath(stagingPrefix) || !/^[a-fA-F0-9]{40}$/.test(revision) ||
  !Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(attempt) || attempt < 1 ||
  !/^[a-zA-Z0-9_-]+$/.test(jobId) || !/^[a-zA-Z0-9:._-]+$/.test(buildId) ||
  !/^[a-zA-Z0-9.-]+$/.test(bucket)) {
  throw new Error('Invalid immutable build inputs')
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase()
if (head !== revision) throw new Error('Checked-out source differs from approved revision')
const temp = mkdtempSync(join(tmpdir(), 'icaros-release-'))
const snapshotFile = join(temp, 'snapshot.json')
run('aws', ['s3', 'cp', snapshot, snapshotFile, '--only-show-errors'])
if (hash(readFileSync(snapshotFile)) !== snapshotHash) throw new Error('Snapshot SHA-256 mismatch')
run('npm', ['run', 'build', '--workspace', '@icaros/web'], {
  env: { ...process.env, ICAROS_SNAPSHOT: snapshotFile, ICAROS_SNAPSHOT_SHA256: snapshotHash },
})
const output = resolve('apps/web/out')
const data = JSON.parse(readFileSync(snapshotFile, 'utf8'))
if (data.version !== String(version)) throw new Error('Snapshot publication version mismatch')
const prepared = prepareReleaseExport(output, data)
const files = prepared.files
// Old tabs retain these keys through both forward promotion and rollback.
// AWS template grants create-only shared asset writes; no API promotion changes.
uploadSharedAssets({ root: output, bucket,
  assets: prepared.assets.map(asset => ({ ...asset, contentType: exportContentType(asset.path) })),
  aws: args => spawnSync('aws', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }),
})
// Never publish a manifest for an incomplete upload. Each attempt has a unique prefix.
for (const file of files) {
  run('aws', ['s3', 'cp', join(output, file.path), `s3://${bucket}/${stagingPrefix}/${file.path}`,
    '--only-show-errors', '--no-guess-mime-type', '--content-type',
    exportContentType(file.path)])
}
const manifest = { jobId, buildId, attempt, version, snapshotSha256: snapshotHash,
  sourceRevision: revision, stagingPrefix, assetHash: prepared.assetHash, files }
const manifestFile = join(temp, 'manifest.json')
writeFileSync(manifestFile, `${JSON.stringify(manifest)}\n`)
run('aws', ['s3', 'cp', manifestFile, `s3://${bucket}/${stagingPrefix}/manifest.json`,
  '--only-show-errors', '--content-type', 'application/json; charset=utf-8'])
console.log(`Staged ${files.length} files; manifest SHA-256 ${hash(readFileSync(manifestFile))}`)
