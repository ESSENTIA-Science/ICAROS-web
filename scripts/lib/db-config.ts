/**
 * CLI 스크립트 공용 DB 접속 설정.
 *
 * `src/lib/db/connection.ts` 를 재사용하지 않는 이유: 그쪽은 `server-only` 라
 * CLI 에서 import 하는 순간 throw 한다. 운영 도구가 앱 번들 제약에 묶이면
 * 정작 급할 때 못 쓴다. 그래서 별도로 두되, **여기 하나만** 둔다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

/** Next 는 .env.local 을 자동으로 읽지만 tsx 맨몸 실행은 안 읽는다. */
export function loadEnvLocal(): void {
  if (!existsSync('.env.local')) return
  for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    // 이미 설정된 환경변수를 덮어쓰지 않는다 — 셸이 준 값이 파일보다 우선이어야 한다.
    if (process.env[key] !== undefined) continue
    let v = line.slice(eq + 1).trim()
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
      v = v.slice(1, -1)
    }
    process.env[key] = v
  }
}

export type Role = 'app' | 'migrate'

export interface PgConfig {
  connectionString?: string
  host?: string
  port?: number
  user?: string
  database?: string
  password?: string
  ssl?: { ca: string; rejectUnauthorized: true }
}

/**
 * @param role  `app` = DML 만 (`icaros_app`) · `migrate` = DDL 포함 (`icaros_migrator`)
 *
 * 기본값을 `app` 으로 두는 이유: 대부분의 스크립트는 데이터만 다룬다.
 * 마이그레이션 role 을 기본으로 두면 DDL 권한을 안 써도 되는 작업이 늘 쥐게 된다.
 */
export function pgConfig(role: Role = 'app'): PgConfig {
  loadEnvLocal()

  if (process.env.DB_AUTH !== 'iam') {
    const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL 이 없습니다')
    return { connectionString }
  }

  const host = process.env.PGHOST
  const region = process.env.AWS_REGION
  const database = process.env.PGDATABASE
  if (!host || !region || !database) throw new Error('PGHOST · AWS_REGION · PGDATABASE 가 필요합니다')

  const port = Number(process.env.PGPORT ?? 5432)
  const user =
    role === 'migrate'
      ? (process.env.PGUSER_MIGRATE ?? 'icaros_migrator')
      : (process.env.PGUSER ?? 'icaros_app')

  const caPath = process.env.RDS_CA_BUNDLE_PATH
  const ca = process.env.RDS_CA_BUNDLE ?? (caPath && existsSync(caPath) ? readFileSync(caPath, 'utf8') : undefined)
  // 조용히 rejectUnauthorized:false 로 떨어지지 않는다 — 5432 가 인터넷에 열린 구성에서
  // CA 검증을 끄는 것은 암호화만 하고 신원 확인을 포기하는 것이다.
  if (!ca) throw new Error('RDS CA 번들이 필요합니다 — ./scripts/fetch-rds-ca.sh 를 실행하십시오')

  // 15분 수명 토큰. 스크립트는 그보다 훨씬 빨리 끝난다.
  const password = execFileSync('aws', [
    'rds', 'generate-db-auth-token',
    '--profile', process.env.AWS_PROFILE ?? 'essentia',
    '--region', region, '--hostname', host, '--port', String(port), '--username', user,
  ], { encoding: 'utf8' }).trim()

  return { host, port, user, database, password, ssl: { ca, rejectUnauthorized: true } }
}

/** 사람에게 보여줄 접속 대상. **비밀번호나 토큰을 절대 포함하지 않는다.** */
export function describeTarget(role: Role = 'app'): string {
  loadEnvLocal()
  if (process.env.DB_AUTH !== 'iam') {
    const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? ''
    try {
      const u = new URL(url)
      return `${u.hostname}:${u.port || 5432}${u.pathname} (비밀번호 인증)`
    } catch {
      return '(파싱할 수 없는 DATABASE_URL)'
    }
  }
  const user = role === 'migrate'
    ? (process.env.PGUSER_MIGRATE ?? 'icaros_migrator')
    : (process.env.PGUSER ?? 'icaros_app')
  return `${process.env.PGHOST}:${process.env.PGPORT ?? 5432}/${process.env.PGDATABASE} · role ${user} (IAM 토큰)`
}
