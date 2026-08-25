/**
 * 마이그레이션 적용기.
 *
 * `drizzle-kit migrate` 를 쓰지 않는 이유: **실패를 삼킨다.**
 * 로컬에서는 exit 0 으로 끝내면서 아무것도 안 했고, RDS 에서는 exit 1 인데 **stderr 가 비어 있다.**
 * 무엇이 틀렸는지 알 수 없는 도구로 운영 DB 를 바꿀 수는 없다.
 *
 * 원장 스키마는 drizzle 과 **호환**으로 유지한다 — 나중에 `drizzle-kit` 을 다시 써도
 * 이미 적용된 것을 건너뛴다. (`id serial pk` · `hash text` · `created_at bigint`)
 *
 * 각 파일은 **하나의 트랜잭션**으로 적용한다. 중간에 실패하면 그 파일은 통째로 롤백된다.
 *
 *   npm run db:migrate          # 적용
 *   npm run db:migrate -- --dry # 무엇이 적용될지만 출력
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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

const DRY = process.argv.includes('--dry')

function clientConfig() {
  if (process.env.DB_AUTH !== 'iam') {
    const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL 이 없습니다')
    return { connectionString: url }
  }
  const host = process.env.PGHOST
  const region = process.env.AWS_REGION
  const database = process.env.PGDATABASE
  if (!host || !region || !database) throw new Error('PGHOST · AWS_REGION · PGDATABASE 가 필요합니다')

  const port = Number(process.env.PGPORT ?? 5432)
  const user = process.env.PGUSER_MIGRATE ?? 'icaros_migrator'
  const caPath = process.env.RDS_CA_BUNDLE_PATH
  const ca = process.env.RDS_CA_BUNDLE ?? (caPath && existsSync(caPath) ? readFileSync(caPath, 'utf8') : undefined)
  // 조용히 rejectUnauthorized:false 로 떨어지지 않는다 — 5432 가 인터넷에 열린 구성에서
  // CA 검증을 끄는 것은 암호화만 하고 신원 확인을 포기하는 것이다.
  if (!ca) throw new Error('RDS CA 번들이 필요합니다 — scripts/fetch-rds-ca.sh 를 실행하십시오')

  const password = execFileSync('aws', [
    'rds', 'generate-db-auth-token',
    '--profile', process.env.AWS_PROFILE ?? 'essentia',
    '--region', region, '--hostname', host, '--port', String(port), '--username', user,
  ], { encoding: 'utf8' }).trim()

  return { host, port, user, database, password, ssl: { ca, rejectUnauthorized: true } }
}

/** drizzle 이 쓰는 것과 같은 해시. 이미 적용된 파일을 다시 적용하지 않기 위해서다. */
const hashOf = (sql: string): string => createHash('sha256').update(sql).digest('hex')

async function main(): Promise<void> {
  const files = readdirSync('drizzle').filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) throw new Error('drizzle/*.sql 이 없습니다')

  const c = new Client(clientConfig())
  await c.connect()

  const publicBefore = Number((await c.query("select count(*)::int v from pg_tables where schemaname='public'")).rows[0].v)

  // 스키마 생성을 시도하지 않는다. `icaros_migrator` 에는 데이터베이스 CREATE 권한이 없고
  // (스키마는 이미 있으므로 필요도 없다), `create schema if not exists` 조차
  // **권한 검사가 먼저라 permission denied 로 죽는다.**
  // drizzle-kit 이 stderr 하나 없이 exit 1 로 끝난 것도 이 지점으로 보인다.
  const hasSchema = Number(
    (await c.query("select count(*)::int v from information_schema.schemata where schema_name='icaros'")).rows[0].v
  )
  if (hasSchema === 0) {
    throw new Error('icaros 스키마가 없습니다. 스키마·role 생성은 인프라 담당이 먼저 해야 합니다')
  }

  await c.query(`
    create table if not exists icaros.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )`)

  const applied = new Set<string>(
    (await c.query('select hash from icaros.__drizzle_migrations')).rows.map((r: { hash: string }) => r.hash)
  )

  let count = 0
  for (const f of files) {
    const sql = readFileSync(join('drizzle', f), 'utf8')
    const h = hashOf(sql)
    if (applied.has(h)) {
      console.log(`  건너뜀  ${f}`)
      continue
    }
    if (DRY) {
      console.log(`  적용예정 ${f}`)
      count += 1
      continue
    }
    // 파일 하나가 하나의 트랜잭션. 중간에 실패하면 통째로 롤백된다.
    try {
      await c.query('begin')
      // drizzle 이 넣는 구분자. 문장 단위로 쪼개야 일부 DDL 이 제대로 돈다.
      for (const stmt of sql.split('--> statement-breakpoint')) {
        const t = stmt.trim()
        if (t === '') continue
        // 같은 이유로 마이그레이션 안의 CREATE SCHEMA 도 건너뛴다.
        // 스키마는 인프라가 소유하고, 우리는 그 안에만 만든다.
        if (/^create\s+schema\b/i.test(t)) continue
        await c.query(t)
      }
      await c.query(
        'insert into icaros.__drizzle_migrations (hash, created_at) values ($1, $2)',
        [h, Date.now()]
      )
      await c.query('commit')
      console.log(`  적용    ${f}`)
      count += 1
    } catch (e) {
      await c.query('rollback')
      console.error(`\n  ✗ ${f} 실패 — 롤백됨`)
      console.error(`    ${e instanceof Error ? e.message : e}`)
      await c.end()
      process.exit(1)
    }
  }

  const publicAfter = Number((await c.query("select count(*)::int v from pg_tables where schemaname='public'")).rows[0].v)
  const icarosTables = Number((await c.query("select count(*)::int v from pg_tables where schemaname='icaros'")).rows[0].v)
  await c.end()

  console.log(`\n  ${DRY ? '적용 예정' : '적용'} ${count}개 · icaros 테이블 ${icarosTables}`)

  // ESSENTIA 는 ddl-auto: validate 로 기동한다. public 이 한 칸이라도 바뀌면 상대 API 가 죽는다.
  if (publicAfter !== publicBefore) {
    console.error(`\n  ✗ public 테이블 수가 ${publicBefore} → ${publicAfter} 로 바뀌었다`)
    console.error('    ESSENTIA API 가 기동하지 못할 수 있다 — 즉시 확인할 것')
    process.exit(1)
  }
  console.log(`  public 테이블 ${publicAfter} (변화 없음)`)
}

main().catch((e) => {
  console.error('  실패:', e instanceof Error ? e.message : e)
  process.exit(1)
})
