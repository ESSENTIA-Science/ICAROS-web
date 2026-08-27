/**
 * 레거시 게시글 이미지 **원본 보존**.
 *
 *   npm run migrate:archive-images -- --dry
 *   npm run migrate:archive-images
 *
 * Supabase 에서 원본을 그대로 받아 `{prefix}/legacy-posts/` 에 올리고 매니페스트를 남긴다.
 *
 * ## 왜 가공하지 않는가
 *
 * 정책(1600px · WebP · 2MB)은 **화면에 나가는 사본**에 적용하는 규칙이지 보존본에 적용할
 * 규칙이 아니다. 48장 중 21장이 2MB 를 넘는데, 그건 원본이 커서지 잘못된 게 아니다.
 * 원본을 줄여 두면 나중에 더 큰 화면·더 나은 인코더가 나와도 되돌릴 수 없다.
 *
 * ## 왜 `media` 에 넣지 않는가
 *
 * 이건 아카이브다. `media` 에 넣으면 `/api/media/[id]` 로 **서빙 가능해지고**, 그 순간
 * "아무도 안 쓰는데 공개된 것"이 생긴다. 화면에 나가는 사본은 별도 단계에서 따로 만든다.
 *
 * ## 되돌리기
 *
 * 버킷은 Versioning 이 켜져 있다. 잘못 올려도 삭제·복구가 된다.
 * `--if-none-match '*'` 로 기존 키를 절대 덮지 않는다.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'

import { loadEnvLocal } from '../lib/db-config'

loadEnvLocal()

const dry = process.argv.includes('--dry')

const bucket = process.env.S3_BUCKET?.trim()
const prefix = (process.env.S3_PREFIX?.trim() || 'icaros-web').replace(/^\/+|\/+$/g, '')
const endpoint = process.env.S3_ENDPOINT?.trim() || undefined
if (!bucket) fail('S3_BUCKET 이 설정되지 않았습니다.')

function fail(msg: string): never {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

type Post = {
  legacyId: string
  title: string
  content: string
  createdAt: string
  imageUrls?: string[]
}

const payload = JSON.parse(readFileSync('docs/legacy-dump/posts-payload.json', 'utf8')) as {
  included: Post[]
  skipped: unknown[]
}

/**
 * 키를 원본 파일명으로 짓지 않는다. 레거시 파일명은 한글·공백·중복이 섞여 있고,
 * 무엇보다 **어느 글의 몇 번째 이미지인지**가 키에서 보여야 나중에 대조가 된다.
 */
function keyFor(post: Post, index: number, url: string): string {
  const ext = (url.split('?')[0] ?? '').split('.').pop()?.toLowerCase() ?? 'bin'
  const safeExt = /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'bin'
  return `${prefix}/legacy-posts/${post.legacyId}/${String(index + 1).padStart(2, '0')}.${safeExt}`
}

type Item = { post: Post; index: number; url: string; key: string }

const items: Item[] = []
for (const post of payload.included) {
  for (const [i, url] of (post.imageUrls ?? []).entries()) {
    items.push({ post, index: i, url, key: keyFor(post, i, url) })
  }
}

console.log(`\n  버킷       ${bucket}${endpoint ? ` @ ${endpoint}` : ''}`)
console.log(`  키 프리픽스 ${prefix}/legacy-posts/`)
console.log(`  글 ${payload.included.length}건 · 이미지 ${items.length}장 (원본 그대로)\n`)

if (items.length === 0) fail('올릴 이미지가 없습니다.')

if (dry) {
  for (const it of items.slice(0, 5)) console.log(`    ${it.key}`)
  if (items.length > 5) console.log(`    … 외 ${items.length - 5}장`)
  console.log('\n  --dry 이므로 아무것도 하지 않았습니다.\n')
  process.exit(0)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await rl.question("\n이 버킷에 원본을 보존합니다. 계속하려면 'yes' 를 입력하십시오: ")
rl.close()
if (answer.trim() !== 'yes') {
  console.log('취소했습니다.\n')
  process.exit(0)
}

const tmp = '.legacy-archive-tmp'
mkdirSync(tmp, { recursive: true })

type ManifestRow = {
  legacyId: string
  title: string
  index: number
  legacyUrl: string
  key: string
  bytes: number
  md5: string
  contentType: string
}

const manifest: ManifestRow[] = []
let failed = 0

for (const it of items) {
  try {
    const res = await fetch(it.url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const md5 = createHash('md5').update(buf).digest('hex')
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'

    const local = join(tmp, md5)
    writeFileSync(local, buf)

    execFileSync(
      'aws',
      [
        ...(endpoint ? ['--endpoint-url', endpoint] : []),
        's3api', 'put-object',
        '--bucket', bucket,
        '--key', it.key,
        '--body', local,
        '--content-type', contentType,
        // 기존 키를 절대 덮지 않는다.
        '--if-none-match', '*',
      ],
      { stdio: 'pipe' }
    )

    manifest.push({
      legacyId: it.post.legacyId,
      title: it.post.title,
      index: it.index,
      legacyUrl: it.url,
      key: it.key,
      bytes: buf.length,
      md5,
      contentType,
    })
    process.stdout.write('.')
  } catch (err) {
    failed++
    console.error(`\n  실패 ${it.key}: ${(err as Error).message}`)
  }
}

console.log('')

/**
 * 매니페스트는 **버킷에도 올린다.** 로컬 파일만 두면 이 작업을 한 사람의 노트북에만
 * 남고, 원본과 사본을 잇는 유일한 표가 그렇게 사라진다.
 */
const manifestPath = join(tmp, 'manifest.json')
writeFileSync(manifestPath, JSON.stringify({ generatedFrom: 'posts-payload.json', rows: manifest }, null, 2))
execFileSync(
  'aws',
  [
    ...(endpoint ? ['--endpoint-url', endpoint] : []),
    's3api', 'put-object',
    '--bucket', bucket,
    '--key', `${prefix}/legacy-posts/manifest.json`,
    '--body', manifestPath,
    '--content-type', 'application/json',
  ],
  { stdio: 'pipe' }
)

// 추적되는 사본도 남긴다 — 다음 단계(URL 치환)가 이 표를 읽는다.
mkdirSync('docs/legacy-dump', { recursive: true })
writeFileSync(
  'docs/legacy-dump/image-manifest.json',
  JSON.stringify({ generatedFrom: 'posts-payload.json', rows: manifest }, null, 2) + '\n'
)

const totalMb = Math.round((manifest.reduce((n, r) => n + r.bytes, 0) / 1024 / 1024) * 10) / 10
console.log(`\n  보존 ${manifest.length}장 · ${totalMb} MB · 실패 ${failed}건`)
console.log(`  매니페스트: ${prefix}/legacy-posts/manifest.json · docs/legacy-dump/image-manifest.json\n`)
if (failed > 0) process.exit(1)
