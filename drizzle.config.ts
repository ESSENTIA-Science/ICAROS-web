import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { Config } from 'drizzle-kit'

/**
 * ICAROS 는 `icaros` 스키마만 소유한다 (DECISIONS D2).
 * `public` 은 ESSENTIA Flyway 단독 소유이며, ESSENTIA 는 ddl-auto: validate 로 기동하므로
 * `public` 에 낯선 객체가 생기면 상대 API 가 기동에 실패할 수 있다.
 *
 * `drizzle-kit push` 는 금지한다 — 라이브 DB 를 introspect 하기 때문이다.
 * generate + migrate 만 쓴다. generate 는 DB 에 접속하지 않고 out/ 스냅샷과만 비교하므로
 * ESSENTIA 테이블이 구조적으로 보이지 않는다.
 *
 * ⚠️ `drizzle-kit migrate` 는 **실패한 마이그레이션을 삼키고 exit 0 으로 끝난다.**
 * 적용 후 반드시 원장 행수 · `icaros` 테이블 수 · **`public` 테이블 수**를 직접 세라.
 * 세 번째가 특히 중요하다 — `public` 이 한 칸이라도 어긋나면 ESSENTIA API 가 기동 못 한다.
 */

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

const required = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set (DB_AUTH=iam)`)
  return v
}

/**
 * IAM 모드 자격증명.
 *
 * `drizzle-kit` 은 `password` 에 함수를 받지 않으므로 **설정 로드 시점에 한 번** 발급한다.
 * 토큰은 15분 유효하고 마이그레이션은 그보다 훨씬 빨리 끝난다.
 *
 * 마이그레이션은 런타임과 **다른 role** 을 쓴다 — `icaros_migrator` 는 DDL 권한이 있고
 * `icaros_app` 은 없다. 런타임 역할에 마이그레이션 role 을 주면 `icaros_app` 에서
 * DDL 을 뺀 의미가 사라진다.
 */
function iamCredentials() {
  const host = required('PGHOST')
  const port = Number(process.env.PGPORT ?? 5432)
  const database = required('PGDATABASE')
  const user = process.env.PGUSER_MIGRATE ?? 'icaros_migrator'
  const region = required('AWS_REGION')
  const profile = process.env.AWS_PROFILE ?? 'essentia'

  const token = execFileSync(
    'aws',
    [
      'rds', 'generate-db-auth-token',
      '--profile', profile,
      '--region', region,
      '--hostname', host,
      '--port', String(port),
      '--username', user,
    ],
    { encoding: 'utf8' }
  ).trim()

  const ca = process.env.RDS_CA_BUNDLE ?? readCaFile()
  if (!ca) {
    // 조용히 rejectUnauthorized:false 로 떨어지지 않는다. 5432 가 인터넷에 열린 구성에서
    // CA 검증을 끄는 것은 암호화만 하고 신원 확인을 포기하는 것이다.
    throw new Error('RDS_CA_BUNDLE 또는 RDS_CA_BUNDLE_PATH 가 필요합니다')
  }

  return { host, port, database, user, password: token, ssl: { ca, rejectUnauthorized: true } }
}

function readCaFile(): string | undefined {
  const p = process.env.RDS_CA_BUNDLE_PATH
  if (!p || !existsSync(p)) return undefined
  return readFileSync(p, 'utf8')
}

const useIam = process.env.DB_AUTH === 'iam'

export default {
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['icaros'],
  migrations: { schema: 'icaros', table: '__drizzle_migrations' },
  dbCredentials: useIam
    ? iamCredentials()
    : { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
} satisfies Config
