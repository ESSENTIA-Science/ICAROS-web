/**
 * 공개 화면의 **모든 이미지**를 브라우저가 요청하는 형태 그대로 확인한다. 읽기 전용.
 *
 *   npx tsx scripts/audit-images.ts
 *   npx tsx scripts/audit-images.ts http://localhost:3000
 *
 * ## 왜 `audit-legacy-posts.ts` 로는 부족한가
 *
 * 그쪽은 우리 레거시 글의 `/api/media/{id}` 만 본다. 이 스크립트는 **페이지를 실제로 훑어**
 * 랜딩 패널·로켓·멤버·썸네일·상류(ESSENTIA) 글의 외부 이미지까지 전부 확인한다.
 *
 * 2026-08-28 에 이 차이가 실제로 드러났다 — 레거시 감사는 38/38 통과였는데,
 * 이 스윕이 **상류 글 2건의 죽은 Supabase 이미지**를 잡았다(문서 14 §10).
 *
 * `/api/media` 가 200 이어도 최적화기(`/_next/image`)를 통과하지 못하면 화면에서는 안 보인다.
 * 그래서 **최적화기 URL 을 그대로** 요청한다 — 사람이 보는 것과 같은 요청이다.
 */

/* top-level import 가 없으면 TS 가 이 파일을 **전역 스크립트**로 본다 — 다른 스크립트와
   전역 스코프를 공유해 `BASE` 같은 이름이 충돌한다. 빈 export 가 모듈로 만든다. */
export {}

const BASE = (process.argv[2] ?? 'https://www.icaros.kr').replace(/\/$/, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(path: string): Promise<{ status: number; body: string }> {
  try {
    const r = await fetch(`${BASE}${path}`, { redirect: 'follow', signal: AbortSignal.timeout(25_000) })
    return { status: r.status, body: r.status === 200 ? await r.text() : '' }
  } catch {
    return { status: 0, body: '' }
  }
}

/** HTML 이스케이프와 RSC 페이로드 이스케이프가 섞여 나온다. 둘 다 푼다. */
function unescapeUrl(u: string): string {
  return u.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\"/g, '')
}

async function collectPages(): Promise<Set<string>> {
  const pages = new Set(['/', '/rocket', '/member', '/posts'])

  const rocket = await get('/rocket')
  for (const m of rocket.body.matchAll(/\/rocket\/([a-z0-9-]+)/g)) if (m[1]) pages.add(`/rocket/${m[1]}`)
  for (const m of rocket.body.matchAll(/\?series=([A-Za-z0-9-]+)/g)) if (m[1]) pages.add(`/rocket?series=${m[1]}`)

  // 페이지는 0-indexed 다 (`/posts` = page 0). 1-indexed 로 세면 한 페이지를 통째로 놓친다.
  for (let page = 0; page <= 8; page += 1) {
    const { body } = await get(page === 0 ? '/posts' : `/posts?page=${page}`)
    if (!body) break
    const before = pages.size
    for (const m of body.matchAll(/\/posts\/legacy\/([a-z0-9-]+)/g)) if (m[1]) pages.add(`/posts/legacy/${m[1]}`)
    for (const m of body.matchAll(/href="(\/posts\/[0-9a-f-]{36})"/g)) if (m[1]) pages.add(m[1])
    if (pages.size === before) break
    await sleep(200)
  }
  return pages
}

type Bad = { url: string; status: number; pages: string[] }

async function main(): Promise<void> {
  console.log(`\n  대상  ${BASE}\n`)

  const pages = await collectPages()
  console.log(`  페이지 ${pages.size}개`)

  const seen = new Map<string, Set<string>>()
  for (const page of [...pages].sort()) {
    const { status, body } = await get(page)
    if (status !== 200) {
      console.log(`  ✗ 페이지 ${page} → ${status}`)
      continue
    }
    const urls = new Set<string>()
    for (const m of body.matchAll(/\/_next\/image\?url=[^"'\\ )]+/g)) urls.add(unescapeUrl(m[0]))
    for (const m of body.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      const u = unescapeUrl(m[1] ?? '')
      if (u.startsWith('/_next/image')) continue
      if (u.startsWith('/') || /^https?:\/\//.test(u)) urls.add(u)
    }
    for (const u of urls) {
      if (!seen.has(u)) seen.set(u, new Set())
      seen.get(u)?.add(page)
    }
    await sleep(200)
  }

  console.log(`  고유 이미지 ${seen.size}개\n`)

  const bad: Bad[] = []
  let ok = 0
  for (const [u, onPages] of seen) {
    const target = /^https?:\/\//.test(u) ? u : `${BASE}${u}`
    try {
      const r = await fetch(target, { signal: AbortSignal.timeout(25_000) })
      const len = Number(r.headers.get('content-length') ?? 0)
      const ct = r.headers.get('content-type') ?? ''
      if (r.status === 200 && (len > 0 || ct.startsWith('image'))) ok += 1
      else bad.push({ url: u, status: r.status, pages: [...onPages] })
    } catch {
      // status 0 = DNS·연결 실패. 죽은 외부 호스트가 여기로 온다.
      bad.push({ url: u, status: 0, pages: [...onPages] })
    }
    await sleep(100)
  }

  console.log(`  정상 ${ok} / ${seen.size}`)
  if (bad.length === 0) {
    console.log('\n  ✓ 모든 이미지 정상\n')
    process.exit(0)
  }
  console.log(`\n  ✗ ${bad.length}건 실패\n`)
  for (const b of bad) {
    console.log(`   [${b.status || 'DNS/연결실패'}] ${b.url.slice(0, 110)}`)
    console.log(`        ← ${b.pages.slice(0, 3).join(' , ')}`)
  }
  console.log()
  process.exit(1)
}

main().catch((e) => {
  console.error('  실패:', e instanceof Error ? e.message : e)
  process.exit(1)
})
