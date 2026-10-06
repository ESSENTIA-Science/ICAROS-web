/**
 * W5 데이터 — 마이그레이션 `0007` 이 **일부러 담지 않은** 것.
 *
 * ## 왜 갈랐나
 *
 * 이 저장소의 실제 관례는 "스키마는 마이그레이션 / 데이터는 스크립트"가 아니다.
 * `0006` 은 `rocket_series` 행 두 개를 **마이그레이션 안에서** 넣었고,
 * `scripts/seed-from-legacy.ts` 는 `site_settings` 18키를 **스크립트로** 넣었다.
 * 두 사례를 가르는 선은 하나다 — **그 데이터에 제약이 의존하는가.**
 *
 *   마이그레이션(0007)  제약·코드가 의존해서 없으면 곧바로 깨지는 것
 *                       · vehicle_types('rockets')   → type_id NOT NULL DEFAULT + FK 가 의존
 *                       · page_panels 의 '/rocket' → '/vehicles'  → 새 CHECK 가 의존
 *                       · site_settings('donation.round_label')
 *                         → 없으면 saveLandingCopyAction 이 RowsMissing 으로 랜딩 저장을
 *                           **통째로 거부**한다. 스크립트에 두면 사람이 잊어도 아무도 모른다.
 *                           마이그레이션이면 db:verify 의 원장 대조에 걸린다.
 *
 *   이 스크립트         아무것도 의존하지 않는 순수 콘텐츠
 *                       · vehicle_types('satellites'·'uavs') — 빈 분류 둘.
 *                         늦게 들어와도 화면에 분류가 하나만 보일 뿐 깨지지 않는다.
 *
 * 같은 값을 두 곳에 적지 않는다 — 행 하나는 정확히 한 곳에만 있다.
 *
 * ## 하는 일
 *
 * 넣고(1), **넣은 뒤 W5 의 데이터 전제를 전부 되읽어 확인한다**(2). 확인 대상은 이 스크립트가
 * 넣은 것만이 아니라 마이그레이션이 넣은 것까지다 — 사람이 알고 싶은 것은 "스크립트가 돌았나"가
 * 아니라 "W5 데이터가 다 앉았나"이기 때문이다. 하나라도 어긋나면 exit 1.
 *
 *   npm run seed:w5            # 적용 + 확인
 *   npm run seed:w5 -- --dry   # 무엇을 넣을지와 현재 상태만 출력 (쓰기 없음)
 *
 * DDL 은 하지 않으므로 `icaros_app` 으로 붙는다. 여기서 permission denied 가 나면 스크립트가
 * 아니라 인프라 문제다 — 새 테이블에 `ALTER DEFAULT PRIVILEGES FOR ROLE icaros_migrator` 가
 * 걸리지 않았다는 뜻이다 (D17 보정 ①).
 */
import { describeTarget, loadEnvLocal, pgConfig } from '../lib/db-config'

loadEnvLocal()

const dry = process.argv.includes('--dry')

/**
 * 이 스크립트가 소유하는 행. `0007` 이 넣는 'rockets' 는 **여기 없다** — 위 주석 참조.
 * `sort_order` 는 0(rockets)에 이어지는 1·2 다.
 */
const CONTENT_TYPES: readonly { readonly id: string; readonly label: string; readonly sortOrder: number }[] = [
  { id: 'satellites', label: 'SATELLITES', sortOrder: 1 },
  { id: 'uavs', label: 'UAVs', sortOrder: 2 },
]

/** 마이그레이션이 넣는 값. 여기서는 **확인만** 한다 — 넣지 않는다. */
const MIGRATION_TYPE_ID = 'rockets'
const ROUND_LABEL_KEY = 'donation.round_label'

const { Pool } = await import('pg')
const pool = new Pool(pgConfig('app'))

let ok = true
const bad = (msg: string): void => {
  console.error(`  ✗ ${msg}`)
  ok = false
}

