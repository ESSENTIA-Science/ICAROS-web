/**
 * 마이그레이션 적용 결과를 **직접 센다.**
 *
 * `drizzle-kit migrate` 는 실패한 마이그레이션을 삼키고 exit 0 으로 끝난다 —
 * 로컬 셋업에서 실제로 겪었고, 원장 행수를 세고 나서야 알았다.
 * exit code 가 아니라 상태를 본다.
 *
 * `public` 테이블 수가 특히 중요하다. ESSENTIA 는 `ddl-auto: validate` 로 기동하므로
 * 그 숫자가 한 칸이라도 어긋나면 **우리 배포가 상대 API 를 죽인다.**
 *
 * `src/lib/db` 를 import 하지 않는다 — 그쪽은 `server-only` 라 CLI 에서 throw 한다.
 * 운영 도구가 앱 번들 제약에 묶이면 정작 급할 때 못 쓴다. 커넥션을 직접 만든다.
 *
 *   npm run db:verify
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { Client } from 'pg'

function loadEnvLocal(): void {
  if (!existsSync('.env.local')) return
  for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    if (process.env[k] === undefined) process.env[k] = line.slice(eq + 1).trim()
  }
}
loadEnvLocal()

const EXPECTED_PUBLIC_TABLES = Number(process.env.EXPECT_PUBLIC_TABLES ?? '40')

function clientConfig() {
  if (process.env.DB_AUTH !== 'iam') {
    const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL 이 없습니다')
    return { connectionString: url }
  }
  const host = process.env.PGHOST!
  const port = Number(process.env.PGPORT ?? 5432)
  const user = process.env.PGUSER_MIGRATE ?? 'icaros_migrator'
  const region = process.env.AWS_REGION!
  const profile = process.env.AWS_PROFILE ?? 'essentia'
  const caPath = process.env.RDS_CA_BUNDLE_PATH
  const ca = process.env.RDS_CA_BUNDLE ?? (caPath && existsSync(caPath) ? readFileSync(caPath, 'utf8') : undefined)
  if (!ca) throw new Error('RDS CA 번들이 필요합니다 (scripts/fetch-rds-ca.sh)')

  const password = execFileSync('aws', [
    'rds', 'generate-db-auth-token',
    '--profile', profile, '--region', region,
    '--hostname', host, '--port', String(port), '--username', user,
  ], { encoding: 'utf8' }).trim()

  return { host, port, user, database: process.env.PGDATABASE!, password, ssl: { ca, rejectUnauthorized: true } }
}

async function main(): Promise<void> {
  const c = new Client(clientConfig())
  await c.connect()
  const one = async (t: string): Promise<string> => String((await c.query(t)).rows[0]?.v ?? '?')

  const whoami = await one('select current_user v')
  const schemaExists = await one("select count(*)::text v from information_schema.schemata where schema_name='icaros'")
  const ledgerExists = await one("select count(*)::text v from pg_tables where schemaname='icaros' and tablename='__drizzle_migrations'")
  const migrations = ledgerExists === '0'
    ? '0'
    : await one('select count(*)::text v from icaros.__drizzle_migrations')
  console.log(`  icaros 스키마     ${schemaExists === '0' ? '없음' : '있음'}`)
  console.log(`  원장 테이블       ${ledgerExists === '0' ? '없음' : '있음'}`)
  const icarosTables = await one("select count(*)::text v from pg_tables where schemaname='icaros'")
  const publicTables = await one("select count(*)::text v from pg_tables where schemaname='public'")
  const files = readdirSync('drizzle').filter((f) => f.endsWith('.sql')).length
  await c.end()

  console.log(`  접속 role        ${whoami}`)
  console.log(`  마이그레이션 원장  ${migrations}행 (파일 ${files}개)`)
  console.log(`  icaros 테이블     ${icarosTables}`)
  console.log(`  public 테이블     ${publicTables}  (기대 ${EXPECTED_PUBLIC_TABLES})`)

  let ok = true
  if (Number(migrations) !== files) {
    console.error(`\n  ✗ 원장 ${migrations} ≠ 파일 ${files} — 일부가 적용되지 않았다`)
    ok = false
  }
  if (Number(publicTables) !== EXPECTED_PUBLIC_TABLES) {
    console.error(`\n  ✗ public 테이블 수가 ${EXPECTED_PUBLIC_TABLES} → ${publicTables} 로 바뀌었다`)
    console.error('    ESSENTIA 가 ddl-auto: validate 로 기동한다 — 즉시 확인할 것')
    ok = false
  }
  if (ok) console.log('\n  ✓ 정상')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('  실패:', e instanceof Error ? e.message : e)
  process.exit(1)
})
