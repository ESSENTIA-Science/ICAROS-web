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

/** 긴 URL 은 **가운데를** 접는다. 앞뒤가 남아야 무엇이 다른지 보인다. */
function elide(u: string, max = 120): string {
  if (u.length <= max) return u
  const head = Math.ceil((max - 3) * 0.45)
  const tail = max - 3 - head
  return `${u.slice(0, head)}...${u.slice(-tail)}`
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
    /**
     * **한 번 실패했다고 깨졌다고 하지 않는다.**
     *
     * 첫 판에서 멀쩡한 이미지 하나가 일시적 `ETIMEDOUT` 으로 실패로 찍혔다(재확인 3/3 200).
     * 오탐이 섞이는 감사는 곧 무시당하고, 무시당하는 감사는 없는 것과 같다.
     * 죽은 호스트는 재시도해도 죽어 있으므로 진짜 실패는 그대로 남는다.
     */
    let verdict: Bad | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await sleep(1_200)
    try {
      const r = await fetch(target, { signal: AbortSignal.timeout(25_000) })
      const len = Number(r.headers.get('content-length') ?? 0)
      const ct = r.headers.get('content-type') ?? ''
      /**
       * **body 를 반드시 버린다.** 헤더만 읽고 두면 소켓이 열린 채 남고, 나중에 끊길 때
       * `ETIMEDOUT` 이 **await 밖에서** 터져 try/catch 를 빠져나간다 — 실제로 그렇게
       * 스크립트가 통째로 죽었다. 이미지 바이트는 필요 없으니 여기서 닫는다.
       */
      await r.body?.cancel().catch(() => {})
      if (r.status === 200 && (len > 0 || ct.startsWith('image'))) { verdict = null; break }
      verdict = { url: u, status: r.status, pages: [...onPages] }
    } catch {
      // status 0 = DNS·연결 실패. 죽은 외부 호스트가 여기로 온다.
      verdict = { url: u, status: 0, pages: [...onPages] }
    }
    }
    if (verdict) bad.push(verdict)
    else ok += 1
    await sleep(100)
  }

  console.log(`  정상 ${ok} / ${seen.size}`)
  if (bad.length === 0) {
    console.log('\n  ✓ 모든 이미지 정상\n')
    process.exit(0)
  }
  console.log(`\n  ✗ ${bad.length}건 실패\n`)
  for (const b of bad) {
    /**
     * **URL 을 앞에서 자르지 않는다.**
     *
     * 처음엔 `slice(0, 110)` 으로 줄였는데, 실패한 두 URL 이 폴더까지 같고 **파일명에서만
     * 달랐다.** 잘린 출력이 똑같아 보여서 "같은 이미지 1장"으로 오독했고, 그러면
     * 하나만 복구하고 끝났다고 판단하게 된다. 실제로 그렇게 보고할 뻔했다.
     *
     * 구분되는 정보는 대개 **뒤쪽(파일명)** 에 있다. 길면 가운데를 접는다.
     */
    console.log(`   [${b.status || 'DNS/연결실패'}] ${elide(b.url)}`)
    console.log(`        ← ${b.pages.slice(0, 3).join(' , ')}`)
  }
  console.log()
  process.exit(1)
}

/**
 * 마지막 방어선. 위에서 body 를 닫아도 죽은 호스트를 상대하다 보면 늦은 소켓 오류가
 * 남을 수 있다. 감사 도구가 **감사 대상보다 먼저 죽으면** 아무것도 못 본다.
 */
process.on('unhandledRejection', () => {})
process.on('uncaughtException', (e) => {
  if ((e as NodeJS.ErrnoException).code === 'ETIMEDOUT') return
  throw e
})

main().catch((e) => {
  console.error('  실패:', e instanceof Error ? e.message : e)
  process.exit(1)
})
