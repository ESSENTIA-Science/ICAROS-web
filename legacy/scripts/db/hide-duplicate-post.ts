/**
 * ESSENTIA 에 같은 사건의 글이 이미 있는 레거시 글을 **목록에서 내린다.**
 *
 *   npx tsx scripts/db/hide-duplicate-post.ts [--dry]
 *
 * 지우지 않는 이유는 스키마 주석에 있다 — 중복 판정은 사람의 판단이고 뒤집힐 수 있는데,
 * 행을 지우면 되돌릴 때 원본 대조부터 다시 해야 한다. 본문·이미지는 남기고 노출만 끈다.
 *
 * 되돌리기: `update icaros.legacy_posts set published = true where title = '…'`
 */
import { describeTarget, loadEnvLocal, pgConfig } from '../lib/db-config'

loadEnvLocal()

const dry = process.argv.includes('--dry')

/**
 * 제목으로 지목한다. 레거시 id 는 이 저장소 밖(레거시 DB)에서 온 값이라 여기 적어 두면
 * 무엇을 왜 내렸는지가 안 보인다. 제목은 사람이 읽고 판단을 재검토할 수 있다.
 */
const DUPLICATES: readonly { title: string; because: string }[] = [
  {
    title: 'ICX-1A Launch',
    because: "ESSENTIA 의 'ICAROS ICX-IA 1st Launch' 와 같은 날(2026-07-24) 같은 발사",
  },
]

const { Pool } = await import('pg')
const pool = new Pool(pgConfig('app'))

try {
  console.log(`\n  대상 DB  ${describeTarget()}\n`)

  for (const d of DUPLICATES) {
    const found = await pool.query<{ slug: string; published: boolean }>(
      'select slug, published from icaros.legacy_posts where title = $1',
      [d.title]
    )
    if (found.rowCount === 0) {
      console.log(`  없음    ${d.title}`)
      continue
    }
    const row = found.rows[0]
    if (row && !row.published) {
      console.log(`  이미 내림 ${d.title}`)
      continue
    }
    console.log(`  내림    ${d.title}\n          ↳ ${d.because}`)
    if (!dry) {
      await pool.query(
        'update icaros.legacy_posts set published = false, updated_at = now() where title = $1',
        [d.title]
      )
    }
  }

  const n = await pool.query<{ total: string; shown: string }>(
    "select count(*)::text total, count(*) filter (where published)::text shown from icaros.legacy_posts"
  )
  console.log(`\n  legacy_posts ${n.rows[0]?.total} 건 중 공개 ${n.rows[0]?.shown} 건${dry ? '  (--dry — 변경 없음)' : ''}\n`)
} finally {
  await pool.end()
}
