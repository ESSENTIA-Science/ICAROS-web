/**
 * 레거시 게시글 19건을 **우리 DB** 로 이관한다.
 *
 *   npm run migrate:legacy-posts -- --dry
 *   npm run migrate:legacy-posts
 *
 * 전제: `npm run migrate:archive-images` 가 먼저 돌아 `docs/legacy-dump/image-manifest.json`
 * 이 있어야 한다. 이 스크립트는 **보존된 원본에서** 화면용 사본을 만든다 —
 * Supabase 를 다시 부르지 않는다. 원본이 이미 우리 것이므로 그럴 이유가 없다.
 *
 * 하는 일 네 가지:
 *   1. 원본 → 화면용 WebP(긴 변 1600px · 2MB 이하)로 굽고 `{prefix}/media/` 에 올린다
 *   2. `icaros.media` 행 생성 (`entity_type='post'`, `status='ready'`)
 *   3. 본문의 레거시 URL 을 `/api/media/{id}` 로 치환
 *   4. `icaros.legacy_posts` 에 글 저장
 *
 * ## 치환 실패를 조용히 넘기지 않는다
 *
 * 매핑에 없는 URL 이 본문에 하나라도 남으면 **그 글을 저장하지 않고 전체를 중단**한다.
 * 조용히 지나가면 게시판에 깨진 이미지가 남고, 그건 원본이 사라진 뒤에야 발견된다.
 * DB 의 `legacy_posts_no_legacy_url_ck` 가 마지막 방어선이지만 여기서 먼저 잡는 편이 낫다.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'

import { describeTarget, loadEnvLocal, pgConfig } from '../lib/db-config'

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

const MANIFEST = 'docs/legacy-dump/image-manifest.json'
if (!existsSync(MANIFEST)) fail(`${MANIFEST} 이 없습니다. 먼저 npm run migrate:archive-images 를 실행하세요.`)

type ManifestRow = { legacyId: string; index: number; legacyUrl: string; key: string; md5: string }
const manifest = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { rows: ManifestRow[] }).rows

type Post = { legacyId: string; title: string; content: string; createdAt: string }
const payload = JSON.parse(readFileSync('docs/legacy-dump/posts-payload.json', 'utf8')) as {
  included: Post[]
}

/**
 * 슬러그. 한글 제목이 대부분이라 음차하지 않는다 — 음차 규칙은 어차피 임의이고,
 * 원본과 대조할 수 없는 문자열이 URL 에 남는다.
 * 날짜 + 레거시 id 앞자리로 **짧고 안정적이고 추적 가능한** 값을 만든다.
 */
function slugFor(post: Post): string {
  const d = new Date(post.createdAt)
  const ymd = Number.isNaN(d.getTime()) ? 'undated' : d.toISOString().slice(0, 10)
  return `${ymd}-${post.legacyId.slice(0, 8)}`
}

const IMG_RE = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)|<img[^>]+src=["']([^"']+)["']/g

function urlsIn(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(IMG_RE)) {
    const u = m[1] ?? m[2]
    if (u) out.push(u)
  }
  return out
}

const tmp = '.legacy-import-tmp'
mkdirSync(tmp, { recursive: true })

/** 원본을 받아 화면용 WebP 로 굽는다. 정책은 `UPLOAD_POLICIES.hero` 와 같은 값이다. */
function toWebp(srcPath: string, outPath: string): void {
  const resized = `${outPath}.resized`
  execFileSync('sips', ['-Z', '1600', srcPath, '--out', resized], { stdio: 'pipe' })
  execFileSync('cwebp', ['-quiet', '-q', '84', '-metadata', 'none', resized, '-o', outPath], { stdio: 'pipe' })
}

function webpSize(buf: Buffer): { width: number; height: number } {
  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') {
    return { width: (buf.readUIntLE(24, 3) & 0xffffff) + 1, height: (buf.readUIntLE(27, 3) & 0xffffff) + 1 }
  }
  if (fourcc === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  if (fourcc === 'VP8L') {
    const b = buf.readUInt32LE(21)
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
  }
  fail(`알 수 없는 WebP 형태: ${fourcc}`)
}

console.log(`\n  대상 DB    ${describeTarget()}`)
console.log(`  버킷       ${bucket}${endpoint ? ` @ ${endpoint}` : ''}`)
console.log(`  글 ${payload.included.length}건 · 이미지 ${manifest.length}장\n`)

