import 'server-only'

import { readFileSync } from 'node:fs'
import type { PoolConfig } from 'pg'

/**
 * DB 접속 설정. 두 모드가 있다.
 *
 *  - `password`  : 로컬 개발(docker postgres:17). `DATABASE_URL` 을 그대로 쓴다.
 *  - `iam`       : 배포. AWS RDS IAM 데이터베이스 인증 — **정적 비밀번호가 없다.**
 *                  15분 수명 토큰을 커넥션마다 발급한다.
 *
 * IAM 을 택한 이유(DECISIONS D20): 유출돼도 15분이면 만료되고, 폐기가
 * "DB 비밀번호 교체 + 전 서비스 재배포"가 아니라 "IAM 정책 한 줄"이다.
 * 그리고 우리는 이미 S3 용으로 Vercel OIDC 역할 수임을 채택했으므로(D5)
 * 같은 자격증명 경로를 재사용한다 — 새로 만들 게 없다.
 */
export type DbAuthMode = 'password' | 'iam'

export const authMode: DbAuthMode = process.env.DB_AUTH === 'iam' ? 'iam' : 'password'

/**
 * RDS CA 번들. `sslmode=require` 는 **암호화만 하고 서버 인증서를 검증하지 않는다** —
 * 5432 가 인터넷에 열려 있는 구성(D20)에서 그건 MITM 방어가 없다는 뜻이다.
 * 그래서 `verify-full` 에 해당하는 설정을 쓴다: CA 검증 + 호스트명 대조.
 *
 * 번들은 레포에 넣지 않고 경로나 PEM 본문으로 주입받는다.
 * 받는 법: `curl -o rds-ca.pem https://truststore.pki.rds.amazonaws.com/ap-northeast-2/ap-northeast-2-bundle.pem`
 */
function loadCaBundle(): string | undefined {
  const inline = process.env.RDS_CA_BUNDLE
  if (inline && inline.includes('BEGIN CERTIFICATE')) return inline

  const path = process.env.RDS_CA_BUNDLE_PATH
  if (!path) return undefined
  try {
    return readFileSync(path, 'utf8')
  } catch {
    throw new Error(`RDS_CA_BUNDLE_PATH 를 읽을 수 없습니다: ${path}`)
  }
}

/**
 * IAM 인증 토큰을 발급한다. `pg` 는 `password` 가 함수면 **커넥션마다** 호출하므로
 * 15분 만료를 따로 관리할 필요가 없다.
 *
 * `@aws-sdk/rds-signer` 를 동적 import 하는 이유: 로컬 개발(`password` 모드)에서는
 * 이 패키지가 없어도 앱이 떠야 한다. 정적 import 면 모듈 해석 단계에서 죽는다.
 */
async function generateAuthToken(host: string, port: number, user: string, region: string): Promise<string> {
  const { Signer } = await import('@aws-sdk/rds-signer')
  const signer = new Signer({ hostname: host, port, username: user, region })
  return signer.getAuthToken()
}

export function buildPoolConfig(): PoolConfig {
  if (authMode === 'password') {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not set')
    return {
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      // 우리 객체는 전부 icaros 스키마에 있다. public 을 search_path 에서 뺀다.
      options: '-c search_path=icaros',
    }
  }

  const host = required('PGHOST')
  const port = Number(process.env.PGPORT ?? 5432)
  const database = required('PGDATABASE')
  const user = required('PGUSER')
  const region = required('AWS_REGION')

  const ca = loadCaBundle()
  if (!ca) {
    // 여기서 조용히 `rejectUnauthorized: false` 로 떨어지면 안 된다.
    // 인터넷 경유 접속에서 CA 검증을 끄는 것은 암호화만 하고 신원 확인을 포기하는 것이다.
    throw new Error(
      'IAM 모드에는 RDS CA 번들이 필요합니다. RDS_CA_BUNDLE 또는 RDS_CA_BUNDLE_PATH 를 설정하세요.'
    )
  }

  return {
    host,
    port,
    database,
    user,
    // 함수로 넘기면 pg 가 커넥션마다 호출한다 → 15분 만료를 우리가 관리하지 않아도 된다.
    password: () => generateAuthToken(host, port, user, region),
    ssl: { ca, rejectUnauthorized: true, servername: host },
    // 서버리스는 인스턴스마다 풀이 생긴다. 인스턴스당 상한을 낮게 잡는다.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    options: '-c search_path=icaros',
  }
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set (DB_AUTH=iam)`)
  return v
}