try {
  console.log(`\n  대상 DB  ${describeTarget()}`)

  // ── 0. 마이그레이션이 먼저 돌았는지 ────────────────────────────────
  // 여기서 멈추지 않으면 아래가 "relation does not exist" 로 죽고, 원인이
  // "스크립트가 깨졌다"로만 보인다. 순서를 틀린 것뿐인데.
  const hasTable = await pool.query<{ n: number }>(
    `select count(*)::int n from information_schema.tables
      where table_schema = 'icaros' and table_name = 'vehicle_types'`
  )
  if ((hasTable.rows[0]?.n ?? 0) === 0) {
    console.error('\n  ✗ icaros.vehicle_types 가 없습니다 — 마이그레이션 0007 이 아직 적용되지 않았습니다.')
    console.error('    npm run db:migrate 를 먼저 실행하십시오.\n')
    process.exit(1)
  }

  // ── 1. 콘텐츠 분류 두 개 ──────────────────────────────────────────
  if (dry) {
    console.log('\n  --dry — 넣을 행:')
    for (const t of CONTENT_TYPES) console.log(`    vehicle_types  ${t.id.padEnd(11)} ${t.label} (sort ${t.sortOrder})`)
  } else {
    let inserted = 0
    for (const t of CONTENT_TYPES) {
      const res = await pool.query(
        `insert into icaros.vehicle_types (id, label, sort_order)
         values ($1, $2, $3) on conflict (id) do nothing`,
        [t.id, t.label, t.sortOrder]
      )
      inserted += res.rowCount ?? 0
    }
    console.log(`\n  vehicle_types  신규 ${inserted}행 (이미 있으면 건드리지 않습니다 — 라벨은 /admin 에서 고칩니다)`)
  }

  // ── 2. W5 데이터 전제 확인 ────────────────────────────────────────
  console.log('\n  확인')

  const types = await pool.query<{ id: string; label: string; sort_order: number }>(
    'select id, label, sort_order from icaros.vehicle_types order by sort_order, id'
  )
  console.log(`    vehicle_types            ${types.rowCount}행`)
  for (const r of types.rows) console.log(`      ${String(r.sort_order).padStart(2)}  ${r.id.padEnd(11)} ${r.label}`)
  const present = new Set(types.rows.map((r) => r.id))
  if (!present.has(MIGRATION_TYPE_ID)) {
    bad(`vehicle_types 에 '${MIGRATION_TYPE_ID}' 가 없습니다 — 0007 이 넣어야 할 행입니다`)
  }
  for (const t of CONTENT_TYPES) {
    if (present.has(t.id)) continue
    // --dry 는 일부러 넣지 않았다. 그걸 빨간불로 세면 dry 실행이 늘 실패로 보이고,
    // 그 다음부터는 아무도 빨간불을 읽지 않는다.
    if (dry) console.log(`      (넣을 예정) ${t.id}`)
    else bad(`vehicle_types 에 '${t.id}' 가 없습니다`)
  }

  const orphanSeries = await pool.query<{ n: number }>(
    `select count(*)::int n from icaros.rocket_series s
      where not exists (select 1 from icaros.vehicle_types v where v.id = s.type_id)`
  )
  const seriesByType = await pool.query<{ type_id: string; n: number }>(
    'select type_id, count(*)::int n from icaros.rocket_series group by type_id order by type_id'
  )
  console.log(
    `    rocket_series.type_id    ${seriesByType.rows.map((r) => `${r.type_id}=${r.n}`).join(' · ') || '(행 없음)'}`
  )
  // FK 가 이미 막고 있어 0 이 아닐 수 없다. 그래도 세는 이유는, 0 이 아니면 FK 자체가
  // 안 걸렸다는 뜻이고 그건 마이그레이션이 반쯤 적용됐다는 신호이기 때문이다.
  if ((orphanSeries.rows[0]?.n ?? 0) !== 0) bad('type_id 가 vehicle_types 에 없는 시리즈가 있습니다 — FK 가 걸리지 않았습니다')

  const staleCta = await pool.query<{ n: number }>(
    `select count(*)::int n from icaros.page_panels where cta_href = '/rocket'`
  )
  const vehiclesCta = await pool.query<{ n: number }>(
    `select count(*)::int n from icaros.page_panels where cta_href = '/vehicles'`
  )
  console.log(`    page_panels.cta_href     /vehicles ${vehiclesCta.rows[0]?.n ?? 0}개 · /rocket ${staleCta.rows[0]?.n ?? 0}개`)
  if ((staleCta.rows[0]?.n ?? 0) !== 0) bad("'/rocket' 을 가리키는 패널이 남아 있습니다 — CHECK 가 갱신되지 않았습니다")

  const round = await pool.query<{ value: string | null }>(
    'select value from icaros.site_settings where key = $1',
    [ROUND_LABEL_KEY]
  )
  if (round.rowCount === 0) {
    bad(`site_settings 에 '${ROUND_LABEL_KEY}' 행이 없습니다 — 이 행이 없으면 /admin 랜딩 저장이 전부 거부됩니다`)
  } else {
    console.log(`    ${ROUND_LABEL_KEY}     '${round.rows[0]?.value ?? ''}'`)
  }

  const bio = await pool.query<{ n: number }>(
    `select count(*)::int n from information_schema.columns
      where table_schema = 'icaros' and table_name = 'members' and column_name = 'bio_md'`
  )
  const desc = await pool.query<{ n: number }>(
    `select count(*)::int n from information_schema.columns
      where table_schema = 'icaros' and table_name = 'rocket_series' and column_name = 'description_md'`
  )
  console.log(`    members.bio_md           ${(bio.rows[0]?.n ?? 0) > 0 ? '있음' : '없음'}`)
  console.log(`    rocket_series.desc_md    ${(desc.rows[0]?.n ?? 0) > 0 ? '있음' : '없음'}`)
  if ((bio.rows[0]?.n ?? 0) === 0) bad('members.bio_md 컬럼이 없습니다')
  if ((desc.rows[0]?.n ?? 0) === 0) bad('rocket_series.description_md 컬럼이 없습니다')

  console.log(ok ? '\n  ✓ W5 데이터 전제 모두 충족\n' : '\n  ✗ 위 항목을 해결해야 합니다\n')
} finally {
  await pool.end()
}

process.exit(ok ? 0 : 1)