// 치환 가능성을 **먼저 전수 검사**한다. 한 장이라도 매핑에 없으면 아무것도 하지 않는다.
const known = new Set(manifest.map((r) => r.legacyUrl))
const missing: { title: string; url: string }[] = []
for (const post of payload.included) {
  for (const u of urlsIn(post.content)) {
    if (!known.has(u)) missing.push({ title: post.title, url: u })
  }
}
if (missing.length > 0) {
  console.error('  매핑에 없는 이미지 URL 이 있습니다 — 중단합니다:')
  for (const m of missing.slice(0, 10)) console.error(`    ${m.title} :: ${m.url.slice(0, 80)}`)
  fail(`총 ${missing.length}건.`)
}
console.log(`  치환 사전 검사 통과 — 본문의 모든 이미지가 매니페스트에 있습니다.\n`)

if (dry) {
  for (const post of payload.included.slice(0, 5)) {
    console.log(`    ${slugFor(post).padEnd(20)} ${post.title.slice(0, 34)}`)
  }
  if (payload.included.length > 5) console.log(`    … 외 ${payload.included.length - 5}건`)
  console.log('\n  --dry 이므로 아무것도 하지 않았습니다.\n')
  process.exit(0)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await rl.question("\n이 DB 와 버킷에 이관합니다. 계속하려면 'yes' 를 입력하십시오: ")
rl.close()
if (answer.trim() !== 'yes') {
  console.log('취소했습니다.\n')
  process.exit(0)
}

const { Pool } = await import('pg')
const pool = new Pool(pgConfig('app'))

/** 레거시 URL → 새 media id. 이미지 한 장은 한 번만 굽고 올린다. */
const urlToMediaId = new Map<string, string>()

try {
  // ── 1·2. 화면용 사본 생성 + media 등록 ──────────────────────────
  for (const row of manifest) {
    const origin = join(tmp, `${row.md5}.orig`)
    execFileSync(
      'aws',
      [
        ...(endpoint ? ['--endpoint-url', endpoint] : []),
        's3api', 'get-object', '--bucket', bucket, '--key', row.key, origin,
      ],
      { stdio: 'pipe' }
    )

    const webp = join(tmp, `${row.md5}.webp`)
    toWebp(origin, webp)
    const buf = readFileSync(webp)
    if (buf.length > 2 * 1024 * 1024) fail(`${row.key} 사본이 2MB 를 넘습니다: ${buf.length}`)
    const { width, height } = webpSize(buf)

    const mediaId = randomUUID()
    const key = `${prefix}/media/${randomUUID()}.webp`
    execFileSync(
      'aws',
      [
        ...(endpoint ? ['--endpoint-url', endpoint] : []),
        's3api', 'put-object', '--bucket', bucket, '--key', key, '--body', webp,
        '--content-type', 'image/webp', '--if-none-match', '*',
      ],
      { stdio: 'pipe' }
    )

    await pool.query(
      `insert into icaros.media (id, bucket, key, original_filename, mime, size, etag, width, height, status, entity_type, entity_id)
       values ($1,$2,$3,$4,'image/webp',$5,$6,$7,$8,'ready','post',$9)`,
      [
        mediaId, bucket, key,
        `${row.legacyId}-${String(row.index + 1).padStart(2, '0')}.webp`,
        buf.length, createHash('md5').update(buf).digest('hex'), width, height, row.legacyId,
      ]
    )
    urlToMediaId.set(row.legacyUrl, mediaId)
    process.stdout.write('.')
  }
  console.log('')

  // ── 3·4. 본문 치환 + 글 저장 ────────────────────────────────────
  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const post of payload.included) {
      let md = post.content
      for (const [legacyUrl, mediaId] of urlToMediaId) {
        md = md.split(legacyUrl).join(`/api/media/${mediaId}`)
      }
      // 사전 검사를 통과했어도 한 번 더 본다 — 치환 로직 자체가 틀릴 수 있다.
      if (md.includes('supabase.co')) fail(`치환 누락: ${post.title}`)

      const first = urlsIn(post.content)[0]
      const cover = first ? (urlToMediaId.get(first) ?? null) : null

      await client.query(
        `insert into icaros.legacy_posts (id, slug, title, content_md, published_at, cover_media_id)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (id) do update set
           slug = excluded.slug, title = excluded.title, content_md = excluded.content_md,
           published_at = excluded.published_at, cover_media_id = excluded.cover_media_id,
           updated_at = now()`,
        [post.legacyId, slugFor(post), post.title, md, post.createdAt, cover]
      )
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }

  const n = await pool.query<{ n: string }>('select count(*)::text n from icaros.legacy_posts')
  console.log(`\n  완료 — legacy_posts ${n.rows[0]?.n} 건 · media(post) ${urlToMediaId.size} 행\n`)
} finally {
  await pool.end()
}
