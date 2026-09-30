/**
 * RDS 보안그룹의 **ICAROS 인바운드 허용 대역**을 AWS 공식 목록과 대조하고,
 * 정확히 일치시키는 변경 계획을 만든다. 기본은 **드라이런**이다.
 *
 *   npm run infra:sg-plan              # 계획만 출력 (아무것도 바꾸지 않는다)
 *   npm run infra:sg-plan -- --json    # 계획을 JSON 으로 (검토·보관용)
 *   npm run infra:sg-plan -- --apply --yes
 *
 * ## 왜 이게 필요한가
 *
 * Vercel Fluid Compute 는 **고정 egress IP 가 없다.** 그래서 5432 인바운드를
 * "us-east-1 EC2 대역 전체"로 열어 두는 방식으로 버텨 왔는데, 그 목록이 295개
 * 프리픽스다. 보안그룹 규칙 상한은 60개라 들어가지 않는다.
 *
 * 그래서 지금은 **넓은 supernet 으로 뭉쳐 59개**로 욱여넣은 상태다. 실측(2026-08-28):
 *
 * | | |
 * |---|---|
 * | 규칙 | 59개 (+ ESSENTIA EC2 SG 참조 1 = 60, **만석**) |
 * | 커버 | 21,053,440 IP |
 * | 공식 us-east-1 EC2 | 295 프리픽스 / 21,519,008 IP |
 * | **미커버** | **465,568 IP (175개 블록)** |
 *
 * 즉 **뭉쳤는데도 2.2% 가 빈다.** 그 구멍에 걸린 Vercel 인스턴스는 조용히 타임아웃 나고
 * RDS 로그에도 안 남는다 (D27). 규칙을 다 쓰고도 정확하지 않은 상태다.
 *
 * ## 왜 CIDR 산수로는 안 되는가
 *
 * 과잉포함 0으로 인접 병합만 하면 **234개**다. 60에 넣으려면 이만큼 넓혀야 한다:
 *
 * | supernet 상한 | 규칙 | 커버 IP | 목표 대비 |
 * |---|---|---|---|
 * | /16 | 124 | 26.1M | 1.22x |
 * | /13 | 98 | 64.5M | 3.00x |
 * | /11 | 75 | 192.9M | 8.97x |
 * | /9 | 50 | 528.5M | **24.6x** |
 *
 * 60개 밑으로 내려가려면 목표의 **25배**를 열어야 한다. 산수로 푸는 문제가 아니다.
 *
 * ## 그럼 어떻게 줄이나 — 이 스크립트가 하는 일
 *
 * 규칙 **수**를 줄이는 게 아니라 **정확하게** 만든다(59 → 234, 구멍 0).
 * 보안그룹은 RDS 인스턴스에 최대 5개까지 붙으므로 5×60 = 300 이면 234가 들어간다 —
 * **쿼터 상향 신청 없이 오늘 가능하다.** 쿼터(`L-0EA8095F`, 조정 가능)를 올리면
 * 보안그룹 수를 줄일 수 있고, 그건 관리 편의 문제지 가능/불가능 문제가 아니다.
 *
 * 규칙 수 자체를 **한 자릿수로** 줄이는 길은 IP 허용목록을 그만두는 것뿐이다.
 * 그 선택지들은 `--advice` 로 출력한다.
 *
 * ## 안전장치
 *
 * - 기본 드라이런. `--apply` 는 `--yes` 와 함께여야 동작한다.
 * - **`MARKER` 로 시작하는 설명이 붙은 규칙만** 건드린다. ESSENTIA 의 SG 참조 규칙 등
 *   그 밖의 것은 읽고 보고만 하고 절대 지우지 않는다.
 * - 적용 전 현재 규칙 전체를 롤백 파일로 저장한다.
 * - **추가를 먼저, 삭제를 나중에** 한다. 반대로 하면 그 사이 창에서 프로덕션이 끊긴다.
 * - 식별자를 코드에 박지 않는다(공개 레포). 전부 환경변수·조회로 얻는다.
 *
 * 필요한 환경변수: `AWS_REGION`, `AWS_PROFILE`(선택),
 * `RDS_INSTANCE_ID`(없으면 인스턴스가 하나일 때 자동), `RDS_EXTRA_SG_IDS`(선택, 쉼표 구분)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

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

/** 이 문자열로 시작하는 설명이 붙은 규칙만 이 스크립트의 관리 대상이다. */
const MARKER = 'ICAROS Vercel egress'
const AWS_RANGES_URL = 'https://ip-ranges.amazonaws.com/ip-ranges.json'
/** Vercel 함수가 도는 리전. 여기 EC2 대역이 우리 egress 다. */
const VERCEL_REGION = 'us-east-1'
const PORT = 5432

