import 'server-only'

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 배포 직후 공개 캐시를 한 번 비우는 훅.
 *
 * ## 왜 필요한가
 *
 * `/`·`/member` 는 동적 세그먼트가 없어서 `revalidate` 를 주는 순간 **빌드가 반드시 한 번
 * 프리렌더한다.** 빌드 컨테이너가 RDS 에 닿지 못하면(D27) 로더가 실패를 삼키고
 * **빈 랜딩·빈 명단이 그대로 캐시 초기값이 된다.** 그 창을 여는 것이 배포이고, 닫는 것이 여기다.
 *
 * 60초 백스톱(`export const revalidate = 60`)이 이미 있으므로 이 훅은 **속도**를 담당한다 —
 * 훅이 실패해도 최대 60초 뒤에는 스스로 낫는다. 반대로 훅만 믿고 `revalidate = false` 로
 * 두었다면 훅이 조용히 실패하는 날 빈 랜딩이 영구히 박힌다. 둘은 대체재가 아니라 이중화다.
 *
 * ## 인증 — 두 갈래인 이유
 *
 * `/api/cron/storage` 의 `Authorization: Bearer $CRON_SECRET` 을 그대로 따르되,
 * **시크릿을 재사용하지 않고 `REVALIDATE_SECRET` 을 따로 둔다.** 근거:
 *   · `CRON_SECRET` 은 Vercel 이 cron 요청에 자동으로 실어 주는 값이라 우리 인프라 밖으로 나갈
 *     일이 없다. 이 훅의 비밀은 **반대로** 배포 파이프라인(GitHub Actions·Vercel 대시보드)에
 *     사람이 붙여 넣어야 한다 — 나가는 값과 안 나가는 값을 한 이름으로 묶지 않는다.
 *   · 권한의 크기가 다르다. 이 훅이 새면 최악이 "캐시가 한 번 더 지워진다"이지만,
 *     `CRON_SECRET` 이 새면 `/api/cron/storage` 가 열려 **S3 객체 삭제**가 남의 손에 들어간다.
 *     하나로 묶으면 약한 쪽의 유출이 강한 쪽의 권한이 된다.
 *   · 회전을 따로 할 수 있다.
 *
 * `x-vercel-signature` 갈래를 같이 두는 이유는 현실적이다 — **Vercel 대시보드의 배포 웹훅은
 * 커스텀 헤더를 붙일 수 없다.** Bearer 만 받으면 "대시보드에서 웹훅을 연결한다"가 애초에
 * 불가능해지고, GitHub Actions 같은 CI 를 반드시 끼워야 한다. 두 경로를 다 열어 두고
 * 운영자가 고르게 한다. 둘 다 상수시간 비교이고, 둘 다 시크릿이 없으면 열리지 않는다.
 */

/** 길이가 다르면 `timingSafeEqual` 이 던진다. 길이 자체는 비밀이 아니므로 먼저 거른다. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

type AuthOutcome = 'ok' | 'unauthorized' | 'not_configured'

/**
 * 설정된 갈래만 검사한다. **하나도 설정돼 있지 않으면 `not_configured`** — 인증 없이 열리는
 * 경로를 만들지 않는다(fail-closed). `/api/cron/storage` 의 `if (!secret) return false` 와 같은 자세다.
 */
function authorize(req: Request, rawBody: string): AuthOutcome {
  const bearerSecret = process.env.REVALIDATE_SECRET?.trim()
  const webhookSecret = process.env.VERCEL_WEBHOOK_SECRET?.trim()

  if (!bearerSecret && !webhookSecret) return 'not_configured'

  if (bearerSecret) {
    const header = req.headers.get('authorization')
    if (header !== null && constantTimeEquals(header, `Bearer ${bearerSecret}`)) return 'ok'
  }

  if (webhookSecret) {
    // Vercel 웹훅 서명: 본문 원문의 HMAC-SHA1 을 hex 로, 접두사 없이 실어 보낸다.
    const signature = req.headers.get('x-vercel-signature')
    if (signature !== null) {
      const expected = createHmac('sha1', webhookSecret).update(rawBody).digest('hex')
      if (constantTimeEquals(signature, expected)) return 'ok'
    }
  }

  return 'unauthorized'
}

/**
 * 프리뷰 배포까지 프로덕션 캐시를 흔들지 않게 거른다.
 *
 * Vercel 웹훅 페이로드는 `payload.target` 에 `'production' | 'staging' | null` 을 싣는다.
 * **모양을 모르면 무효화하는 쪽으로 넘긴다** — curl 한 줄로 손수 치는 경우(본문 없음)가
 * 여기서 막히면 훅이 있으나 마나가 된다. 막는 것은 "명시적으로 프로덕션이 아니라고 적힌 것" 하나뿐이다.
 */
function targetOf(rawBody: string): string | null {
  if (rawBody === '') return null
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (typeof parsed !== 'object' || parsed === null) return null
    const payload = (parsed as { payload?: unknown }).payload
    if (typeof payload !== 'object' || payload === null) return null
    const target = (payload as { target?: unknown }).target
    return typeof target === 'string' ? target : null
  } catch {
    return null
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  // 서명 검증이 본문 원문을 요구하므로 인증보다 먼저 읽는다. 이 엔드포인트는 본문을 신뢰하지 않는다.
  const rawBody = await req.text()
  const outcome = authorize(req, rawBody)

  if (outcome === 'not_configured') {
    // 503 이다. 401 로 내리면 "시크릿이 틀렸다"와 "시크릿을 아예 안 넣었다"가 구별되지 않아
    // 훅이 조용히 실패하는 이 설계의 유일한 실패 모드가 그대로 숨는다.
    console.error(
      '[revalidate] REVALIDATE_SECRET·VERCEL_WEBHOOK_SECRET 이 둘 다 없다 — 훅을 거부했다(fail-closed)'
    )
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  if (outcome === 'unauthorized') {
    console.warn('[revalidate] 인증 실패 — 캐시를 비우지 않았다')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const target = targetOf(rawBody)
  if (target !== null && target !== 'production') {
    console.log(`[revalidate] target=${target} — 프로덕션이 아니라 건너뛴다`)
    return NextResponse.json({ revalidated: false, reason: 'not-production' })
  }

  /**
   * `'layout'` 이다. 루트 레이아웃 자체가 `site_settings` 를 읽어 헤더·푸터·SEO 를 만들므로
   * `'page'` 로는 `/` 한 장만 비우고 나머지 라우트의 껍데기가 낡은 채로 남는다.
   * 배포 직후 한 번뿐이고, 비운 것을 다시 채우는 것은 첫 방문자의 렌더 한 번이다.
   */
  revalidatePath('/', 'layout')

  // 성공 로그를 반드시 남긴다 — 이 설계의 유일한 실패 모드가 "훅이 조용히 안 왔다"이고,
  // 그건 이 줄이 없는 것으로만 확인된다. Vercel 로그에서 `[revalidate]` 로 찾는다.
  console.log(`[revalidate] '/' 이하 캐시를 비웠다 (target=${target ?? 'unspecified'})`)
  return NextResponse.json({ revalidated: true, path: '/', type: 'layout' })
}
