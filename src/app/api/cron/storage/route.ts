import 'server-only'

import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { timingSafeEqual } from 'node:crypto'
import { listAbandonedCleanupJobs, runCleanupJobs, sweepStalePendingUploads } from '@/lib/s3'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 스토리지 정리 큐를 비우는 유일한 호출부.
 *
 * 이게 없으면 `enqueueCleanup` 이 행만 쌓고 아무도 꺼내지 않는다 —
 * 요구사항 I10("실패 재시도")·I9("고아 탐지")의 검증 기준이 "적재됨"이 아니라
 * "재시도된다"인데, 큐를 비우는 주체가 없으면 그건 성립하지 않는다.
 *
 * 인증: Vercel Cron 은 `Authorization: Bearer $CRON_SECRET` 을 붙인다.
 * 관리자 세션이 아니라 공유 비밀로 가른다 — cron 은 브라우저가 아니라 Origin 이 없고,
 * `requireAdmin()` 은 Origin 부재를 거부하기 때문이다.
 */
function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header ?? '')
  // 길이가 다르면 timingSafeEqual 이 던진다. 길이 자체가 비밀은 아니므로 먼저 거른다.
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function GET() {
  const h = await headers()
  if (!authorized(h.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 순서: 먼저 버려진 업로드를 큐에 넣고, 그다음 큐를 비운다.
  // 반대로 하면 이번에 발견된 고아가 다음 주기까지 기다린다.
  const swept = await sweepStalePendingUploads()
  const cleaned = await runCleanupJobs()
  const abandoned = await listAbandonedCleanupJobs()

  // 포기된 잡은 사람이 봐야 한다. 조용히 쌓이면 I10 의 "가시성"이 다시 사라진다.
  if (abandoned.length > 0) {
    console.warn(`[storage] 재시도 상한에 도달해 방치된 정리 작업 ${abandoned.length}건`)
  }

  return NextResponse.json({ swept, cleaned, abandoned: abandoned.length })
}
