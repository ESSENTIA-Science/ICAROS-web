import { NextResponse, type NextRequest } from 'next/server'

/**
 * 점검 셔터 — **환경변수 하나로 사이트를 내리고 올린다.**
 *
 * ```
 * MAINTENANCE_MODE=on    셔터 내림 (503 + 점검 안내)
 * MAINTENANCE_MODE=off   셔터 올림
 * (설정 없음)             셔터 올림
 * ```
 *
 * ## fail-open 이다
 *
 * 값이 없거나 오타면 **사이트는 열린다.** 반대로 두면 환경변수 하나가 누락된 배포에서
 * 사이트가 통째로 사라지고, 그 사실을 배포 로그가 아니라 방문자가 먼저 알게 된다.
 * 셔터는 사람이 의도해서 내리는 것이지 사고로 내려가는 것이 아니어야 한다.
 *
 * ## 왜 rewrite 가 아니라 HTML 을 직접 내는가
 *
 * `NextResponse.rewrite()` 는 **상태 코드를 200 으로 고정**한다. 점검 화면이 200 으로 나가면
 * 크롤러가 "이 페이지의 내용은 점검중입니다"로 색인한다 — 점검이 끝나도 검색 결과가
 * 한동안 그 상태로 남는다. `503 + Retry-After` 만이 "지금은 아니고 나중에 다시 오라"는 뜻이다.
 *
 * 부수 효과로 이 응답은 **앱이 깨져 있어도 나간다.** 라우트도 레이아웃도 DB 도 타지 않는다.
 * 점검 셔터가 정작 장애 때 같이 죽으면 아무 의미가 없다.
 *
 * ## 열어 두는 길
 *
 * `/admin` 을 막으면 셔터를 내린 사람이 **스스로 갇힌다** — 고치려고 내린 점검인데 고칠 창구가
 * 없어진다. 업로드·미디어·크론·재검증도 같은 이유로 연다(전부 자체 인증이 있다).
 *
 * ## 셔터 뒤에서 미리 보기
 *
 * `?maintenance_bypass=<MAINTENANCE_BYPASS>` 로 한 번 들어오면 그 브라우저에만 8시간짜리
 * 쿠키가 붙어 통과한다. 배포한 변경을 방문자에게 열기 전에 확인하는 용도다.
 * `MAINTENANCE_BYPASS` 를 설정하지 않으면 이 우회는 **존재하지 않는다**(빈 문자열 비교로
 * 뚫리지 않도록 값이 없으면 아예 판정하지 않는다).
 */

/** 셔터가 내려가도 통과시키는 경로. 전부 자체 인증이 있거나 관리 창구다. */
const ALWAYS_OPEN = [
  '/admin',
  '/api/upload',
  '/api/media',
  '/api/cron',
  '/api/revalidate',
] as const

const BYPASS_COOKIE = 'icaros_maintenance_bypass'
const BYPASS_PARAM = 'maintenance_bypass'
const BYPASS_MAX_AGE = 8 * 60 * 60

/** 초 단위. 크롤러에게 "이만큼 뒤에 다시 오라"고 알린다. */
const RETRY_AFTER_SECONDS = 3600

function isShutterDown(): boolean {
  return (process.env.MAINTENANCE_MODE ?? '').trim().toLowerCase() === 'on'
}

/**
 * 길이가 다른 문자열을 이른 return 으로 가르지 않는다. 우회 토큰은 짧고 추측 대상이라
 * 비교 시간이 정보를 흘리지 않게 한다.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function maintenanceHtml(): string {
  // 이 문서는 CSS 모듈도 폰트도 불러오지 않는다 — 앱이 깨진 상태에서도 그려져야 하기 때문이다.
  // 색은 공개 화면과 같은 검정·흰색 두 가지뿐이다 (`[data-palette='mono']` 와 같은 규칙).
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>점검중 · ICAROS</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: grid; place-items: center;
    background: #000; color: #fff;
    font-family: ui-sans-serif, system-ui, -apple-system, "Apple SD Gothic Neo",
                 "Pretendard", "Malgun Gothic", sans-serif;
    padding: 2rem;
  }
  main { max-width: 32rem; text-align: center; }
  .mark {
    font: 500 0.75rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.18em; text-transform: uppercase;
    opacity: 0.55;
  }
  h1 {
    margin: 1.75rem 0 0;
    font-size: clamp(1.5rem, 5vw, 2.25rem);
    font-weight: 600;
    /* 한글은 자간을 벌리면 깨진다 — 0 으로 둔다. */
    letter-spacing: 0;
  }
  p { margin: 1rem 0 0; line-height: 1.7; opacity: 0.7; font-size: 0.9375rem; }
  .rule { margin: 2.5rem auto 0; width: 3rem; height: 1px; background: #fff; opacity: 0.3; }
  a { color: inherit; }
</style>
</head>
<body>
  <main>
    <p class="mark">ICAROS</p>
    <h1>사이트 점검중입니다</h1>
    <p>점검이 끝나는 대로 다시 열겠습니다.<br>문의는 <a href="mailto:air091226@naver.com">air091226@naver.com</a></p>
    <div class="rule"></div>
  </main>
</body>
</html>`
}

export function middleware(req: NextRequest): NextResponse {
  if (!isShutterDown()) return NextResponse.next()

  const { pathname, searchParams } = req.nextUrl

  if (ALWAYS_OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }

  const secret = (process.env.MAINTENANCE_BYPASS ?? '').trim()

  // 우회 토큰이 설정돼 있을 때만 우회가 존재한다. 빈 값이면 아래 두 판정 모두 건너뛴다.
  if (secret !== '') {
    const offered = searchParams.get(BYPASS_PARAM)
    if (offered !== null && constantTimeEqual(offered, secret)) {
      // 토큰을 주소창에 남기지 않는다 — 공유·기록으로 새는 경로를 닫는다.
      const clean = req.nextUrl.clone()
      clean.searchParams.delete(BYPASS_PARAM)
      const res = NextResponse.redirect(clean)
      res.cookies.set(BYPASS_COOKIE, secret, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: BYPASS_MAX_AGE,
      })
      return res
    }

    const cookie = req.cookies.get(BYPASS_COOKIE)?.value
    if (cookie !== undefined && constantTimeEqual(cookie, secret)) {
      return NextResponse.next()
    }
  }

  return new NextResponse(maintenanceHtml(), {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': String(RETRY_AFTER_SECONDS),
      // 셔터를 올린 뒤에도 점검 화면이 캐시에 남아 있으면 올린 것이 올린 것이 아니다.
      'Cache-Control': 'no-store, must-revalidate',
      'X-Robots-Tag': 'noindex',
    },
  })
}

/**
 * `_next/*`(청크·이미지 최적화기)와 정적 파일은 아예 미들웨어를 태우지 않는다.
 * `/admin` 이 열려 있어야 하는데 그 화면의 JS·CSS 가 503 을 받으면 열린 것이 아니다.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|glb|mp4)$).*)'],
}
