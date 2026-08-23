/**
 * 초기 관리자 발급 CLI (06 §8, H19). **일회성 운영 도구**다.
 *
 *   npm run bootstrap:admin -- --email admin@icaros.kr
 *   npm run bootstrap:admin -- --email admin@icaros.kr --generate --name "김건우"
 *
 * 규칙:
 * - 비밀번호는 **stdin 프롬프트로만** 받는다. `--password` 플래그는 제공하지 않는다 —
 *   셸 히스토리와 `ps` 출력에 평문이 남는다.
 * - `--generate` 는 CSPRNG 로 만들어 **stdout 에 1회만** 출력한다.
 * - 최소 12자만 검사한다 (NIST 800-63B — 문자 구성 규칙은 두지 않는다).
 * - 대상 DB 를 출력하고 확인을 받는다. **Production 실행은 사용자 승인 사항.**
 *
 * 금지: 기본 비밀번호, 이메일·비밀번호 하드코딩, 초기 비밀번호 커밋, Production 관리자 자동 생성.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

/**
 * `lib/auth/*` 는 전부 `import 'server-only'` 로 시작한다. 그 패키지는 `react-server`
 * export condition 이 없으면 import 시점에 throw 하도록 만들어져 있다 — 클라이언트 번들 유입을
 * 빌드 에러로 만드는 것이 목적이다.
 *
 * 스크립트는 번들이 아니므로 조건만 켜서 자신을 한 번 다시 띄운다.
 * 이렇게 하지 않으려면 이메일 정규화와 Argon2 파라미터를 여기 복제해야 하는데,
 * **그 복제본이 본체와 어긋나는 날 로그인이 조용히 깨진다.**
 */
const require_ = createRequire(import.meta.url)
if (!require_.resolve('server-only').endsWith('empty.js')) {
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, '--conditions=react-server', ...process.argv.slice(1)],
    { stdio: 'inherit' }
  )
  process.exit(child.status ?? 1)
}

const { Pool } = await import('pg')
const { normalizeEmail, looksLikeEmail } = await import('@/lib/auth/email')
const { hashPassword, MIN_PASSWORD_LENGTH } = await import('@/lib/auth/password')

// ── 인자 ────────────────────────────────────────────────────────────────────

if (process.argv.some((arg) => arg === '--password' || arg.startsWith('--password='))) {
  fail(
    '--password 플래그는 의도적으로 제공하지 않습니다. 셸 히스토리와 프로세스 목록에 평문이 남습니다.\n' +
      '프롬프트로 입력하거나 --generate 를 쓰십시오.'
  )
}

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    generate: { type: 'boolean', default: false },
  },
  strict: true,
})

if (!values.email) fail('사용법: npm run bootstrap:admin -- --email <주소> [--name <이름>] [--generate]')

const email = normalizeEmail(values.email)
if (!looksLikeEmail(email)) fail(`이메일 형태가 아닙니다: ${values.email}`)

const displayName = values.name?.trim() || null

// ── 대상 DB 확인 ────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!dbUrl) fail('DATABASE_URL 이 설정되지 않았습니다. `set -a && . .env.local && set +a` 후 다시 실행하십시오.')

console.log('')
console.log('  대상 DB   ', redactDbUrl(dbUrl))
console.log('  이메일    ', email)
console.log('  표시 이름 ', displayName ?? '(없음)')
console.log('')

const answer = await promptLine("이 DB 에 관리자를 생성합니다. 계속하려면 'yes' 를 입력하십시오: ")
if (answer !== 'yes') fail('취소했습니다.')

// ── 비밀번호 ────────────────────────────────────────────────────────────────

let password: string
let generated = false

if (values.generate) {
  password = randomBytes(24).toString('base64url') // 32자, 192비트
  generated = true
} else {
  password = await promptHidden('비밀번호 (화면에 표시되지 않습니다): ')
  const again = await promptHidden('비밀번호 확인: ')
  if (password !== again) fail('두 입력이 다릅니다.')
}

