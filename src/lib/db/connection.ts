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
 * 동적 import 인 이유: 로컬 개발(`password` 모드)에서는 이 패키지들이 없어도 앱이 떠야 한다.
 * 정적 import 면 모듈 해석 단계에서 죽는다.
 *
 * **자격증명 경로가 환경마다 다르다.**
 *
 * - Vercel: OIDC 토큰을 **환경변수** `VERCEL_OIDC_TOKEN` 으로 준다.
 *   그런데 AWS SDK 기본 체인은 `AWS_WEB_IDENTITY_TOKEN_FILE`(파일)을 찾는다 —
 *   즉 **기본 체인만으로는 절대 못 붙는다.** `@vercel/functions/oidc` 의
 *   `awsCredentialsProvider` 가 그 환경변수를 읽어 역할을 수임해 준다.
 * - 로컬: `AWS_PROFILE` 이 있으므로 기본 체인이 그대로 동작한다.
 *
 * `AWS_ROLE_ARN` 이 있으면 Vercel 경로로 간다. 없으면 기본 체인.
 */
/**
 * 발급한 토큰을 재사용한다.
 *
 * `pg` 는 **커넥션마다** password 함수를 부른다. 캐시가 없으면 커넥션 하나가 열릴 때마다
 * OIDC 자격증명 수임 + RDS 서명이 한 번씩 돈다 — 랜딩은 쿼리 셋을 병렬로 던지므로
 * 첫 요청에서만 그 왕복이 세 번 겹친다. 실측 TTFB 0.5초의 상당 부분이 여기였다.
 *
 * RDS IAM 토큰은 서명 시각부터 **15분** 유효하다. 10분만 재사용해 5분을 여유로 남긴다 —
 * 만료 직전 토큰으로 커넥션을 열다 실패하는 쪽이, 몇 번 더 서명하는 것보다 나쁘다.
 *
 * 캐시는 모듈 스코프다. 서버리스 인스턴스 하나의 수명 동안만 살고, 인스턴스가 죽으면 같이 죽는다.
 */
const TOKEN_TTL_MS = 10 * 60 * 1000

let cachedToken: { key: string; token: string; expiresAt: number } | undefined

async function signAuthToken(
  host: string,
  port: number,
  user: string,
  region: string
): Promise<string> {
  const { Signer } = await import('@aws-sdk/rds-signer')
  const roleArn = process.env.AWS_ROLE_ARN

  if (roleArn) {
    const { awsCredentialsProvider } = await import('@vercel/functions/oidc')
    const signer = new Signer({
      hostname: host,
      port,
      username: user,
      region,
      credentials: awsCredentialsProvider({ roleArn }),
    })
    return signer.getAuthToken()
  }

  const signer = new Signer({ hostname: host, port, username: user, region })
  return signer.getAuthToken()
}

async function generateAuthToken(host: string, port: number, user: string, region: string): Promise<string> {
  const key = `${host}:${port}:${user}:${region}`
  const now = Date.now()
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > now) {
    return cachedToken.token
  }

  const token = await signAuthToken(host, port, user, region)
  cachedToken = { key, token, expiresAt: now + TOKEN_TTL_MS }
  return token
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

  /**
   * **로컬에서 RDS 를 쓰기 위한 터널 우회.** 배포에서는 둘 다 없고, 없으면 아무 일도 없다.
   *
   * RDS 5432 인바운드는 us-east-1 EC2 대역으로만 열려 있고 그 SG 는 이미 규칙 60개
   * (상한)에 꽉 차 있다. 개발 머신 IP 를 넣을 자리가 없고, 넣어서도 안 된다 —
   * WARP/VPN 을 켜면 공인 IP 가 **다른 사용자와 공유되는 출구**가 되고 몇 분 만에 바뀐다.
   * 그래서 SG 를 건드리는 대신 VPC 안의 EC2 를 통해 SSM 포트포워딩으로 들어간다
   * (`npm run db:tunnel`).
   *
   * **접속 주소만 터널로 돌리고 신원은 실제 엔드포인트로 유지한다.** 둘을 같이 바꾸면
   * 조용히 두 군데가 깨진다:
   *   - IAM 토큰은 **호스트명까지 서명에 들어간다.** `127.0.0.1` 로 서명하면 RDS 가 거부한다.
   *   - 서버 인증서의 CN/SAN 은 RDS 엔드포인트다. `servername` 을 터널 주소로 두면
   *     `verify-full` 검증이 실패한다 — 그렇다고 검증을 끄면 D20 의 전제가 무너진다.
   * Postgres 프로토콜 자체는 접속 주소를 신경 쓰지 않으므로, 주소만 갈라 두면 둘 다 산다.
   */
  const connectHost = process.env.PGTUNNEL_HOST ?? host
  const connectPort = process.env.PGTUNNEL_PORT ? Number(process.env.PGTUNNEL_PORT) : port

  const ca = loadCaBundle()
  if (!ca) {
    // 여기서 조용히 `rejectUnauthorized: false` 로 떨어지면 안 된다.
    // 인터넷 경유 접속에서 CA 검증을 끄는 것은 암호화만 하고 신원 확인을 포기하는 것이다.
    throw new Error(
      'IAM 모드에는 RDS CA 번들이 필요합니다. RDS_CA_BUNDLE 또는 RDS_CA_BUNDLE_PATH 를 설정하세요.'
    )
  }

  return {
    // 접속은 터널(있으면), 서명·인증서 검증은 실제 엔드포인트 — 위 주석 참조.
    host: connectHost,
    port: connectPort,
    database,
    user,
    // 함수로 넘기면 pg 가 커넥션마다 호출한다. 그 안에서 10분 캐시가 서명 왕복을 걷어낸다.
    password: () => generateAuthToken(host, port, user, region),
    ssl: { ca, rejectUnauthorized: true, servername: host },
    // 서버리스는 인스턴스마다 풀이 생긴다. 인스턴스당 상한을 낮게 잡는다.
    max: 3,
    /**
     * **10초를 60초로 올렸다가 프로덕션을 죽였다. 되돌린 값이다.**
     *
     * "인스턴스당 `max: 3` 이니 총량은 그대로"라고 판단했는데 틀렸다. Fluid Compute 는
     * 인스턴스를 **여러 개** 띄우고, 유휴 유지 시간이 6배가 되면 동시에 살아 있는 인스턴스가
     * 그만큼 겹친다. 게다가 이 RDS 는 ESSENTIA 와 **공유**라 우리 몫만 계산하면 안 됐다.
     * 결과는 `53300 remaining connection slots are reserved` — DB 를 읽는 라우트 전부 500.
     *
     * 서버리스에서 커넥션은 아껴야 하는 공유 자원이다. 지연을 줄이고 싶으면 커넥션을
     * 오래 붙잡는 쪽이 아니라 **접속 비용 자체를 줄이는 쪽**(위의 토큰 캐시)으로 간다.
     */
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
