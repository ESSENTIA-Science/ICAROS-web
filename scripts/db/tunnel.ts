/**
 * 로컬에서 RDS 로 들어가는 **SSM 포트포워딩 터널**.
 *
 * ## 왜 터널인가 — SG 에 IP 를 넣는 길은 막혀 있다
 *
 * RDS 5432 인바운드는 us-east-1 EC2 대역으로만 열려 있다(D27). 개발 머신에서 붙으면
 * `ETIMEDOUT` 이고 **RDS 로그에도 안 남는다** — 증상이 타임아웃이라 코드를 의심하게 된다.
 *
 * 그렇다고 개발 머신 IP 를 SG 에 추가할 수 없다. 실측한 이유가 셋이다:
 *
 *  1. 그 SG 의 인바운드 규칙이 **이미 60개**다. 60은 규칙 수 상한이라 빈자리가 없다.
 *     하나를 지우면 그만큼의 Vercel 인스턴스가 조용히 타임아웃 난다.
 *  2. WARP/VPN 을 켜면 공인 IP 가 **다른 사용자와 공유되는 출구**가 된다. 그 IP 를 열면
 *     우리만 열리는 게 아니다.
 *  3. 그 IP 는 안정적이지도 않다 — 연속 호출 두 번에 마지막 옥텟이 바뀌는 것을 실측했다.
 *
 * 그래서 경계를 넓히는 대신 **이미 허용된 경로(VPC 안의 EC2)를 빌린다.** SSM 은 인바운드를
 * 열지 않는다 — 에이전트가 밖으로 나가서 만든 세션 위로 포트를 실어 나른다.
 *
 * ## 쓰는 법
 *
 *   터미널 1:  npm run db:tunnel
 *   터미널 2:  DB_AUTH=iam PGTUNNEL_HOST=127.0.0.1 PGTUNNEL_PORT=5433 npm run dev
 *
 * `db:migrate` · `db:verify` · `bootstrap:admin` 도 같은 앞자리를 붙이면 된다.
 * 늘 터널로 쓸 거면 `PGTUNNEL_HOST`·`PGTUNNEL_PORT` 를 `.env.local` 에 적어 두면 된다 —
 * 그러면 터널이 안 떠 있을 때 즉시 ECONNREFUSED 로 실패한다(타임아웃보다 낫다).
 *
 * **접속 주소만 터널로 가고 IAM 토큰 서명·TLS 호스트명은 실제 엔드포인트를 쓴다.**
 * 그 갈라짐은 `src/lib/db/connection.ts` 가 처리한다 — 이유도 거기 적혀 있다.
 *
 * ## 식별자를 코드에 박지 않는다
 *
 * 이 레포는 public 이다. 대상 인스턴스 id 도 RDS 엔드포인트도 여기 없다 —
 * `SSM_TUNNEL_TARGET` 이 있으면 그걸 쓰고, 없으면 **온라인 인스턴스가 정확히 하나일 때만**
 * 자동으로 고른다. 둘 이상이면 고르지 않고 멈춘다. 잘못된 인스턴스로 터널을 뚫는 것보다
 * 사람에게 묻는 편이 싸다.
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

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

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`✗ ${name} 가 없습니다 (.env.local 을 확인하세요)`)
    process.exit(1)
  }
  return v
}

const region = required('AWS_REGION')
const rdsHost = required('PGHOST')
const rdsPort = process.env.PGPORT ?? '5432'
const localPort = process.env.PGTUNNEL_PORT ?? '5433'

/** `--profile` 은 값이 있을 때만 붙인다 — 빈 문자열을 넘기면 aws CLI 가 프로필을 못 찾는다. */
const profileArgs = process.env.AWS_PROFILE ? ['--profile', process.env.AWS_PROFILE] : []

function aws(args: readonly string[]): string {
  return execFileSync('aws', [...args, '--region', region, ...profileArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** 온라인 인스턴스가 정확히 하나일 때만 고른다. 애매하면 고르지 않는다. */
function resolveTarget(): string {
  const explicit = process.env.SSM_TUNNEL_TARGET
  if (explicit) return explicit

  let ids: string[]
  try {
    const out = aws([
      'ssm',
      'describe-instance-information',
      '--filters',
      'Key=PingStatus,Values=Online',
      '--query',
      'InstanceInformationList[].InstanceId',
      '--output',
      'json',
    ])
    ids = JSON.parse(out) as string[]
  } catch (err) {
    console.error('✗ SSM 인스턴스 목록을 읽지 못했습니다. AWS 자격증명·권한을 확인하세요.')
    console.error(String(err instanceof Error ? err.message : err).slice(0, 400))
    process.exit(1)
  }

  if (ids.length === 1) return ids[0]!
  console.error(
    ids.length === 0
      ? '✗ SSM 으로 붙을 수 있는 온라인 인스턴스가 없습니다.'
      : `✗ 온라인 인스턴스가 ${ids.length}개입니다 — 어느 것으로 뚫을지 정할 수 없습니다.`
  )
  console.error('  SSM_TUNNEL_TARGET=i-xxxxxxxx 을 .env.local 에 적으세요.')
  process.exit(1)
}

const target = resolveTarget()

console.log(`▶ SSM 터널 — ${target} 경유, localhost:${localPort} → RDS:${rdsPort}`)
console.log('  다른 터미널에서:')
console.log(
  `    DB_AUTH=iam PGTUNNEL_HOST=127.0.0.1 PGTUNNEL_PORT=${localPort} npm run dev`
)
console.log('  Ctrl+C 로 종료합니다.\n')

const child = spawn(
  'aws',
  [
    'ssm',
    'start-session',
    '--target',
    target,
    '--document-name',
    'AWS-StartPortForwardingSessionToRemoteHost',
    '--parameters',
    JSON.stringify({ host: [rdsHost], portNumber: [rdsPort], localPortNumber: [localPort] }),
    '--region',
    region,
    ...profileArgs,
  ],
  { stdio: 'inherit' }
)

/* Ctrl+C 를 우리가 먼저 삼키지 않는다 — aws CLI 가 세션을 정상 종료해야 원격에 세션이
   남지 않는다. 자식이 끝난 코드를 그대로 물려준다. */
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
