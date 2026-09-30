/**
 * `public` 스키마 변화 진단 — **읽기 전용 메타데이터만** 본다.
 *
 * `db:verify` 가 `public` 테이블 수를 세다가 40 → 41 을 잡았을 때, "누가 늘렸는가"를
 * 확인하기 위한 도구다. ICAROS 마이그레이션은 `icaros` 만 만들고 `public` 참조가 0건이므로
 * 우리가 만든 것이 아니라는 것까지는 파일로 확인된다 — 남은 것은 상대(ESSENTIA Flyway)가
 * 무엇을 언제 올렸는지다.
 *
 * **업무 데이터를 읽지 않는다.** 테이블 이름과 Flyway 이력의 버전·설명·적용시각만 본다.
 * 그 둘은 우리 검증 도구가 이미 세고 있는 것과 같은 종류의 메타데이터다.
 *
 *   npm run db:inspect-public
 */
import { loadEnvLocal, pgConfig } from '../lib/db-config'

loadEnvLocal()

const { Pool } = await import('pg')
const pool = new Pool(pgConfig('migrate'))

try {
  const tables = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename"
  )
  console.log(`\n  public 테이블 ${tables.rowCount}개\n`)

  const hasFlyway = tables.rows.some((r) => r.tablename === 'flyway_schema_history')
  if (!hasFlyway) {
    console.log('  flyway_schema_history 가 없다 — 이력으로는 판정할 수 없다.\n')
  } else {
    /* 이력 조회는 실패할 수 있다. `icaros_migrator` 에게 `public` 의 SELECT 권한이 없기 때문이고,
       그것이 정상이다 — 우리는 상대 스키마의 **구조**만 볼 수 있고 내용은 못 본다.
       실패를 예외로 터뜨리지 않고 그 사실 자체를 결과로 적는다. */
    try {
    const hist = await pool.query<{
      version: string | null
      description: string
      installed_on: Date
      success: boolean
    }>(
      `select version, description, installed_on, success
         from public.flyway_schema_history
        order by installed_rank desc
        limit 8`
    )
    console.log('  Flyway 최근 적용 (버전 · 설명 · 시각):\n')
    for (const r of hist.rows) {
      const when = r.installed_on.toISOString().slice(0, 16).replace('T', ' ')
      console.log(`    ${when}  ${(r.version ?? '-').padEnd(10)} ${r.success ? ' ' : '✗'} ${r.description}`)
    }
    console.log()
    } catch {
      console.log('  flyway_schema_history 는 있으나 읽을 권한이 없다 — 데이터 격리가 걸려 있다.')
      console.log('  즉 무엇이 언제 올라갔는지는 ESSENTIA 쪽에서만 확인할 수 있다.\n')
    }
  }

  // 우리 소유 스키마도 같이 세어 대조한다.
  const ours = await pool.query<{ n: string }>(
    "select count(*)::text n from pg_tables where schemaname = 'icaros'"
  )
  console.log(`  icaros 테이블 ${ours.rows[0]?.n ?? '?'}개\n`)
} finally {
  await pool.end()
}
