/**
 * 프로덕션 스모크 — **읽기 전용**. 배포 직후 사람이 URL 을 하나씩 열어 보던 것을 대체한다.
 *
 *   npx tsx scripts/smoke.ts                      # https://www.icaros.kr
 *   npx tsx scripts/smoke.ts http://localhost:3000
 *
 * ## 왜 DB 의존 경로와 비의존 경로를 갈라 놓는가
 *
 * 둘을 섞어 놓으면 "사이트가 죽었다"까지만 알 수 있다. 갈라 두면 한 줄로 원인이 좁혀진다:
 *
 *   DB 비의존만 통과  → DB 도달 실패 (자격증명·네트워크·보안그룹)
 *   둘 다 실패        → 배포 자체가 깨졌다
 *   둘 다 통과        → 애플리케이션 정상
 *
 * 2026-08-27 에 보안그룹이 좁혀지면서 이 구분이 실제로 필요해졌다 (`15-infra-debt.md` §C4) —
 * 네트워크 문제와 코드 문제가 화면에서 같은 500 으로 보인다.
 *
 * ## 404 를 함께 보는 이유
 *
 * `notFound()` 위에 loading 경계가 생기면 셸이 먼저 flush 되어 **404 가 200 이 된다**(soft-404).
 * 눈으로는 404 페이지가 보이므로 사람이 확인하면 절대 못 잡는다. 상태 코드로만 잡힌다.
 */

const BASE = (process.argv[2] ?? 'https://www.icaros.kr').replace(/\/$/, '')
const TIMEOUT_MS = 25_000

type Check = {
  path: string
  /** DB 를 타는가. 실패 묶음이 이 축으로 갈려야 원인이 좁혀진다. */
  db: boolean
  expect: number
  /** 응답 본문에 반드시 있어야 하는 문자열. 200 인데 내용이 빈 경우를 잡는다. */
  contains?: string
  note: string
}

const CHECKS: readonly Check[] = [
  // 정적 파일 두 개가 'DB 없이도 배포가 살아 있다'를 담당한다.
  // robots.txt·sitemap.xml 은 이 앱에 없다 — 있다고 가정하고 넣었다가 404 를 배포 실패로
  // 오진했다. 스모크는 **실재를 확인한 경로만** 담아야 한다.
  { path: '/favicon.png', db: false, expect: 200, note: 'DB 비의존 — 배포 자체' },
  { path: '/og.png', db: false, expect: 200, note: 'DB 비의존 — 정적 자산' },
  { path: '/nonexistent-page-smoke', db: false, expect: 404, note: 'soft-404 회귀' },
  { path: '/', db: true, expect: 200, note: '랜딩 패널' },
  { path: '/rocket', db: true, expect: 200, note: '기체 목록 · 시리즈 탭' },
  { path: '/member', db: true, expect: 200, note: '멤버' },
  { path: '/posts', db: true, expect: 200, note: 'Community 병합 피드' },
  { path: '/admin', db: true, expect: 200, note: '로그인 화면 (인증 게이트)' },
  { path: '/rocket/nonexistent-slug-smoke', db: true, expect: 404, note: '비공개·부재 기체' },
]

type Result = { check: Check; status: number | null; ms: number; detail: string }

async function hit(check: Check): Promise<Result> {
  const started = Date.now()
  // 캐시 우회. CDN HIT 이 섞이면 함수와 DB 가 실제로 도는지 알 수 없다.
  const sep = check.path.includes('?') ? '&' : '?'
  const url = `${BASE}${check.path}${sep}smoke=${Date.now()}`

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'cache-control': 'no-cache' },
    })
    const ms = Date.now() - started

    if (res.status !== check.expect) {
      return { check, status: res.status, ms, detail: `기대 ${check.expect}` }
    }
    if (check.contains) {
      const body = await res.text()
      if (!body.includes(check.contains)) {
        return { check, status: res.status, ms, detail: `본문에 "${check.contains}" 없음` }
      }
    }
    return { check, status: res.status, ms, detail: '' }
  } catch (err) {
    const ms = Date.now() - started
    const msg = err instanceof Error ? err.message : String(err)
    return { check, status: null, ms, detail: msg.slice(0, 60) }
  }
}

async function main(): Promise<void> {
  console.log(`\n  대상  ${BASE}\n`)

  // 순차 실행이다. 동시에 때리면 우리가 스스로 cold fan-out 을 만든다 (D26).
  const results: Result[] = []
  for (const check of CHECKS) results.push(await hit(check))

  for (const r of results) {
    const ok = r.status === r.check.expect && r.detail === ''
    const mark = ok ? '✓' : '✗'
    const db = r.check.db ? 'DB ' : '   '
    const code = r.status === null ? '---' : String(r.status)
    const tail = ok ? r.check.note : `${r.check.note} — ${r.detail}`
    console.log(`  ${mark} ${db} ${code}  ${String(r.ms).padStart(5)}ms  ${r.check.path.padEnd(30)} ${tail}`)
  }

  const failed = results.filter((r) => !(r.status === r.check.expect && r.detail === ''))
  if (failed.length === 0) {
    console.log('\n  ✓ 전부 통과\n')
    process.exit(0)
  }

  // 실패를 축으로 갈라 원인을 좁혀 준다. 이 진단이 이 스크립트의 존재 이유다.
  const dbFailed = failed.filter((r) => r.check.db).length
  const plainFailed = failed.filter((r) => !r.check.db).length
  const dbTotal = CHECKS.filter((c) => c.db).length

  console.log(`\n  ✗ ${failed.length}건 실패`)
  if (plainFailed === 0 && dbFailed === dbTotal) {
    console.log('    → DB 의존 경로만 전부 실패. **배포가 아니라 DB 도달이 의심된다**')
    console.log('       자격증명·네트워크·보안그룹 순으로 볼 것 (15-infra-debt.md §C4)')
  } else if (plainFailed > 0) {
    console.log('    → DB 비의존 경로도 실패. **배포 자체를 먼저 볼 것**')
  }
  console.log()
  process.exit(1)
}

main().catch((e) => {
  console.error('  실패:', e instanceof Error ? e.message : e)
  process.exit(1)
})
