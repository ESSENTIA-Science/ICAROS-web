/**
 * 랜딩 패널 공개 · 비공개 전환.
 *
 *   npm run panels:publish            # 상태만 출력
 *   npm run panels:publish -- --on    # 전부 공개
 *   npm run panels:publish -- --off   # 전부 내림
 *
 * 관리 화면(`/admin?tab=panels`)에서 한 장씩 켜는 것이 정상 경로다. 이 도구는 전환 직후처럼
 * **다섯 장을 한 번에** 올리거나 되돌려야 할 때만 쓴다.
 *
 * 되돌리기가 한 명령이라는 것이 이 화면의 안전장치다 — `--off` 를 돌리면 패널이 0개가 되고,
 * 랜딩은 코드가 정한 대로 기존 3D 히어로와 섹션으로 **저절로** 돌아온다.
 */
import { loadEnvLocal, describeTarget, pgConfig } from '../lib/db-config'

loadEnvLocal()

const on = process.argv.includes('--on')
const off = process.argv.includes('--off')
if (on && off) {
  console.error('\n--on 과 --off 를 함께 쓸 수 없습니다.\n')
  process.exit(1)
}

const { Pool } = await import('pg')
const pool = new Pool(pgConfig('app'))

try {
  console.log(`\n  대상 DB  ${describeTarget()}`)

  if (on || off) {
    const res = await pool.query(
      'update icaros.page_panels set published = $1, updated_at = now() where published <> $1',
      [on]
    )
    console.log(`  동작     ${on ? '공개' : '내림'} — ${res.rowCount}개 변경`)
  }

  const rows = await pool.query<{ sort_order: number; published: boolean; headline: string }>(
    'select sort_order, published, headline from icaros.page_panels order by sort_order'
  )
  console.log('')
  for (const r of rows.rows) {
    const first = r.headline.split('\n')[0] ?? ''
    console.log(`    ${String(r.sort_order).padStart(2)}  ${r.published ? '공개  ' : '비공개'}  ${first}`)
  }
  const pub = rows.rows.filter((r) => r.published).length
  console.log(`\n  ${rows.rowCount}개 중 공개 ${pub}개.`)
  console.log(
    pub > 0
      ? '  랜딩이 사진 패널로 그려집니다.\n'
      : '  패널이 0개라 랜딩은 기존 3D 히어로와 섹션으로 그려집니다.\n'
  )
} finally {
  await pool.end()
}
