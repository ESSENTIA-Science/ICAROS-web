/**
 * 마이그레이션 적용 결과를 **직접 센다.**
 *
 * `drizzle-kit migrate` 는 실패한 마이그레이션을 삼키고 exit 0 으로 끝난다 —
 * 로컬 셋업에서 실제로 겪었고, 원장 행수를 세고 나서야 알았다.
 * exit code 가 아니라 상태를 본다.
 *
 * `public` 은 **소유자로** 본다. ESSENTIA 는 `ddl-auto: validate` 로 기동하므로
 * 우리가 거기에 뭔가 만들면 상대 API 가 죽는다 — 그게 우리가 막아야 할 유일한 사고다.
 *
 * 예전에는 `public` **테이블 수**를 상수와 대조했다. 그건 우리 사고가 아니라 **상대의 정상
 * 배포**에도 걸린다. 실제로 그랬다 — ESSENTIA 가 `V19__application_bans.sql` 로 테이블
 * 하나를 늘리자(2026-08-25) 우리 검증이 빨간불이 됐고, 원인을 알아내는 데 양쪽이 붙었다.
 * 상대는 `public` 에서 계속 마이그레이션을 돌린다(현재 V20). 상수를 올려도 다음 배포에 또 깨진다.
 *
 * 그래서 질문을 바꾼다: "public 이 몇 개인가"가 아니라 **"public 에 우리 것이 있는가"**.
 * 이건 상대 배포와 무관하게 안정적이고, 애초에 우리가 알고 싶었던 것이다.
 *
 * `src/lib/db` 를 import 하지 않는다 — 그쪽은 `server-only` 라 CLI 에서 throw 한다.
 * 운영 도구가 앱 번들 제약에 묶이면 정작 급할 때 못 쓴다. 커넥션을 직접 만든다.
 *
 *   npm run db:verify
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { Client } from 'pg'
import { MEDIA_FK_COLUMNS } from '../../src/lib/s3/media-references'

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

/**
 * `public` 에 있으면 안 되는 소유자. 우리 role 이 만든 것이 하나라도 있으면 사고다.
 * 상대가 무엇을 몇 개 만들든 이 목록은 바뀌지 않는다.
 */
const OUR_ROLES = ['icaros_migrator', 'icaros_app'] as const

/**
 * `hasReferences()` 가 확인하는 FK 목록. `src/lib/s3/media-references.ts` 가 원본이다.
 * 여기서 **DB 의 실제 외래키와 대조**한다 — 새 테이블이 `media.id` 를 가리키는데 그 목록에
 * 없으면 정리 스윕이 살아 있는 사진을 지운다 (2026-08-29 장애).
 *
 * 그 파일은 `server-only` 를 import 하지 않는 순수 상수 모듈이라 CLI 에서 그대로 읽힌다.
 */
const KNOWN_MEDIA_FKS = new Set(
  MEDIA_FK_COLUMNS.map((c) => `${c.table}.${c.column}`)
)

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
  const one = async (t: string, params?: unknown[]): Promise<string> =>
    String((await c.query(t, params)).rows[0]?.v ?? '?')

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
  // 소유자로 본다. 상대가 만든 것은 세되 판정하지 않고, 우리 것만 판정한다.
  const oursInPublic = await one(
    `select count(*)::text v from pg_tables
      where schemaname = 'public' and tableowner = any($1)`,
    [OUR_ROLES as unknown as string[]]
  )
  /**
   * `media.id` 를 가리키는 외래키를 DB 에서 직접 긁는다. 사람의 기억이 아니라
   * 스키마가 목록을 검사하게 만드는 지점이다.
   */
  const mediaFks = (
    await c.query<{ t: string; col: string }>(
      `select tc.table_name t, kcu.column_name col
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'icaros'
          and ccu.table_name = 'media' and ccu.column_name = 'id'`
    )
  ).rows.map((r) => `${r.t}.${r.col}`)

  const files = readdirSync('drizzle').filter((f) => f.endsWith('.sql')).length
  await c.end()

  console.log(`  접속 role        ${whoami}`)
  console.log(`  마이그레이션 원장  ${migrations}행 (파일 ${files}개)`)
  console.log(`  icaros 테이블     ${icarosTables}`)
  console.log(`  public 테이블     ${publicTables}  (ESSENTIA 소유 — 참고용)`)
  console.log(`  그중 우리 것      ${oursInPublic}  (0 이어야 한다)`)
  console.log(`  media 참조 FK     ${mediaFks.length}개`)

  let ok = true
  if (Number(migrations) !== files) {
    console.error(`\n  ✗ 원장 ${migrations} ≠ 파일 ${files} — 일부가 적용되지 않았다`)
    ok = false
  }
  const unguarded = mediaFks.filter((f) => !KNOWN_MEDIA_FKS.has(f))
  if (unguarded.length > 0) {
    console.error(`\n  ✗ media 를 가리키는데 hasReferences() 가 모르는 FK: ${unguarded.join(', ')}`)
    console.error('    정리 스윕이 살아 있는 사진을 지운다 — src/lib/s3/media-references.ts 에 추가할 것')
    ok = false
  }
  /**
   * 반대 방향(목록에 있는데 DB FK 가 없는 것)은 **검사하지 않는다.**
   * `rockets.cover_media_id` 처럼 FK 제약 없이 관례로만 미디어를 가리키는 컬럼이 있고,
   * 그것들도 `hasReferences()` 는 확인해야 한다. 목록이 DB FK 보다 넓은 건 정상이다.
   * 위험한 방향은 **DB 에 있는데 목록에 없는 쪽** 하나뿐이다 — 그쪽만 막는다.
   */

  if (Number(oursInPublic) !== 0) {
    console.error(`\n  ✗ public 스키마에 우리 role 이 만든 테이블이 ${oursInPublic}개 있다`)
    console.error('    ESSENTIA 가 ddl-auto: validate 로 기동한다 — 상대 API 가 죽는다. 즉시 제거할 것')
    ok = false
  }
  if (ok) console.log('\n  ✓ 정상')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('  실패:', e instanceof Error ? e.message : e)
  process.exit(1)
})
