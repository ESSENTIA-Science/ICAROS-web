import 'server-only'

import { z } from 'zod'

/**
 * FormData → 검증 입력.
 *
 * 파일 입력은 여기서 걸러진다(값이 문자열이 아니면 버린다) — 이 CMS 의 폼은 전부 텍스트다.
 * 중복 키는 마지막 값이 남는다. 배열이 필요한 곳(엔진 목록)은 `readList()` 를 따로 쓴다.
 */
export function formToRecord(form: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/** 같은 이름으로 반복 제출된 필드. 순서는 DOM 순서 그대로다. */
export function readList(form: FormData, name: string): string[] {
  return form.getAll(name).filter((v): v is string => typeof v === 'string')
}

/** zod 이슈를 `필드명 → 메시지` 로. 같은 필드에 이슈가 여러 개면 첫 번째만 보여 준다. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map((p) => String(p)).join('.')
    if (key !== '' && out[key] === undefined) out[key] = issue.message
  }
  return out
}

/** 이슈 하나를 대표 메시지로. 폼 상단 배너에 쓴다. */
export function zodSummary(error: z.ZodError): string {
  return error.issues[0]?.message ?? '입력값을 확인해 주세요.'
}

// ── pg 오류 ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * `pg` 가 던지는 오류의 SQLSTATE·제약명. 타입 단언 없이 좁힌다.
 * DB CHECK·UNIQUE 는 최후 방어선이라 실제로 걸리는 일이 드물지만,
 * 걸렸을 때 500 이 아니라 사람이 읽을 수 있는 문장이 나와야 한다.
 *
 * **`cause` 를 따라 내려가는 것이 핵심이다.** drizzle 은 원본 pg 오류를 `DrizzleQueryError`
 * 로 감싸서 던지기 때문에, 바깥 객체에는 `code` 도 `constraint` 도 없다.
 * 이걸 빼먹으면 UNIQUE 위반이 전부 "저장에 실패했습니다"로 뭉개진다.
 */
export function pgError(err: unknown): { code: string | null; constraint: string | null } {
  // 순환 참조가 있어도 멈추도록 깊이를 제한한다.
  for (let node: unknown = err, depth = 0; isRecord(node) && depth < 5; depth += 1) {
    const code = typeof node['code'] === 'string' ? node['code'] : null
    if (code !== null) {
      const constraint = typeof node['constraint'] === 'string' ? node['constraint'] : null
      return { code, constraint }
    }
    node = node['cause']
  }
  return { code: null, constraint: null }
}

export const PG_UNIQUE_VIOLATION = '23505'
export const PG_CHECK_VIOLATION = '23514'
export const PG_FOREIGN_KEY_VIOLATION = '23503'

// ── 숫자 필드 ───────────────────────────────────────────────────────────────

const DECIMAL_SHAPE = /^\d+(\.\d+)?$/

/** numeric(precision, scale) 에 실제로 들어가는지. 자릿수 초과는 DB 가 반올림하거나 거부한다. */
function fitsPrecision(value: string, precision: number, scale: number): boolean {
  const [intPartRaw = '', fracPart = ''] = value.split('.')
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '')
  return intPart.length <= precision - scale && fracPart.length <= scale
}

export type DecimalOptions = {
  precision: number
  scale: number
  /** true 면 0 을 허용하지 않는다 (스키마의 `> 0` CHECK 와 짝). */
  positive?: boolean
}

/**
 * 소수 스펙 입력. 비워 두면 "값 없음"이고 DB 에는 null 로 들어간다.
 *
 * 음수를 정규식 단계에서 통째로 막는 이유: 고도·길이·페이로드 셋 다 음수가 될 수 없어서
 * `-` 를 허용해 두면 "0 이상이어야 합니다"라는 두 번째 오류로 미루게 될 뿐이다.
 */
export function decimalField(o: DecimalOptions): z.ZodType<string, string> {
  const maxInt = o.precision - o.scale
  return z
    .string()
    .trim()
    .refine((v) => v === '' || DECIMAL_SHAPE.test(v), {
      message: '0 이상의 숫자만 입력할 수 있습니다. (예: 1500 또는 1500.25)',
    })
    .refine((v) => v === '' || fitsPrecision(v, o.precision, o.scale), {
      message: `정수부 ${maxInt}자리, 소수부 ${o.scale}자리까지 입력할 수 있습니다.`,
    })
    .refine((v) => v === '' || !o.positive || Number(v) > 0, {
      message: '0보다 커야 합니다.',
    })
}

/** 빈 문자열은 "값 없음". DB 의 nullable 컬럼과 1:1 로 맞춘다. */
export function emptyToNull(value: string): string | null {
  const v = value.trim()
  return v === '' ? null : v
}

/** 사람이 `3,200,000` 처럼 입력하는 일이 실제로 일어난다 (lib/content.ts toNumber 와 같은 이유). */
export function stripThousands(value: string): string {
  return value.replace(/[,\s_]/g, '')
}

/** 개행 정규화. 브라우저는 textarea 를 CRLF 로 보내는데 DB·렌더러는 LF 를 기대한다. */
export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}
