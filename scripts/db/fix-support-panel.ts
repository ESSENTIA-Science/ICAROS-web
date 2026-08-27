/**
 * SUPPORT 패널에서 **모금 숫자를 뺀다.**
 *
 * 시드할 때 프로토타입의 낡은 카피(`900,000 / 2,700,000`)를 그대로 넣었는데, 바로 아래
 * Donate 섹션은 `site_settings` 의 **live 값**을 읽는다. 결과적으로 한 페이지에 서로 다른
 * 모금액이 두 개 떠 있었다.
 *
 * 고치는 방향은 "패널 숫자를 최신값으로 맞추기"가 아니다 — 그러면 팀이 `/admin` 에서
 * 모금액을 고칠 때마다 패널도 같이 고쳐야 하고, 언젠가 반드시 한쪽을 잊는다.
 * **숫자는 한 곳(Donate 섹션)에서만 센다.** 패널은 그 자리로 데려가는 일만 한다.
 *
 *   npx tsx scripts/db/fix-support-panel.ts [--dry]
 */
import { describeTarget, loadEnvLocal, pgConfig } from '../lib/db-config'

loadEnvLocal()

const dry = process.argv.includes('--dry')

const HEADLINE = 'This runs on\ndonations.'
const BODY =
  '후원금은 기체 부품, 전자 장비, 3D 프린팅 재료, 시험 비행 안전 장비에 쓰입니다. 현재 모금 현황은 아래에 있습니다.'

const { Pool } = await import('pg')
const pool = new Pool(pgConfig('app'))

try {
  console.log(`\n  대상 DB  ${describeTarget()}`)

  const before = await pool.query<{ headline: string; body: string | null }>(
    "select headline, body from icaros.page_panels where cta_href = '#contact' and headline like '%,%'"
  )
  if (before.rowCount === 0) {
    console.log('  이미 고쳐져 있거나 대상 패널이 없습니다.\n')
    process.exit(0)
  }
  console.log(`  대상 ${before.rowCount}개`)
  for (const r of before.rows) console.log(`    현재 headline: ${r.headline.replace(/\n/g, ' / ')}`)

  if (dry) {
    console.log(`\n  --dry — 바꿀 값:\n    ${HEADLINE.replace(/\n/g, ' / ')}\n`)
    process.exit(0)
  }

  const res = await pool.query(
    `update icaros.page_panels
        set headline = $1, body = $2, updated_at = now()
      where cta_href = '#contact' and headline like '%,%'`,
    [HEADLINE, BODY]
  )
  console.log(`\n  ${res.rowCount}개 수정 완료 — 모금 숫자는 이제 Donate 섹션에만 있습니다.\n`)
} finally {
  await pool.end()
}