const argv = process.argv.slice(2)
const has = (f: string) => argv.includes(f)
const APPLY = has('--apply')
const YES = has('--yes')
const JSON_OUT = has('--json')
const ADVICE = has('--advice')

const region = process.env.AWS_REGION
if (!region) fatal('AWS_REGION 이 없습니다 (.env.local 확인)')
const profileArgs = process.env.AWS_PROFILE ? ['--profile', process.env.AWS_PROFILE] : []

function fatal(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function aws(args: readonly string[]): unknown {
  const out = execFileSync('aws', [...args, '--region', region!, ...profileArgs, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
  return JSON.parse(out) as unknown
}

/* ── IPv4 CIDR 유틸 ────────────────────────────────────────────────────────
   ipaddress 같은 표준 모듈이 Node 에 없어 직접 만든다. 32비트라 숫자로 다뤄도
   안전하다 — 다만 `<<` 는 32비트 부호 연산이라 시프트 대신 곱셈·나눗셈을 쓴다. */

type Cidr = { readonly base: number; readonly len: number }

const toInt = (ip: string): number => {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`잘못된 IPv4: ${ip}`)
  }
  return p[0]! * 2 ** 24 + p[1]! * 2 ** 16 + p[2]! * 2 ** 8 + p[3]!
}
const toIp = (n: number): string =>
  [Math.floor(n / 2 ** 24) % 256, Math.floor(n / 2 ** 16) % 256, Math.floor(n / 2 ** 8) % 256, n % 256].join('.')

const size = (len: number): number => 2 ** (32 - len)

function parseCidr(s: string): Cidr | null {
  const [ip, l] = s.split('/')
  if (!ip || l === undefined) return null
  const len = Number(l)
  if (!Number.isInteger(len) || len < 0 || len > 32) return null
  let base: number
  try {
    base = toInt(ip)
  } catch {
    return null
  }
  // 호스트 비트가 켜져 있으면 네트워크 주소로 내린다
  return { base: base - (base % size(len)), len }
}

const fmt = (c: Cidr): string => `${toIp(c.base)}/${c.len}`
const end = (c: Cidr): number => c.base + size(c.len) - 1

/** 인접·중복 블록을 합친다. 과잉포함 0. */
function collapse(list: readonly Cidr[]): Cidr[] {
  let cur = [...list].sort((a, b) => a.base - b.base || a.len - b.len)
  for (;;) {
    // 포함 관계 제거
    const kept: Cidr[] = []
    for (const c of cur) {
      const last = kept[kept.length - 1]
      if (last && end(last) >= end(c) && last.base <= c.base) continue
      kept.push(c)
    }
    // 형제(sibling) 병합
    const merged: Cidr[] = []
    let changed = false
    for (let i = 0; i < kept.length; i++) {
      const a = kept[i]!
      const b = kept[i + 1]
      if (b && a.len === b.len && a.len > 0 && a.base % size(a.len - 1) === 0 && b.base === a.base + size(a.len)) {
        merged.push({ base: a.base, len: a.len - 1 })
        i++
        changed = true
      } else {
        merged.push(a)
      }
    }
    cur = merged
    if (!changed) return cur
  }
}

/** `target` 에서 `covers` 가 덮는 부분을 뺀 나머지. */
function uncovered(target: readonly Cidr[], covers: readonly Cidr[]): Cidr[] {
  const cov = collapse(covers).sort((a, b) => a.base - b.base)
  const out: Cidr[] = []
  for (const t of target) {
    let ranges: Array<[number, number]> = [[t.base, end(t)]]
    for (const c of cov) {
      const next: Array<[number, number]> = []
      for (const [s, e] of ranges) {
        if (end(c) < s || c.base > e) {
          next.push([s, e])
          continue
        }
        if (c.base > s) next.push([s, c.base - 1])
        if (end(c) < e) next.push([end(c) + 1, e])
      }
      ranges = next
    }
    for (const [s, e] of ranges) out.push(...rangeToCidrs(s, e))
  }
  return collapse(out)
}

function rangeToCidrs(start: number, stop: number): Cidr[] {
  const out: Cidr[] = []
  let s = start
  while (s <= stop) {
    let len = 32
    while (len > 0) {
      const bigger = len - 1
      if (s % size(bigger) !== 0 || s + size(bigger) - 1 > stop) break
      len = bigger
    }
    out.push({ base: s, len })
    s += size(len)
  }
  return out
}

const totalIps = (list: readonly Cidr[]): number => list.reduce((a, c) => a + size(c.len), 0)
const n = (v: number): string => v.toLocaleString('en-US')

/* ── 데이터 수집 ──────────────────────────────────────────────────────────── */

type SgRule = {
  SecurityGroupRuleId: string
  GroupId: string
  IsEgress: boolean
  IpProtocol: string
  FromPort: number
  ToPort: number
  CidrIpv4?: string
  Description?: string
  ReferencedGroupInfo?: { GroupId?: string }
}

async function fetchAwsPrefixes(): Promise<{ token: string; ec2: Cidr[] }> {
  const res = await fetch(AWS_RANGES_URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) fatal(`AWS ip-ranges.json 을 받지 못했습니다 (HTTP ${res.status})`)
  const body = (await res.json()) as {
    syncToken: string
    prefixes: Array<{ ip_prefix: string; region: string; service: string }>
  }
  const raw = body.prefixes
    .filter((p) => p.region === VERCEL_REGION && p.service === 'EC2')
    .map((p) => parseCidr(p.ip_prefix))
    .filter((c): c is Cidr => c !== null)
  return { token: body.syncToken, ec2: collapse(raw) }
}

function resolveSgIds(): string[] {
  const extra = (process.env.RDS_EXTRA_SG_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const id = process.env.RDS_INSTANCE_ID
  const args = ['rds', 'describe-db-instances', '--query', 'DBInstances[].VpcSecurityGroups[].VpcSecurityGroupId']
  if (id) args.splice(2, 0, '--db-instance-identifier', id)

  const ids = aws(args) as string[]
  if (ids.length === 0) fatal('RDS 인스턴스의 보안그룹을 찾지 못했습니다. RDS_INSTANCE_ID 를 지정하세요.')
  return [...new Set([...ids, ...extra])]
}

function fetchRules(sgIds: readonly string[]): SgRule[] {
  const res = aws([
    'ec2',
    'describe-security-group-rules',
    '--filters',
    `Name=group-id,Values=${sgIds.join(',')}`,
    '--query',
    'SecurityGroupRules',
  ]) as SgRule[]
  return res
}

function quota(code: string): number | null {
  try {
    const q = aws(['service-quotas', 'get-service-quota', '--service-code', 'vpc', '--quota-code', code, '--query', 'Quota.Value']) as number
    return q
  } catch {
    return null
  }
}

/* ── 실행 ────────────────────────────────────────────────────────────────── */

const { token, ec2 } = await fetchAwsPrefixes()
const sgIds = resolveSgIds()
const rules = fetchRules(sgIds)

const inbound = rules.filter((r) => !r.IsEgress)
const managed = inbound.filter((r) => (r.Description ?? '').startsWith(MARKER) && r.CidrIpv4)
const foreign = inbound.filter((r) => !((r.Description ?? '').startsWith(MARKER) && r.CidrIpv4))

const current = managed
  .map((r) => parseCidr(r.CidrIpv4!))
  .filter((c): c is Cidr => c !== null)

const desired = ec2 // 과잉포함 0 인 정확한 목록
const currentSet = new Set(current.map(fmt))
const desiredSet = new Set(desired.map(fmt))

const toAdd = desired.filter((c) => !currentSet.has(fmt(c)))
const toRemove = managed.filter((r) => !desiredSet.has(fmt(parseCidr(r.CidrIpv4!)!)))
const gapBefore = uncovered(desired, current)
const overBefore = totalIps(collapse(current)) - (totalIps(desired) - totalIps(gapBefore))

const perSg = quota('L-0EA8095F')
const sgPerEni = quota('L-2AFB9258')
const capacity = perSg !== null && sgPerEni !== null ? perSg * sgPerEni : null
const needed = desired.length + foreign.length
const sgsNeeded = perSg !== null ? Math.ceil(needed / perSg) : null

console.log(`\nAWS ip-ranges syncToken ${token}`)
console.log(`보안그룹 ${sgIds.length}개 / 인바운드 규칙 ${inbound.length}개 (관리 대상 ${managed.length}, 그 외 ${foreign.length})`)
console.log(`\n── 현재 ──`)
console.log(`  허용 대역        ${current.length}개 / ${n(totalIps(collapse(current)))} IP`)
console.log(`  공식 us-east-1 EC2 ${desired.length}개 / ${n(totalIps(desired))} IP`)
console.log(`  ✗ 미커버         ${gapBefore.length}개 블록 / ${n(totalIps(gapBefore))} IP  ← 여기 걸린 인스턴스는 조용히 타임아웃`)
console.log(`  과잉포함         ${n(Math.max(0, overBefore))} IP`)

console.log(`\n── 계획 (정확히 일치시키기) ──`)
console.log(`  추가 ${toAdd.length}  ·  삭제 ${toRemove.length}  ·  유지 ${desired.length - toAdd.length}`)
console.log(`  적용 후 미커버 0, 과잉포함 0`)

console.log(`\n── 용량 ──`)
console.log(`  규칙/SG 쿼터 ${perSg ?? '?'} (조정 가능) · SG/ENI 쿼터 ${sgPerEni ?? '?'} → 총 ${capacity ?? '?'}`)
console.log(`  필요 ${needed}개 → 보안그룹 ${sgsNeeded ?? '?'}개 필요 (현재 ${sgIds.length}개 부착)`)
if (perSg !== null && sgsNeeded !== null && sgsNeeded > (sgPerEni ?? 0)) {
  console.log(`  ⚠ 현재 쿼터로는 부족하다. L-0EA8095F 상향 신청 필요.`)
} else if (sgsNeeded !== null && sgsNeeded > sgIds.length) {
  console.log(`  → 보안그룹 ${sgsNeeded - sgIds.length}개를 새로 만들어 RDS 에 추가 부착해야 한다 (쿼터 상향 불필요).`)
}

if (ADVICE) {
  console.log(`
── 규칙 수 자체를 줄이려면 (IP 허용목록을 그만두는 길) ──
  A. Vercel Secure Compute — 고정 egress IP. 규칙 2~3개면 끝. **Enterprise 전용**이라
     현재 개인 팀 플랜에서는 불가.
  B. RDS 를 인터넷에서 내린다 (PubliclyAccessible=false) + VPC 안으로 컴퓨트 이동.
     가장 옳은 끝 상태이고 가장 큰 변경.
  C. 인증형 프록시를 앞에 둔다 (VPC 안의 작은 API / RDS Proxy + 앱 토큰).
     경계가 IP 가 아니라 인증이 된다. 데이터 계층 재작성.
  D. 0.0.0.0/0 + IAM·TLS 만으로 방어 — **권하지 않는다.** RDS 를 ESSENTIA 와 공유하고
     있고 커넥션 슬롯 고갈이 이미 최대 현안(D26)이다. 슬롯 고갈은 인증 이전 단계라
     IAM 이 막지 못한다. 지금 허용목록의 실질 가치는 기밀성이 아니라 **가용성**이다.`)
}

const plan = {
  syncToken: token,
  generatedFor: { region, sgIds, port: PORT },
  add: toAdd.map(fmt),
  remove: toRemove.map((r) => ({ id: r.SecurityGroupRuleId, cidr: r.CidrIpv4, group: r.GroupId })),
  gapBefore: gapBefore.map(fmt),
  foreignRulesUntouched: foreign.map((r) => r.Description ?? r.SecurityGroupRuleId),
  capacity: { perSg, sgPerEni, needed, sgsNeeded },
}

if (JSON_OUT) writeFileSync('sg-plan.json', `${JSON.stringify(plan, null, 2)}\n`)

if (!APPLY) {
  console.log(`\n드라이런입니다. 아무것도 바꾸지 않았습니다.`)
  console.log(`적용: npm run infra:sg-plan -- --apply --yes`)
  console.log(`설명: npm run infra:sg-plan -- --advice`)
  process.exit(0)
}

if (!YES) fatal('--apply 는 --yes 와 함께 써야 합니다. 위 계획을 먼저 확인하세요.')
if (perSg === null) fatal('규칙 쿼터를 읽지 못해 용량 계산을 할 수 없습니다.')

/**
 * 롤백 파일을 **먼저** 쓴다. 이 파일이 없으면 적용을 시작하지 않는다 —
 * 되돌릴 방법을 확보하기 전에 공유 자원을 건드리지 않는다.
 */
writeFileSync(`sg-rollback-${token}.json`, `${JSON.stringify({ sgIds, inbound }, null, 2)}\n`)
console.log(`\n롤백 스냅샷 저장: sg-rollback-${token}.json (현재 인바운드 ${inbound.length}개)`)

/** SG 별 남은 자리. 아웃바운드는 별도 쿼터라 인바운드만 센다. */
const used = new Map<string, number>()
for (const id of sgIds) used.set(id, 0)
for (const r of inbound) used.set(r.GroupId, (used.get(r.GroupId) ?? 0) + 1)

function vpcOfRds(): string {
  const id = process.env.RDS_INSTANCE_ID
  const args = ['rds', 'describe-db-instances', '--query', 'DBInstances[0].DBSubnetGroup.VpcId']
  if (id) args.splice(2, 0, '--db-instance-identifier', id)
  const v = aws(args) as string | null
  if (!v) fatal('RDS 의 VPC 를 찾지 못했습니다.')
  return v
}

/**
 * 자리가 모자라면 보안그룹을 새로 만들어 RDS 에 **덧붙인다**(교체가 아니다).
 *
 * 보안그룹을 **전부 먼저 만들고 부착은 딱 한 번** 한다. 만들 때마다 `modify-db-instance` 를
 * 부르면 프로덕션 RDS 에 변경이 연속으로 들어가고, 앞 변경이 아직 `applying` 이면
 * 다음 호출이 `InvalidDBInstanceState` 로 떨어진다 — 그때 절반만 붙은 상태로 멈춘다.
 */
function ensureCapacity(needSlots: number): void {
  const free = () => [...used.values()].reduce((a, u) => a + Math.max(0, perSg! - u), 0)
  if (free() >= needSlots) return

  const rdsId = process.env.RDS_INSTANCE_ID
  if (!rdsId) fatal('보안그룹을 추가하려면 RDS_INSTANCE_ID 가 필요합니다 (실수로 다른 인스턴스를 고치지 않도록).')

  const vpc = vpcOfRds()
  const before = new Set(used.keys())

  while (free() < needSlots) {
    if (used.size >= (sgPerEni ?? 5)) {
      fatal(
        `보안그룹을 더 붙일 수 없습니다 (SG/ENI 쿼터 ${sgPerEni}). ` +
          `L-0EA8095F(규칙/SG) 상향을 신청하세요.`
      )
    }
    const idx = used.size
    const name = `icaros-vercel-egress-${idx}`
    const created = aws([
      'ec2',
      'create-security-group',
      '--group-name',
      name,
      '--description',
      `${MARKER} (overflow ${idx}) - managed by scripts/infra/rds-sg-plan.ts`,
      '--vpc-id',
      vpc,
      '--query',
      'GroupId',
    ]) as string
    console.log(`  + 보안그룹 생성 ${name} → ${created}`)
    used.set(created, 0)
  }

  /* RDS 의 SG 목록은 **덮어쓰기**다. 기존 것을 반드시 함께 넘긴다 —
     빠뜨리면 ESSENTIA 쪽 접근이 그 순간 끊긴다. */
  const all = [...used.keys()]
  const kept = all.filter((id) => before.has(id))
  if (kept.length !== before.size) fatal('기존 보안그룹이 목록에서 빠졌습니다. 중단합니다.')
  console.log(`  · 부착 목록: 기존 ${kept.length}개 유지 + 신규 ${all.length - kept.length}개`)
  aws([
    'rds',
    'modify-db-instance',
    '--db-instance-identifier',
    rdsId!,
    '--vpc-security-group-ids',
    ...all,
    '--apply-immediately',
    '--query',
    'DBInstance.DBInstanceIdentifier',
  ])
  console.log(`  + RDS 에 부착 (총 ${all.length}개)`)

  /* 부착이 실제로 반영될 때까지 기다린다. 반영 전에 규칙을 넣으면 그 규칙은
     아직 이 인스턴스에 적용되지 않는다 — "넣었는데 여전히 타임아웃"이 된다. */
  for (let i = 0; i < 30; i++) {
    const live = aws([
      'rds',
      'describe-db-instances',
      '--db-instance-identifier',
      rdsId!,
      '--query',
      'DBInstances[0].VpcSecurityGroups[?Status==`active`].VpcSecurityGroupId',
    ]) as string[]
    if (all.every((id) => live.includes(id))) {
      console.log(`  ✓ 부착 반영 확인 (${live.length}개 active)`)
      return
    }
    execFileSync('sleep', ['2'])
  }
  fatal('보안그룹 부착이 반영되지 않았습니다. AWS 콘솔에서 상태를 확인하세요.')
}

ensureCapacity(toAdd.length)

/* **추가를 먼저, 삭제를 나중에.** 순서를 뒤집으면 그 사이 창에서 실제 트래픽이 끊긴다. */
let added = 0
const chunkOf = <T>(a: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / size) }, (_, i) => a.slice(i * size, i * size + size))