if ([...password].length < MIN_PASSWORD_LENGTH) {
  fail(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`)
}

// ── 생성 ────────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: dbUrl })
const client = await pool.connect()

try {
  const existing = await client.query<{ id: string }>(
    'select id from icaros.admin_users where lower(email) = $1',
    [email]
  )
  if (existing.rowCount) {
    fail(
      `이미 존재하는 관리자입니다: ${email}\n` +
        '비밀번호 재설정은 이 스크립트의 역할이 아닙니다 — 관리자 콘솔의 비밀번호 변경을 쓰십시오.'
    )
  }

  const passwordHash = await hashPassword(password)

  await client.query('begin')
  const inserted = await client.query<{ id: string }>(
    'insert into icaros.admin_users (email, password_hash, display_name) values ($1, $2, $3) returning id',
    [email, passwordHash, displayName]
  )
  const userId = inserted.rows[0]?.id
  if (!userId) throw new Error('관리자 생성에 실패했습니다')

  // 감사 로그에는 이메일과 경위만. 비밀번호·해시는 넣지 않는다 (06 §10).
  await client.query(
    "insert into icaros.auth_events (kind, email_attempted, user_id, detail) values ('bootstrap', $1, $2, $3::jsonb)",
    [email, userId, JSON.stringify({ source: 'scripts/bootstrap-admin.ts', generated })]
  )
  await client.query('commit')

  console.log('')
  console.log(`  생성 완료  ${email}  (id ${userId})`)
  if (generated) {
    console.log('')
    console.log(`  비밀번호   ${password}`)
    console.log('  ⚠ 다시 표시되지 않습니다. 지금 비밀번호 관리자에 옮기고,')
    console.log('    이 출력을 로그 파일로 리다이렉트하지 마십시오.')
  }
  console.log('')
} catch (error) {
  await client.query('rollback').catch(() => {})
  throw error
} finally {
  client.release()
  await pool.end()
}

// ── 도우미 ──────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`\n${message}\n`)
  process.exit(1)
}

/** 접속 문자열의 비밀번호는 절대 출력하지 않는다. 확인에 필요한 건 host/db/user 뿐이다. */
function redactDbUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const user = url.username ? `${url.username}@` : ''
    return `${url.protocol}//${user}${url.host}${url.pathname}`
  } catch {
    return '(파싱할 수 없는 DATABASE_URL)'
  }
}

async function promptLine(label: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(label)).trim()
  } finally {
    rl.close()
  }
}

/**
 * 에코 없이 한 줄 입력. readline 은 마스킹을 지원하지 않아 raw mode 로 직접 읽는다.
 * TTY 가 아니면 거부한다 — 파이프로 비밀번호를 흘려 넣는 경로를 만들지 않기 위해서다.
 */
async function promptHidden(label: string): Promise<string> {
  const { stdin, stdout } = process
  if (!stdin.isTTY) fail('대화형 터미널이 아닙니다. 비밀번호는 TTY 에서만 입력받습니다.')

  stdout.write(label)
  const wasRaw = stdin.isRaw
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')

  return new Promise<string>((resolve, reject) => {
    let value = ''

    const done = () => {
      stdin.off('data', onData)
      stdin.setRawMode(wasRaw)
      stdin.pause()
      stdout.write('\n')
    }

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          done()
          resolve(value)
          return
        }
        if (ch === '\u0003') {
          done()
          reject(new Error('중단되었습니다 (Ctrl-C)'))
          return
        }
        if (ch === '\u0004') {
          done()
          reject(new Error('입력이 종료되었습니다 (Ctrl-D)'))
          return
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1)
          continue
        }
        // 방향키 등 이스케이프 시퀀스가 비밀번호에 섞이지 않게 제어문자는 버린다.
        if (ch < ' ') continue
        value += ch
      }
    }

    stdin.on('data', onData)
  })
}
