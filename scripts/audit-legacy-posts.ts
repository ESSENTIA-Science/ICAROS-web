/**
 * 레거시 게시글·이미지 전수 감사 — **프로덕션 대상, 읽기 전용.**
 *
 *   npx tsx scripts/audit-legacy-posts.ts
 *   npx tsx scripts/audit-legacy-posts.ts http://localhost:3000
 *
 * 레거시 19건과 이미지 48장은 2026-08-27 에 Supabase 에서 우리 쪽으로 옮겼다(문서 14).
 * 원본 Supabase 는 언젠가 죽는다 — 그때 조용히 깨져 있는 것을 나중에 발견하는 게
 * 이 작업에서 가장 나쁜 결말이라, **밖에서 실제로 열어 보는** 검사를 남겨 둔다.
 *
 * DB 를 읽지 않는다. 공개 화면이 실제로 그리는 것만 본다 — 그래야 DB 는 멀쩡한데
 * 렌더가 깨진 경우도 잡힌다. (DB 쪽 무결성은 `legacy_posts_no_legacy_url_ck` CHECK 가 본다)
 *
 * ## 페이지네이션은 0-indexed 다
 *
 * `/posts` = page 0, `?page=1` = page 1. 1-indexed 로 가정하면 `?page=1` 을 건너뛰고
 * **레거시 11건이 사라진 것처럼 보인다** — 실제로 그렇게 오진한 적이 있다.
 */

const BASE = (process.argv[2] ?? 'https://www.icaros.kr').replace(/\/$/, '')

/** 2026-08-27 이관 시점의 실측값. 이 숫자가 안 맞으면 무언가 사라진 것이다. */
const EXPECTED_POSTS = 18 // 공개분. 전체 19건 중 1건은 ESSENTIA 와 중복이라 내려 뒀다
const EXPECTED_IMAGES = 38 // 공개 글 본문 참조. 나머지 10장은 비공개 1건에 속한다

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  })
  return { status: res.status, body: res.status === 200 ? await res.text() : '' }
}

/** 최적화기를 거친 URL 은 `%2F` 로 인코딩돼 있다. 둘 다 잡는다. */
const MEDIA_RE = /api(?:%2F|\/)media(?:%2F|\/)([0-9a-f-]{36})/g

async function main(): Promise<void> {
  console.log(`\n  대상  ${BASE}\n`)
  const problems: string[] = []

  // ── 1. 목록을 끝까지 훑어 레거시 슬러그 수집 ───────────
  const slugs = new Set<string>()
  for (let page = 0; page <= 12; page += 1) {
    const { status, body } = await get(page === 0 ? '/posts' : `/posts?page=${page}`)
    if (status !== 200) break
    const before = slugs.size
    for (const m of body.matchAll(/\/posts\/legacy\/([a-z0-9-]+)/g)) if (m[1]) slugs.add(m[1])
    if (slugs.size === before) break
    await sleep(300)
  }

  // ── 2. 글마다 이미지 수집 + 치환 누락 검사 ─────────────
  const perSlug = new Map<string, string[]>()
  const allMedia = new Set<string>()

  for (const slug of [...slugs].sort()) {
    const { status, body } = await get(`/posts/legacy/${slug}`)
    if (status !== 200) {
      problems.push(`글 ${slug} → HTTP ${status}`)
      continue
    }
    const ids = [...new Set([...body.matchAll(MEDIA_RE)].map((m) => m[1]).filter((v): v is string => !!v))]
    perSlug.set(slug, ids)
    for (const id of ids) allMedia.add(id)

    // DB CHECK 가 저장을 막지만, 렌더 결과에서 한 번 더 본다
    if (/supabase\.co/i.test(body)) problems.push(`글 ${slug} → 본문에 레거시 URL 잔존`)
    if (ids.length === 0) problems.push(`글 ${slug} → 이미지 참조 0개`)
    await sleep(250)
  }

  // ── 3. 이미지 전건 도달성 ───────────────────────────────
  let reachable = 0
  for (const id of allMedia) {
    try {
      const res = await fetch(`${BASE}/api/media/${id}`, { signal: AbortSignal.timeout(25_000) })
      const len = Number(res.headers.get('content-length') ?? 0)
      if (res.status === 200 && len > 0) reachable += 1
      else problems.push(`이미지 ${id.slice(0, 8)}… → HTTP ${res.status} ${len}B`)
    } catch (err) {
      problems.push(`이미지 ${id.slice(0, 8)}… → ${err instanceof Error ? err.message.slice(0, 40) : err}`)
    }
    await sleep(120)
  }

  // ── 4. 결과 ────────────────────────────────────────────
  for (const [slug, ids] of [...perSlug].sort()) {
    console.log(`  ${slug.padEnd(24)} 이미지 ${String(ids.length).padStart(2)}장`)
  }

  console.log(`\n  글      ${slugs.size} / ${EXPECTED_POSTS}`)
  console.log(`  이미지  ${reachable} / ${allMedia.size}  (기대 ${EXPECTED_IMAGES})`)

  if (slugs.size !== EXPECTED_POSTS) {
    problems.push(`글 수가 ${slugs.size} — 기대 ${EXPECTED_POSTS}`)
  }
  if (allMedia.size !== EXPECTED_IMAGES) {
    problems.push(`이미지 수가 ${allMedia.size} — 기대 ${EXPECTED_IMAGES}`)
  }

  if (problems.length === 0) {
    console.log('\n  ✓ 레거시 아카이브 무결\n')
    process.exit(0)
  }
  console.log(`\n  ✗ ${problems.length}건`)
  for (const p of problems) console.log(`     ${p}`)
  console.log()
  process.exit(1)
}

main().catch((e) => {
  console.error('  실패:', e instanceof Error ? e.message : e)
  process.exit(1)
})
