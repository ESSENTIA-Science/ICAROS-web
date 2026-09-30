/**
 * 초기 관리자 발급 · 잠금 복구 CLI (06 §8, H19). **운영 도구**다.
 *
 *   npm run bootstrap:admin -- --email admin@icaros.kr
 *   npm run bootstrap:admin -- --email admin@icaros.kr --generate --name "김건우"
 *   npm run bootstrap:admin -- --email admin@icaros.kr --reactivate
 *   npm run bootstrap:admin -- --email admin@icaros.kr --reset-password --generate
 *
 * 복구 플래그가 필요한 이유: 비활성 관리자는 세션 판정 쿼리에서 즉시 막혀 콘솔로 들어갈 수 없다.
 * 이 경로가 없으면 유일한 복구 수단이 DB 직접 UPDATE 다.
 * 두 플래그는 함께 쓸 수 있다 (비활성 + 비밀번호 분실).
 *
 * 규칙:
 * - 비밀번호는 **stdin 프롬프트로만** 받는다. `--password` 플래그는 제공하지 않는다 —
 *   셸 히스토리와 `ps` 출력에 평문이 남는다.
 * - `--generate` 는 CSPRNG 로 만들어 **stdout 에 1회만** 출력한다.
 * - 최소 12자만 검사한다 (NIST 800-63B — 문자 구성 규칙은 두지 않는다).
 * - 대상 DB 와 수행할 동작을 출력하고 확인을 받는다. **Production 실행은 사용자 승인 사항.**
 *
 * 금지: 기본 비밀번호, 이메일·비밀번호 하드코딩, 초기 비밀번호 커밋, Production 관리자 자동 생성.
 */
import { spawnSync } from 'node:child_process'
import { describeTarget, loadEnvLocal, pgConfig } from './lib/db-config'
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
    reactivate: { type: 'boolean', default: false },
    'reset-password': { type: 'boolean', default: false },
  },
  strict: true,
})

const USAGE =
  '사용법:\n' +
  '  npm run bootstrap:admin -- --email <주소> [--name <이름>] [--generate]   신규 발급\n' +
  '  npm run bootstrap:admin -- --email <주소> --reactivate                   비활성 해제\n' +
  '  npm run bootstrap:admin -- --email <주소> --reset-password [--generate]  비밀번호 재설정'

if (!values.email) fail(USAGE)

const email = normalizeEmail(values.email)
if (!looksLikeEmail(email)) fail(`이메일 형태가 아닙니다: ${values.email}`)

const displayName = values.name?.trim() || null
const reactivate = values.reactivate === true
const resetPassword = values['reset-password'] === true
/** 복구 모드 = 기존 계정을 고친다. 기본 모드 = 새 계정을 만든다. 둘은 상호 배타다. */
const recovery = reactivate || resetPassword
/** 새 비밀번호를 정해야 하는 경우. 신규 발급은 항상, 복구는 --reset-password 일 때만. */
const needsPassword = !recovery || resetPassword

if (recovery && displayName) {
  fail('--name 은 신규 발급에서만 씁니다. 표시 이름 변경은 관리자 콘솔에서 하십시오.')
}
if (values.generate && !needsPassword) {
  fail('--generate 는 비밀번호를 정하는 경우에만 의미가 있습니다.')
}

const actions = recovery
  ? [
      // 이 시점엔 아직 현재 상태를 모른다. 단정하지 않고 조건부로 적는다.
      reactivate ? '비활성 상태면 해제 (is_active = true)' : null,
      resetPassword ? '비밀번호 재설정 + 전체 세션 폐기' : null,
    ]
      .filter((v): v is string => v !== null)
      .join(' · ')
  : '신규 관리자 생성'

// ── 대상 DB 확인 ────────────────────────────────────────────────────────────

loadEnvLocal()

// 관리자 발급은 **데이터**다. DML 만 있는 `icaros_app` 으로 붙는다 —
// 마이그레이션 role 을 쓰면 DDL 권한을 안 써도 되는 작업에 굳이 쥐게 된다.
const dbTarget = describeTarget('app')

console.log('')
console.log('  대상 DB   ', dbTarget)
console.log('  이메일    ', email)
console.log('  동작      ', actions)
if (!recovery) console.log('  표시 이름 ', displayName ?? '(없음)')
console.log('')

const answer = await promptLine("이 DB 에 위 동작을 수행합니다. 계속하려면 'yes' 를 입력하십시오: ")
if (answer !== 'yes') fail('취소했습니다.')

// ── 실행 ────────────────────────────────────────────────────────────────────

const pool = new Pool(pgConfig('app'))
const client = await pool.connect()

