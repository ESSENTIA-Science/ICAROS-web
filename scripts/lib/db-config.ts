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
  ssl?: { ca: string; rejectUnauthorized: true; servername?: string }
  max?: number
}

/**
 * 스크립트 풀 상한.
 *
 * **`pg` 의 기본값은 10 이다.** 그대로 두면 운영 스크립트를 하나 돌릴 때마다 RDS 슬롯 10개를
 * 잡을 수 있는 풀이 열린다. 실제로 동시에 쓰는 건 1~2개뿐인데(전 스크립트를 통틀어 동시 쿼리는
 * `export-posts.ts` 의 `Promise.all` 하나가 전부다) 상한만 크게 열려 있는 셈이다.
 *
 * 이 RDS 는 **ESSENTIA 와 공유**이고 `db.t4g.micro` 라 `max_connections` 가 ~112 다.
 * 2026-08-27 실측에서 5분 최대 커넥션이 **77** 까지 올라갔다 — 슬롯은 아껴야 하는 공유 자원이다.
 * 앱 쪽은 이미 인스턴스당 3으로 묶여 있다(`src/lib/db/connection.ts`). 스크립트만 예외일 이유가 없다.
 */
const SCRIPT_POOL_MAX = 3

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
    return { connectionString, max: SCRIPT_POOL_MAX }
  }

  const host = process.env.PGHOST
  const region = process.env.AWS_REGION
  const database = process.env.PGDATABASE
  if (!host || !region || !database) throw new Error('PGHOST · AWS_REGION · PGDATABASE 가 필요합니다')

  const port = Number(process.env.PGPORT ?? 5432)

  /**
   * SSM 포트포워딩 경유 (`15-infra-debt.md` §C4).
   *
   * 보안그룹이 us-east-1 EC2 대역으로 좁혀져 개발자 머신에서 5432 에 직접 못 붙는다.
   * ESSENTIA EC2 를 터널로 경유하면 붙지만, 그때 함정이 둘이다:
   *
   *   ① IAM 토큰은 **호스트명에 서명**된다 — `localhost` 로 발급하면 거부된다
   *   ② `rejectUnauthorized` 는 **접속한 호스트명**을 인증서와 대조한다 —
   *      `127.0.0.1` 로 붙으면 `ERR_TLS_CERT_ALTNAME_INVALID` 로 끊긴다
   *
   * `DB_TUNNEL_HOST` 에 실제 RDS 엔드포인트를 주면 둘 다 그 이름으로 처리한다.
   * **TLS 검증을 끄는 것이 아니다** — CA 검증도 호스트명 대조도 그대로 하고,
   * 대조 대상만 터널 반대편의 진짜 이름으로 맞춘다. `/etc/hosts` 를 건드릴 필요가 없다.
   */
  const tunnelHost = process.env.DB_TUNNEL_HOST?.trim()
  /** 토큰 발급·인증서 대조에 쓸 이름. 터널이면 반대편 실제 호스트다. */
  const certName = tunnelHost || host
  /** 토큰은 **RDS 가 실제로 듣는 포트**로 서명해야 한다. 터널의 로컬 포트가 아니다. */
  const tokenPort = tunnelHost ? Number(process.env.DB_TUNNEL_PORT ?? 5432) : port
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
    '--region', region, '--hostname', certName, '--port', String(tokenPort), '--username', user,
  ], { encoding: 'utf8' }).trim()

  return {
    host,
    port,
    user,
    database,
    password,
    ssl: { ca, rejectUnauthorized: true, servername: certName },
    max: SCRIPT_POOL_MAX,
  }
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
