/**
 * 레거시 Supabase posts → ESSENTIA Community(ICAROS) 이관 페이로드 생성.
 *
 *   npm run migrate:posts            # 페이로드만 생성 (기본, 쓰기 없음)
 *   npm run migrate:posts -- --check # 중복 대조만 출력
 *
 * **이 스크립트는 ESSENTIA 에 쓰지 않는다.** 쓰기는 D1 서비스 토큰이 필요하고
 * 아직 없다. 여기서는 검증된 페이로드까지만 만들고, 토큰이 붙으면 그걸 그대로 POST 한다.
 *
 * Supabase 는 **읽기만** 한다 (anon key, GET).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { existsSync, readFileSync } from 'node:fs'

function loadEnvLocal(): void {
  if (!existsSync('.env.local')) return
  for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    if (process.env[k] === undefined) process.env[k] = line.slice(eq + 1).trim()
  }
}
loadEnvLocal()

const SB_URL = process.env.LEGACY_SUPABASE_URL
const SB_KEY = process.env.LEGACY_SUPABASE_ANON_KEY
const ESSENTIA_API = process.env.ESSENTIA_API_BASE ?? 'https://api.essentia-sci.org'
const ICAROS_PROJECT_ID = '2cb1ee87-9a24-4ea8-b38c-6c9d30eea042'

if (!SB_URL || !SB_KEY) throw new Error('LEGACY_SUPABASE_* 가 없습니다')

type LegacyPost = { id: string; title: string; content_md: string; created_at: string }
type Existing = { title: string; createdAt: string; authorName: string }

/**
 * 이관에서 제외할 글.
 *
 * `ICX-II RAON TMS` 는 제목·날짜가 ESSENTIA 기존 글과 **완전히 일치**한다.
 * 전환일(2026-08-05) 이후 글인데도 양쪽에 있다는 건 누군가 두 곳에 각각 올렸다는 뜻이고,
 * 서비스 토큰이 붙기 전까지 이 이중 게시가 계속되므로 실행 시점에 다시 대조해야 한다.
 */
const EXCLUDE_EXACT = new Set(['ICX-II RAON TMS'])

/**
 * 사람이 판단해야 하는 것.
 * 레거시 `ICX-1A Launch`(07-24)와 ESSENTIA `ICAROS ICX-IA 1st Launch`(07-19)는
 * 같은 사건(2026-07-18 알뜨르 발사)이지만 제목·날짜가 다르다. 본문·사진을 봐야 안다.
 */
const NEEDS_REVIEW = new Set(['ICX-1A Launch'])

async function sb<T>(path: string): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}` },
  })
  if (!res.ok) throw new Error(`Supabase ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function fetchExisting(): Promise<Existing[]> {
  const res = await fetch(`${ESSENTIA_API}/api/forum/posts?category=ICAROS&size=100`)
  if (!res.ok) throw new Error(`ESSENTIA → ${res.status}`)
  const body = (await res.json()) as { data: { posts: { items: Existing[] } } }
  return body.data.posts.items
}

function main(): Promise<void> {
  return (async () => {
    const [legacy, existing] = await Promise.all([
      sb<LegacyPost[]>('posts?select=id,title,content_md,created_at&order=created_at.asc'),
      fetchExisting(),
    ])

    const existingKeys = new Set(existing.map((e) => `${e.title}|${e.createdAt.slice(0, 10)}`))

    const included: Array<Record<string, unknown>> = []
    const skipped: Array<{ title: string; why: string }> = []
    const review: Array<{ title: string; why: string }> = []

    for (const p of legacy) {
      const key = `${p.title}|${p.created_at.slice(0, 10)}`
      if (EXCLUDE_EXACT.has(p.title) || existingKeys.has(key)) {
        skipped.push({ title: p.title, why: '제목·날짜가 ESSENTIA 기존 글과 일치' })
        continue
      }
      if (NEEDS_REVIEW.has(p.title)) {
        review.push({ title: p.title, why: '같은 사건의 글이 ESSENTIA 에 이미 있을 수 있음 — 본문 대조 필요' })
      }
      included.push({
        legacyId: p.id,
        projectId: ICAROS_PROJECT_ID,
        category: 'ICAROS',
        title: p.title,
        content: p.content_md,
        // 🔴 원본 작성일. ESSENTIA POST 가 이 값을 받아 주는지 확인해야 한다 —
        // 못 받으면 19건이 전부 오늘 날짜가 되어 타임라인이 통째로 무너진다.
        createdAt: p.created_at,
        imageUrls: [...p.content_md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]),
      })
    }

    mkdirSync('docs/legacy-dump', { recursive: true })
    const out = 'docs/legacy-dump/posts-payload.json'
    writeFileSync(out, JSON.stringify({ included, skipped, review }, null, 2), 'utf8')

    const imgs = included.reduce((n, p) => n + (p.imageUrls as string[]).length, 0)
    console.log(`레거시 ${legacy.length}건 · ESSENTIA 기존 ${existing.length}건`)
    console.log(`  이관 대상  ${included.length}건 (이미지 ${imgs}장)`)
    console.log(`  제외      ${skipped.length}건`)
    for (const s of skipped) console.log(`    - ${s.title} — ${s.why}`)
    console.log(`  사람 확인  ${review.length}건`)
    for (const r of review) console.log(`    - ${r.title} — ${r.why}`)
    console.log(`\n→ ${out}`)
  })()
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