const queue = [...toAdd]
for (const [gid, count] of used) {
  if (queue.length === 0) break
  const room = perSg - count
  if (room <= 0) continue
  const take = queue.splice(0, room)
  // AWS 는 한 호출에 여러 규칙을 받는다. 60개씩 끊어 보낸다.
  for (const batch of chunkOf(take, 60)) {
    const perms = batch.map((c) => ({
      IpProtocol: 'tcp',
      FromPort: PORT,
      ToPort: PORT,
      IpRanges: [{ CidrIp: fmt(c), Description: `${MARKER} - AWS ${VERCEL_REGION} EC2 (sync ${token})` }],
    }))
    aws([
      'ec2',
      'authorize-security-group-ingress',
      '--group-id',
      gid,
      '--ip-permissions',
      JSON.stringify(perms),
      '--query',
      'Return',
    ])
    added += batch.length
    console.log(`  + ${gid} 에 ${batch.length}개 추가 (누적 ${added}/${toAdd.length})`)
  }
  used.set(gid, count + take.length)
}
if (queue.length > 0) fatal(`자리가 부족해 ${queue.length}개를 넣지 못했습니다. 쿼터를 확인하세요.`)

/* 삭제는 **관리 대상만**. foreign 규칙(ESSENTIA SG 참조 등)은 애초에 목록에 없다. */
for (const batch of chunkOf(toRemove, 60)) {
  const byGroup = new Map<string, string[]>()
  for (const r of batch) {
    const arr = byGroup.get(r.GroupId) ?? []
    arr.push(r.SecurityGroupRuleId)
    byGroup.set(r.GroupId, arr)
  }
  for (const [gid, ids] of byGroup) {
    aws(['ec2', 'revoke-security-group-ingress', '--group-id', gid, '--security-group-rule-ids', ...ids, '--query', 'Return'])
    console.log(`  - ${gid} 에서 ${ids.length}개 삭제`)
  }
}

/* 적용 후 다시 읽어서 실제로 구멍이 0인지 확인한다. 계획대로 됐다고 믿지 않는다. */
const after = fetchRules([...used.keys()]).filter((r) => !r.IsEgress)
const afterCidrs = after
  .filter((r) => (r.Description ?? '').startsWith(MARKER) && r.CidrIpv4)
  .map((r) => parseCidr(r.CidrIpv4!))
  .filter((c): c is Cidr => c !== null)
const gapAfter = uncovered(desired, afterCidrs)

console.log(`\n── 적용 후 실측 ──`)
console.log(`  인바운드 ${after.length}개 (관리 대상 ${afterCidrs.length})`)
console.log(`  미커버 ${gapAfter.length}개 블록 / ${n(totalIps(gapAfter))} IP`)
if (gapAfter.length > 0) {
  console.error('✗ 구멍이 남았습니다. 롤백 파일로 되돌릴 수 있습니다.')
  process.exit(1)
}
console.log('✓ us-east-1 EC2 대역 전체가 정확히 커버됩니다.')
