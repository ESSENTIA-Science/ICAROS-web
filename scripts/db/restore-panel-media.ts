/**
 * 패널이 가리키는데 soft delete 된 미디어를 되살린다. **일회성 복구 도구.**
 *
 *   npx tsx scripts/db/restore-panel-media.ts --dry   # 대상만 출력
 *   npx tsx scripts/db/restore-panel-media.ts
 *
 * ## 왜 필요했나 (2026-08-29 장애)
 *
 * `hasReferences()` 가 `page_panels` 를 보지 않았다. 패널 CMS 가 나중에 추가됐는데 참조 검사에
 * 들어가지 않아서, 패널이 쓰는 사진을 "아무도 안 쓴다"로 판정하고 지웠다.
 * 랜딩 패널 5개 중 4개가 화면에서 사라졌다 — **관리 화면에는 그대로 보였다.**
 * 공개 로더만 `deleted_at` 을 보기 때문이다.
 *
 * FK 는 `onDelete: restrict` 지만 그건 **하드 삭제**만 막는다. soft delete 는 그대로 통과한다.
 *
 * 근본 원인은 `lib/s3/cleanup.ts` 의 `hasReferences()` 에서 고쳤다. 이 스크립트는 이미 지워진
 * 행을 되돌리는 용도다.
 */
import { describeTarget, loadEnvLocal, pgConfig } from '../lib/db-config'

loadEnvLocal()
const dry = process.argv.includes('--dry')

const { Pool } = await import('pg')
const pool = new Pool(pgConfig('app'))

try {
  console.log(`\n  대상 DB  ${describeTarget()}\n`)

  const target = await pool.query<{ ord: number; id: string; headline: string }>(
    `select p.sort_order ord, m.id, left(replace(p.headline, E'\\n', ' '), 30) headline
       from icaros.page_panels p
       join icaros.media m on m.id = p.media_id
      where m.deleted_at is not null
      order by p.sort_order`
  )

  if (target.rowCount === 0) {
    console.log('  되살릴 대상이 없습니다.\n')
  } else {
    for (const r of target.rows) console.log(`  복원 대상  #${r.ord}  ${r.headline}`)

    if (!dry) {
      // 살아 있는 패널이 가리키는 미디어만. 다른 삭제분은 건드리지 않는다.
      const done = await pool.query(
        `update icaros.media m
            set deleted_at = null
          where m.deleted_at is not null
            and exists (select 1 from icaros.page_panels p where p.media_id = m.id)`
      )
      console.log(`\n  복원 ${done.rowCount}건`)
    }
  }

  const now = await pool.query<{ ord: number; pub: boolean; dead: boolean; headline: string }>(
    `select p.sort_order ord, p.published pub, (m.deleted_at is not null) dead,
            left(replace(p.headline, E'\\n', ' '), 30) headline
       from icaros.page_panels p
       join icaros.media m on m.id = p.media_id
      order by p.sort_order`
  )
  console.log('\n  현재 상태')
  for (const r of now.rows) {
    const shown = r.pub && !r.dead
    console.log(`   #${r.ord}  ${r.pub ? '공개' : '비공개'}  ${r.dead ? '삭제됨' : '정상  '}  ${shown ? '→ 화면에 나옴' : '→ 안 나옴'}  ${r.headline}`)
  }
  console.log(dry ? '\n  (--dry — 변경 없음)\n' : '\n')
} finally {
  await pool.end()
}
