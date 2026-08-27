/** 패널·미디어 행 수 확인. 읽기 전용. */
import { loadEnvLocal, pgConfig } from './lib/db-config'

loadEnvLocal()
const { Pool } = await import('pg')
const pool = new Pool(pgConfig('app'))
try {
  const a = await pool.query(
    'select count(*)::int n, count(*) filter (where published)::int pub from icaros.page_panels'
  )
  const b = await pool.query(
    "select count(*)::int n from icaros.media where entity_type='landing' and status='ready'"
  )
  console.log('  page_panels        ', a.rows[0].n, '개 (공개', a.rows[0].pub, '개)')
  console.log('  media landing/ready', b.rows[0].n, '행')
} finally {
  await pool.end()
}