try {
  // 비밀번호 프롬프트 **전에** 모드가 성립하는지 본다 — 한참 입력하고 나서
  // "이미 존재합니다" 로 죽으면 그 입력이 통째로 버려진다.
  const existing = await client.query<{ id: string; is_active: boolean }>(
    'select id, is_active from icaros.admin_users where lower(email) = $1',
    [email]
  )
  const found = existing.rows[0]

  if (recovery && !found) {
    fail(`존재하지 않는 관리자입니다: ${email}\n신규 발급은 복구 플래그 없이 실행하십시오.`)
  }
  if (!recovery && found) {
    fail(
      `이미 존재하는 관리자입니다: ${email}\n` +
        '  --reactivate      비활성 상태 해제\n' +
        '  --reset-password  비밀번호 재설정 (전체 세션 폐기)\n' +
        '콘솔에 들어갈 수 있다면 콘솔의 비밀번호 변경을 쓰는 편이 낫습니다.'
    )
  }
  /**
   * `--reactivate` 가 **실제로 상태를 바꾸는가**.
   *
   * 이미 활성인 계정에 조건 없이 UPDATE 를 걸면 세 가지가 동시에 틀어진다:
   * ① 안내 문구와 실제 동작이 어긋나고 ② 권한 변경이 없었던 건이 `auth_events` 감사 집계에 섞이며
   * ③ `updated_at` 은 낙관적 잠금 후보 컬럼인데 의미 없이 bump 되어 남의 편집을 충돌로 만든다.
   * 그래서 상태가 바뀌는 경우에만 쓴다.
   */
  const willReactivate = reactivate && found?.is_active === false

  if (reactivate && found?.is_active) {
    console.log(`  (안내) ${email} 은 이미 활성 상태입니다. 아무것도 변경하지 않습니다.`)
  }

  let password = ''
  let generated = false

  if (needsPassword) {
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
  }

  const passwordHash = needsPassword ? await hashPassword(password) : null

  await client.query('begin')

  let userId: string

  if (found) {
    userId = found.id

    if (resetPassword) {
      // password_changed_at 갱신이 안전망이다 — revoke 가 실패해도 이전 세션은 §4 쿼리를 통과하지 못한다.
      await client.query(
        'update icaros.admin_users set password_hash = $2, password_changed_at = now(), updated_at = now() where id = $1',
        [userId, passwordHash]
      )
      await client.query(
        'update icaros.admin_sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
        [userId]
      )
      await client.query(
        "insert into icaros.auth_events (kind, email_attempted, user_id, detail) values ('password_changed', $1, $2, $3::jsonb)",
        [email, userId, JSON.stringify({ source: 'scripts/bootstrap-admin.ts', action: 'reset', generated })]
      )
    }

    if (willReactivate) {
      await client.query(
        'update icaros.admin_users set is_active = true, updated_at = now() where id = $1',
        [userId]
      )
      // ⚠ kind 오버로딩: CHECK 에 재활성화 값이 없어 `admin_deactivated` 를 빌려 쓰고
      //   `detail.action` 으로만 구분한다. 앱의 setAdminActive() 와 같은 규약이다 (06 §10).
      await client.query(
        "insert into icaros.auth_events (kind, email_attempted, user_id, detail) values ('admin_deactivated', $1, $2, $3::jsonb)",
        [email, userId, JSON.stringify({ source: 'scripts/bootstrap-admin.ts', action: 'reactivated' })]
      )
    }
  } else {
    const inserted = await client.query<{ id: string }>(
      'insert into icaros.admin_users (email, password_hash, display_name) values ($1, $2, $3) returning id',
      [email, passwordHash, displayName]
    )
    const id = inserted.rows[0]?.id
    if (!id) throw new Error('관리자 생성에 실패했습니다')
    userId = id

    // 감사 로그에는 이메일과 경위만. 비밀번호·해시는 넣지 않는다 (06 §10).
    await client.query(
      "insert into icaros.auth_events (kind, email_attempted, user_id, detail) values ('bootstrap', $1, $2, $3::jsonb)",
      [email, userId, JSON.stringify({ source: 'scripts/bootstrap-admin.ts', action: 'created', generated })]
    )
  }

  await client.query('commit')

  // 실제로 쓴 것만 결과로 말한다. `--reactivate` 가 no-op 이었다면 "복구 완료" 는 거짓말이다.
  const performed = [willReactivate ? '비활성 해제' : null, resetPassword ? '비밀번호 재설정' : null]
    .filter((v): v is string => v !== null)
    .join(' · ')

  console.log('')
  if (!recovery) {
    console.log(`  생성 완료  ${email}  (id ${userId})`)
  } else if (performed === '') {
    console.log(`  변경 없음  ${email}  (id ${userId}) — 이미 활성 상태라 손대지 않았습니다.`)
  } else {
    console.log(`  복구 완료  ${email}  (id ${userId})  ${performed}`)
  }
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
