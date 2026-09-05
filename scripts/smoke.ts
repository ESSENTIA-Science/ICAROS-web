/**
 * 프로덕션 스모크 — **읽기 전용**. 배포 직후 사람이 URL 을 하나씩 열어 보던 것을 대체한다.
 *
 *   npx tsx scripts/smoke.ts                      # https://icaros.kr
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
 *
 * ## 본문까지 보는 이유 (2026-09-06 추가)
 *
 * `/`·`/member` 가 캐시 라우트가 되면서 **200 이면서 비어 있는** 상태가 가능해졌다.
 * 빌드가 RDS 에 닿지 못한 배포는 빈 화면을 프리렌더해 캐시에 넣고, 배포 성공 웹훅이
 * 조용히 실패하면 그게 그대로 남는다. 상태 코드는 정상, 헤더·푸터도 정상, 가운데만 없다.
 * **이 스크립트가 그 그물이다** — `CHECKS` 의 `contains`/`containsAny` 를 지우지 말 것.
 */

/* top-level import 가 없는 파일을 TS 는 **전역 스크립트**로 본다. 그러면 같은 처지의 다른
   스크립트와 전역 스코프를 공유해 같은 이름의 상수가 충돌한다 — 실제로 이 `BASE` 가
   `audit-legacy-posts.ts` 의 `BASE` 와 부딪혀 typecheck 가 깨졌다.
   빈 export 하나가 이 파일을 모듈로 만든다. 지우지 말 것. */
export {}

const BASE = (process.argv[2] ?? 'https://icaros.kr').replace(/\/$/, '')
const TIMEOUT_MS = 25_000

type Check = {
  path: string
  /** DB 를 타는가. 실패 묶음이 이 축으로 갈려야 원인이 좁혀진다. */
  db: boolean
  expect: number
  /** 응답 본문에 반드시 있어야 하는 문자열. 200 인데 내용이 빈 경우를 잡는다. */
  contains?: string
  /** 이 중 **하나라도** 있으면 통과. 화면이 두 모양 중 하나로 성립하는 경우에 쓴다. */
  containsAny?: readonly string[]
  note: string
}

const CHECKS: readonly Check[] = [
  // 정적 파일 두 개가 'DB 없이도 배포가 살아 있다'를 담당한다.
  // robots.txt·sitemap.xml 은 이 앱에 없다 — 있다고 가정하고 넣었다가 404 를 배포 실패로
  // 오진했다. 스모크는 **실재를 확인한 경로만** 담아야 한다.
  { path: '/favicon.png', db: false, expect: 200, note: 'DB 비의존 — 배포 자체' },
  { path: '/og.png', db: false, expect: 200, note: 'DB 비의존 — 정적 자산' },
  { path: '/nonexistent-page-smoke', db: false, expect: 404, note: 'soft-404 회귀' },
  /**
   * `/` 와 `/member` 는 **200 만으로는 아무것도 증명하지 못한다** (2026-09-06, W4 이후).
   *
   * 두 라우트가 `revalidate = 60` 캐시로 넘어가면서 새 실패 모드가 하나 생겼다:
   * 빌드 컨테이너가 RDS 에 닿지 못한 배포는 로더가 실패를 삼켜(`getSiteContentSafe` 등)
   * **빈 화면을 프리렌더해 캐시 초기값으로 넣는다.** 배포 성공 웹훅(`POST /api/revalidate`)이
   * 그 창을 닫게 되어 있지만, 훅이 조용히 안 오는 것이 이 설계의 유일한 실패 모드다.
   * 그때 화면은 200 이고, 헤더·푸터·폰트까지 정상이며, 가운데만 비어 있다 —
   * **상태 코드로도 사람 눈으로도 안 잡힌다.** 본문 검사가 그 그물이다.
   *
   * 판정 기준을 이 문자열들로 잡은 이유:
   *  · 랜딩은 두 모양 중 하나로만 성립한다 — 사진 패널이거나(`data-scrim=`, `Panel.tsx` 전용),
   *    패널이 0개일 때 돌아오는 레거시 섹션이다(`aria-labelledby=`, `Section.tsx`·`Hero.tsx` 전용).
   *    **둘 다 없으면 그린 것이 하나도 없다는 뜻**이고 그게 정확히 이 실패 모드다.
   *    실측(2026-09-06, DB 를 죽인 채 `next start`): 빈 랜딩의 `<main>` 은 리빌 해제용
   *    `<noscript>` 한 줄이 전부였고 두 문자열 다 0건이었다.
   *  · `/member` 의 `data-reveal-item="` 는 `MemberCard` 한 장당 하나다. 명단이 비면 사라진다.
   *  · 셋 다 서버 컴포넌트가 내보내는 **평범한 HTML 속성**이다. CSS Modules 해시 클래스명은
   *    빌드마다 바뀌므로 쓸 수 없다. 카피 문자열도 쓸 수 없다 — 팀이 `/admin` 에서 바꾼다.
   *  · `=` 를 붙여 검사한다. noscript 안의 리빌 해제 CSS 가 `[data-reveal-item]` 처럼
   *    **속성 선택자**로 같은 이름을 적어 두어서, `=` 가 없으면 빈 화면도 통과한다.
   *  · `data-section-theme=` 은 쓰지 않는다 — 루트 레이아웃의 `Loader` 가 그 속성을 **모든
   *    페이지에** 항상 하나 내보낸다. 처음에 그걸 골랐다가 실측에서 걸렀다.
   */
  {
    path: '/',
    db: true,
    expect: 200,
    containsAny: ['data-scrim=', 'aria-labelledby='],
    note: '랜딩 — 패널 또는 섹션이 최소 1개',
  },
  { path: '/rocket', db: true, expect: 200, note: '기체 목록 · 시리즈 탭' },
  { path: '/member', db: true, expect: 200, contains: 'data-reveal-item="', note: '멤버 — 카드 최소 1장' },
  { path: '/posts', db: true, expect: 200, note: 'Community 병합 피드' },
  { path: '/admin', db: true, expect: 200, note: '로그인 화면 (인증 게이트)' },
  { path: '/rocket/nonexistent-slug-smoke', db: true, expect: 404, note: '비공개·부재 기체' },
]

