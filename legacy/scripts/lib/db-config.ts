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

/** `RDS_CA_BUNDLE_PATH` 가 가리키는 PEM. 없거나 못 읽으면 undefined. */
function readCaFile(): string | undefined {
  const p = process.env.RDS_CA_BUNDLE_PATH
  if (!p || !existsSync(p)) return undefined
  return readFileSync(p, 'utf8')
}

/**
 * 접속 주소가 루프백인가 — 로컬 docker 와 SSM 터널 입구가 여기 걸린다.
 * 원격에 평문으로 붙는 것만 막는 판정이라 파싱 실패는 원격으로 본다.
 * (`src/lib/db/connection.ts` 의 같은 함수와 판정이 일치해야 한다.)
 */
function isLoopbackTarget(connectionString: string): boolean {
  try {
    const h = new URL(connectionString).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
  } catch {
    return false
  }
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
    /**
     * **role 이 접속 문자열에 박혀 있다.** IAM 모드는 `PGUSER`/`PGUSER_MIGRATE` 로 갈랐지만
     * 비밀번호 모드에서는 사용자·비밀번호가 URL 안에 있으므로 URL 자체를 갈라야 한다.
     * `DATABASE_URL_MIGRATE` 가 없으면 앱 URL 로 떨어지는데, 그 role 에는 DDL 권한이 없어
     * `db:migrate` 가 permission denied 로 실패한다 — 조용히 잘못된 role 로 도는 것보다 낫다.
     */
    const connectionString =
      role === 'migrate'
        ? (process.env.DATABASE_URL_MIGRATE ??
          process.env.DATABASE_URL_UNPOOLED ??
          process.env.DATABASE_URL)
        : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)
    if (!connectionString) throw new Error('DATABASE_URL 이 없습니다')

    /**
     * TLS 는 접속 문자열이 아니라 **코드로** 넣는다 — 이유는 `src/lib/db/connection.ts` 의
     * 같은 자리에 적어 두었다(요약: `pg` 는 `sslmode=verify-full` 을 `require` 와 똑같이
     * `ssl:{}` 로만 파싱한다. 사설 CA 를 넣을 자리가 문자열에 없다).
     *
     * 원격인데 CA·servername 이 없으면 던진다(fail-closed). 로컬 docker 만 평문 통과.
     * SSM 터널을 쓰면 접속 주소는 `127.0.0.1` 이고 `PGSSL_SERVERNAME` 이 진짜 신원을 맡는다.
     */
    const ca = process.env.RDS_CA_BUNDLE ?? readCaFile()
    const servername = process.env.PGSSL_SERVERNAME

    if (ca && servername) {
      return {
        connectionString,
        ssl: { ca, rejectUnauthorized: true, servername },
        max: SCRIPT_POOL_MAX,
      }
    }
    if (!isLoopbackTarget(connectionString)) {
      throw new Error(
        '원격 DATABASE_URL 에는 TLS 설정이 필요합니다 — RDS_CA_BUNDLE(또는 _PATH)와 PGSSL_SERVERNAME 을 함께 설정하세요'
      )
    }
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
   * **의미는 `src/lib/db/connection.ts` 와 정확히 같다** — `PGHOST` 는 언제나 **진짜 RDS
   * 엔드포인트**이고, `PGTUNNEL_HOST`/`PGTUNNEL_PORT` 는 **실제로 접속할 주소**(터널 입구)다.
   *
   * 주소를 갈라 두는 이유는 함정이 둘이기 때문이다:
   *   ① IAM 토큰은 **호스트명에 서명**된다 — 로컬 주소로 발급하면 거부된다
   *   ② `rejectUnauthorized` 는 **인증서의 이름**을 본다 — 로컬 주소로 붙으면 불일치로 끊긴다
   *
   * 그래서 토큰 발급·인증서 대조는 `PGHOST` 로, 소켓 연결만 터널 주소로 한다.
   * **TLS 검증을 끄지 않는다** — `/etc/hosts` 도 `sslmode` 강등도 필요 없다.
   *
   * ⚠️ 한때 이 파일만 의미를 반대로 구현했다(`PGTUNNEL_HOST` 를 진짜 엔드포인트로 읽음).
   * 같은 이름에 뜻이 둘이면 이름이 둘인 것보다 나쁘다 — 설정은 맞는데 안 되는 상태가 된다.
   */
  // `??` 가 아니라 `||` — 빈 값(`PGTUNNEL_HOST=`)은 "터널 안 씀"으로 읽어야 한다.
  // `??` 로 두면 빈 문자열이 통과해 접속 호스트가 사라진다.
  const connectHost = process.env.PGTUNNEL_HOST || host
  const connectPort = process.env.PGTUNNEL_PORT ? Number(process.env.PGTUNNEL_PORT) : port
  const user =
    role === 'migrate'
      ? (process.env.PGUSER_MIGRATE ?? 'icaros_migrator')
      : (process.env.PGUSER ?? 'icaros_app')

  const ca = process.env.RDS_CA_BUNDLE ?? readCaFile()
  // 조용히 rejectUnauthorized:false 로 떨어지지 않는다 — 5432 가 인터넷에 열린 구성에서
  // CA 검증을 끄는 것은 암호화만 하고 신원 확인을 포기하는 것이다.
  if (!ca) throw new Error('RDS CA 번들이 필요합니다 — ./scripts/fetch-rds-ca.sh 를 실행하십시오')

  // 15분 수명 토큰. 스크립트는 그보다 훨씬 빨리 끝난다.
  const password = execFileSync('aws', [
    'rds', 'generate-db-auth-token',
    '--profile', process.env.AWS_PROFILE ?? 'essentia',
    // 토큰은 **진짜 엔드포인트·진짜 포트**로 서명한다. 터널 주소가 아니다.
    '--region', region, '--hostname', host, '--port', String(port), '--username', user,
  ], { encoding: 'utf8' }).trim()

  return {
    host: connectHost,
    port: connectPort,
    user,
    database,
    password,
    // 인증서 대조도 **진짜 엔드포인트 이름**으로. 접속 주소와 무관하다.
    ssl: { ca, rejectUnauthorized: true, servername: host },
    max: SCRIPT_POOL_MAX,
  }
}

/** 사람에게 보여줄 접속 대상. **비밀번호나 토큰을 절대 포함하지 않는다.** */
export function describeTarget(role: Role = 'app'): string {
  loadEnvLocal()
  if (process.env.DB_AUTH !== 'iam') {
    const url =
      (role === 'migrate' ? process.env.DATABASE_URL_MIGRATE : undefined) ??
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      ''
    try {
      const u = new URL(url)
      // 사용자명은 비밀이 아니다. 오히려 **잘못된 role 로 붙는 것**을 여기서 잡는다.
      const verify = process.env.PGSSL_SERVERNAME
      const tls = verify ? `TLS verify-full → ${verify}` : '평문'
      return `${u.hostname}:${u.port || 5432}${u.pathname} · role ${u.username || '(미지정)'} (비밀번호 인증 · ${tls})`
    } catch {
      return '(파싱할 수 없는 DATABASE_URL)'
    }
  }
  const user = role === 'migrate'
    ? (process.env.PGUSER_MIGRATE ?? 'icaros_migrator')
    : (process.env.PGUSER ?? 'icaros_app')
  return `${process.env.PGHOST}:${process.env.PGPORT ?? 5432}/${process.env.PGDATABASE} · role ${user} (IAM 토큰)`
}
