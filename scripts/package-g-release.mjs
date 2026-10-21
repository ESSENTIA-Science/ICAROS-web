import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertSource, verifySource } from '../infra/g/verify-source.mjs'
import { loadAndValidateSnapshot } from '../apps/web/scripts/snapshot-contract.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})
const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}

export function readTree(directory, prefix = '') {
  const files = new Map()
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name)
    const key = prefix + name
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Symlink in artifact: ${key}`)
    if (stat.isDirectory()) for (const entry of readTree(path, key + '/')) files.set(...entry)
    else if (stat.isFile()) files.set(key, readFileSync(path))
    else throw new Error(`Unsupported artifact file: ${key}`)
  }
  return files
}

// ZIP32 with fixed timestamps and permissions; identical inputs produce identical bytes.
export function zipFiles(files) {
  if (!files.size || files.size >= 65535) throw new Error('Invalid ZIP file count')
  const local = [], central = []
  let offset = 0, total = 0
  for (const [name, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe ZIP path')
    const filename = Buffer.from(name)
    const compressed = deflateRawSync(bytes, { level: 9 })
    total += bytes.length
    if (total > 250 * 1024 * 1024 || filename.length > 65535) throw new Error('Lambda artifact exceeds ZIP limits')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12)
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26)
    local.push(header, filename, compressed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(0x0314, 4); entry.writeUInt16LE(20, 6)
    header.copy(entry, 8, 6, 28)
    entry.writeUInt32LE((0o100644 * 65536) >>> 0, 38); entry.writeUInt32LE(offset, 42)
    central.push(entry, filename)
    offset += header.length + filename.length + compressed.length
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, centralBytes, end])
}

export function treeManifest(files, revision) {
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes), sourceRevision: revision }))
  return { sourceRevision: revision, sha256: sha256(JSON.stringify(entries)), files: entries }
}

export async function packageGenerated({ sourceRoot = root, output, revision, snapshotSha256, buildId }) {
  const generated = resolve(sourceRoot, 'apps/web/.open-next')
  const server = readTree(resolve(generated, 'server-functions/default'))
  if (!server.has('index.mjs') || server.has('open-next-entry.mjs') || server.has('visible-posts.mjs') || [...server.keys()].some(name => name.includes('.test.'))) throw new Error('OpenNext server entry conflict or fixture residue')
  server.set('open-next-entry.mjs', server.get('index.mjs'))
  const { build } = await import('esbuild')
  const bundle = async (entry, external) => {
    const result = await build({ entryPoints: [resolve(sourceRoot, entry)], absWorkingDir: sourceRoot, bundle: true,
      platform: 'node', target: 'node22', format: 'esm', write: false, external,
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } })
    return Buffer.from(result.outputFiles[0].contents)
  }
  server.set('index.mjs', await bundle('infra/g/server-wrapper.mjs', ['./open-next-entry.mjs', './visible-posts.mjs']))
  server.set('visible-posts.mjs', readFileSync(resolve(sourceRoot, 'infra/g/visible-posts.mjs')))
  const revalidation = readTree(resolve(generated, 'revalidation-function'))
  for (const name of ['index.mjs', 'open-next.config.mjs', 'prerender-manifest.json']) if (!revalidation.has(name)) throw new Error(`Missing revalidation artifact: ${name}`)
  revalidation.set('index.mjs', await bundle('infra/g/revalidation-wrapper.mjs', ['./prerender-manifest.json']))
  const assets = readTree(resolve(generated, 'assets'))
  if (assets.get('BUILD_ID')?.toString().trim() !== buildId || ![...assets.keys()].some(name => name.startsWith('_next/'))) throw new Error('OpenNext assets/build ID mismatch')
  const cms = readTree(resolve(sourceRoot, 'apps/cms/dist'))
  if (!cms.has('index.html')) throw new Error('Missing CMS index.html')
  const cache = readTree(resolve(generated, 'cache'))
  const manifest = { schemaVersion: 1, kind: 'icaros.g.release', sourceRevision: revision, snapshotSha256, buildId,
    runtime: 'nodejs22.x', architecture: 'arm64', nodeVersion: process.version, lockfileSha256: sha256(readFileSync(resolve(sourceRoot, 'package-lock.json'))),
    bundledLambdaVersion: JSON.parse(readFileSync(resolve(sourceRoot, 'node_modules/@aws-sdk/client-lambda/package.json'), 'utf8')).version,
    bundledS3Version: JSON.parse(readFileSync(resolve(sourceRoot, 'node_modules/@aws-sdk/client-s3/package.json'), 'utf8')).version, artifacts: {} }
  for (const [name, files] of [['server', server], ['revalidation', revalidation]]) {
    const bytes = zipFiles(files)
    writeFileSync(resolve(output, name + '.zip'), bytes)
    manifest.artifacts[name] = { ...treeManifest(files, revision), path: name + '.zip', archiveSha256: sha256(bytes), archiveBytes: bytes.length }
  }
  for (const [name, files, from] of [['assets', assets, resolve(generated, 'assets')], ['cache', cache, resolve(generated, 'cache')], ['cms', cms, resolve(sourceRoot, 'apps/cms/dist')]]) {
    cpSync(from, resolve(output, name), { recursive: true })
    manifest.artifacts[name] = { ...treeManifest(files, revision), path: name }
  }
  writeFileSync(resolve(output, 'BUILD_ID'), buildId + '\n')
  manifest.artifacts.buildId = { path: 'BUILD_ID', sourceRevision: revision, sha256: sha256(buildId + '\n') }
  writeFileSync(resolve(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

function run(command, args, env, cwd = root) {
  const child = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`${command} failed (${child.status})`)
}

export async function packageGRelease({ revision, snapshot, snapshotSha256, output }, hooks = {}) {
  const gate = hooks.verifySource ?? verifySource
  const clean = hooks.assertSource ?? assertSource
  clean(revision)
  if ((hooks.nodeVersion ?? process.versions.node).split('.')[0] !== '22') throw new Error('Release packaging requires Node 22')
  if (!snapshot || !output || !/^[a-f0-9]{64}$/.test(snapshotSha256 ?? '')) throw new Error('Explicit snapshot, SHA-256 and output required')
  const destination = resolve(output)
  const outputRelative = relative(root, destination)
  if (!outputRelative || (!outputRelative.startsWith('..' + sep) && !isAbsolute(outputRelative))) throw new Error('Release output must be outside the source checkout')
  if (existsSync(destination)) throw new Error('Release output already exists')
  const bytes = readFileSync(resolve(snapshot))
  if (sha256(bytes) !== snapshotSha256) throw new Error('Snapshot SHA-256 mismatch')
  const fixture = readFileSync(resolve(root, 'apps/web/fixtures/public.synthetic.json'))
  if (sha256(bytes) === sha256(fixture) || resolve(snapshot) === resolve(root, 'apps/web/fixtures/public.synthetic.json')) throw new Error('Synthetic snapshot cannot be packaged for production')
  loadAndValidateSnapshot(resolve(snapshot), snapshotSha256, resolve(root, 'apps/web/public'))
  run('npm', ['ci', '--ignore-scripts'])
  clean(revision)
  gate(revision)
  mkdirSync(dirname(destination), { recursive: true })
  const staging = mkdtempSync(resolve(dirname(destination), '.g-package-'))
  try {
    const selected = resolve(staging, '.snapshot.json')
    writeFileSync(selected, bytes, { mode: 0o600 })
    const buildId = sha256(revision + ':' + snapshotSha256)
    // Fixture verification mutates generated output, so production always rebuilds from zero.
    for (const directory of ['apps/web/.next', 'apps/web/.open-next', 'apps/cms/dist']) rmSync(resolve(root, directory), { recursive: true, force: true })
    const env = { ...process.env, ICAROS_SOURCE_REVISION: revision, ICAROS_SNAPSHOT: selected, ICAROS_SNAPSHOT_SHA256: snapshotSha256, ICAROS_BUILD_ID: buildId }
    delete env.ICAROS_RUNTIME_POINTER
    run(process.execPath, [resolve(root, 'node_modules/@opennextjs/aws/dist/index.js'), 'build'], env, resolve(root, 'apps/web'))
    run('npm', ['run', 'build', '--workspace', '@icaros/cms'], env)
    clean(revision)
    const manifest = await packageGenerated({ output: staging, revision, snapshotSha256, buildId })
    rmSync(selected)
    clean(revision)
    renameSync(staging, destination)
    return manifest
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [revision, snapshot, snapshotSha256, output] = process.argv.slice(2)
  await packageGRelease({ revision, snapshot, snapshotSha256, output })
  console.log('G release artifacts verified and packaged')
}