/**
 * 동적 상세 라우트는 **실제 것 하나를 목록에서 찾아** 확인한다.
 *
 * 슬러그를 하드코딩하면 그 항목이 사라지는 날 스모크가 거짓으로 실패하고, 아예 빼 두면
 * 상세 페이지가 깨져도 통과한다. 위 목록에 `/rocket/nonexistent…`(404)만 있던 것이 그 상태였다 —
 * **없는 것은 확인하는데 있는 것은 확인하지 않았다.**
 */
const DYNAMIC: readonly { list: string; pattern: RegExp; note: string }[] = [
  { list: '/rocket', pattern: /\/rocket\/([a-z0-9-]+)/, note: '기체 상세' },
  { list: '/posts', pattern: /\/posts\/legacy\/([a-z0-9-]+)/, note: '레거시 글 상세' },
  { list: '/posts', pattern: /href="\/posts\/([0-9a-f-]{36})"/, note: '상류 글 상세' },
]

async function discover(): Promise<Check[]> {
  const found: Check[] = []
  for (const d of DYNAMIC) {
    const res = await fetch(`${BASE}${d.list}`, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status !== 200) continue
    const m = d.pattern.exec(await res.text())
    if (!m?.[0]) continue
    // 패턴이 href 를 포함하면 경로만 남긴다
    const path = m[0].startsWith('href="') ? (m[0].slice(6, -1) as string) : m[0]
    found.push({ path, db: true, expect: 200, note: d.note })
  }
  return found
}

type Result = { check: Check; status: number | null; ms: number; detail: string }

async function hit(check: Check): Promise<Result> {
  const started = Date.now()
  /**
   * 매번 다른 쿼리를 붙여 **엣지 캐시**를 비껴간다. CDN HIT 이 섞이면 함수가 실제로 도는지 알 수 없다.
   *
   * 다만 이것이 ISR 캐시까지 비껴가지는 않는다 — 공개 라우트의 프리렌더 엔트리는 쿼리가 아니라
   * **경로로** 키가 잡히므로, `/` 는 `?smoke=…` 를 붙여도 캐시에 들어 있는 그 HTML 이 나온다.
   * 위 본문 검사가 "캐시에 박힌 빈 화면"을 잡을 수 있는 것이 그 덕이다. 우연이 아니라 성질이다.
   */
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
    if (check.contains || check.containsAny) {
      const body = await res.text()
      if (check.contains && !body.includes(check.contains)) {
        return { check, status: res.status, ms, detail: `본문에 "${check.contains}" 없음` }
      }
      if (check.containsAny && !check.containsAny.some((needle) => body.includes(needle))) {
        return {
          check,
          status: res.status,
          ms,
          // 200 인데 비어 있는 경우다. 원인은 대개 배포 직후 빈 프리렌더가 캐시에 박힌 것이다.
          detail: `본문이 비었다 — ${check.containsAny.join(' / ')} 중 아무것도 없음`,
        }
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
  const checks = [...CHECKS, ...(await discover())]
  const results: Result[] = []
  for (const check of checks) results.push(await hit(check))

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
  const dbTotal = checks.filter((c) => c.db).length

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
