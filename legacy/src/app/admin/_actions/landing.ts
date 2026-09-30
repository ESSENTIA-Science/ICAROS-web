'use server'

/** 런타임 지정 위치에 대한 설명은 `_actions/rockets.ts` 상단 주석 참조. */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/guard'
import { db, schema } from '@/lib/db'
import { CONFLICT, DENIED, MALFORMED, fail, type ActionResult, type FormState } from './result'
import { formToRecord, normalizeNewlines, readList, stripThousands, zodSummary } from '../_lib/form'
import { isVersionToken, versionExpr } from '../_lib/version'
import { LANDING_FIELDS, LANDING_KEYS, type LandingField } from '../_data/landing'
import { adminHref } from '../_tabs'

/** 트랜잭션 밖으로 실패 원인을 옮기는 신호들. 문구는 호출부가 붙인다. */
class VersionConflict extends Error {}
class RowsMissing extends Error {
  readonly keys: readonly string[]
  constructor(keys: readonly string[]) {
    super('rows missing')
    this.keys = keys
  }
}

const MAX_LEN: Readonly<Record<LandingField['kind'], number>> = {
  text: 500,
  slogan: 300,
  multiline: 5000,
  list: 5000,
  number: 15,
}

/**
 * 필드 하나의 검증 규칙. 종류별로 다르지만 **결과는 항상 저장할 문자열**이다.
 *
 * `required` 는 소비처가 값 없이는 성립하지 않는 넷에만 붙어 있다 (`_data/landing.ts` 주석).
 * 나머지를 비울 수 있게 둔 것은, 공개 페이지가 빈 섹션을 통째로 접도록 이미 만들어져 있기 때문이다.
 */
function fieldSchema(field: LandingField): z.ZodType<string, string> {
  const max = MAX_LEN[field.kind]
  const base = z.string().max(max, `${max.toLocaleString('ko-KR')}자 이내로 입력해 주세요.`)

  if (field.kind === 'number') {
    return base
      .refine((v) => !field.required || v.trim() !== '', '값을 입력해 주세요.')
      .refine(
        (v) => v.trim() === '' || /^\d{1,12}$/.test(stripThousands(v)),
        '0 이상의 정수만 입력할 수 있습니다. (쉼표는 넣어도 됩니다)'
      )
  }

  return base
    .refine((v) => !field.required || v.trim() !== '', '값을 입력해 주세요.')
    .refine(
      (v) => field.kind !== 'slogan' || (v.match(/\*\*/g)?.length ?? 0) % 2 === 0,
      '강조 표기 **가 짝을 이루지 않습니다. 여는 **와 닫는 **를 모두 넣어 주세요.'
    )
}

/** 저장 직전 정규화. 검증을 통과한 값만 여기에 들어온다. */
function toStoredValue(field: LandingField, raw: string): string {
  if (field.kind === 'number') return stripThousands(raw).trim()
  if (field.kind === 'multiline' || field.kind === 'list') {
    return normalizeNewlines(raw)
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim()
  }
  return raw.trim()
}

/** 랜딩 카피는 Footer 를 통해 모든 공개 페이지에 걸린다 — 하위 라우트까지 통째로 무효화한다. */
function revalidateLanding(): void {
  revalidatePath('/', 'layout')
}

export async function saveLandingCopyAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const version = form.get('version')
  if (!isVersionToken(version)) return MALFORMED

  const record = formToRecord(form)

  /**
   * 카탈로그의 키가 **하나라도 폼에 없으면** 아무것도 저장하지 않는다 (F8).
   * 잘린 폼을 부분 반영하면 빠진 키가 예전 값을 그대로 두는 게 아니라,
   * 다음 저장 때 빈 입력으로 덮인다 — 레거시가 랜딩 카피를 통째로 날린 경로가 정확히 이것이다.
   */
  const values: Record<string, string> = {}
  const fieldErrors: Record<string, string> = {}
  let summary: string | null = null

  for (const field of LANDING_FIELDS) {
    const raw = record[field.key]
    if (raw === undefined) return MALFORMED

    const parsed = fieldSchema(field).safeParse(raw)
    if (!parsed.success) {
      fieldErrors[field.key] = zodSummary(parsed.error)
      summary ??= `${field.label}: ${zodSummary(parsed.error)}`
      continue
    }
    values[field.key] = toStoredValue(field, parsed.data)
  }

  if (summary !== null) return fail(summary, fieldErrors)

  try {
    await db.transaction(async (tx) => {
      // 버전 대조와 UPDATE 사이를 행 잠금으로 닫는다. 집계 대신 행별 토큰을 받아 JS 에서 최댓값을 잡는다 —
      // FOR UPDATE 는 집계 쿼리에 붙지 않고, 토큰은 ISO 형식이라 문자열 정렬이 곧 시각 정렬이다.
      const rows = await tx
        .select({
          key: schema.siteSettings.key,
          value: schema.siteSettings.value,
          v: versionExpr(schema.siteSettings.updatedAt),
        })
        .from(schema.siteSettings)
        .where(inArray(schema.siteSettings.key, [...LANDING_KEYS]))
        .for('update')

      const present = new Set(rows.map((r) => r.key))
      const missing = LANDING_KEYS.filter((k) => !present.has(k))
      if (missing.length > 0) throw new RowsMissing(missing)

      const current = rows.map((r) => r.v).sort().at(-1)
      if (current !== version) throw new VersionConflict()

      for (const row of rows) {
        const next = values[row.key]
        if (next === undefined || next === (row.value ?? '')) continue
        await tx
          .update(schema.siteSettings)
          .set({ value: next, updatedAt: sql`now()` })
          .where(eq(schema.siteSettings.key, row.key))
      }
    })
  } catch (err) {
    if (err instanceof VersionConflict) return CONFLICT
    if (err instanceof RowsMissing) {
      return fail(
        `설정 항목 ${err.keys.length}개가 DB 에 없어 저장을 중단했습니다: ${err.keys.join(', ')}`
      )
    }
    console.error('[admin] 랜딩 카피 저장 실패')
    return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  revalidateLanding()
  redirect(adminHref({ tab: 'landing', saved: 'copy' }))
}

const ORDER_SHAPE = /^\d{1,3}$/

export async function saveSectionsAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const version = form.get('version')
  if (!isVersionToken(version)) return MALFORMED

  const ids = readList(form, 'section.id')
  if (ids.length === 0 || new Set(ids).size !== ids.length) return MALFORMED

  const record = formToRecord(form)
  const desired = new Map<string, { enabled: boolean; sortOrder: number }>()

  for (const id of ids) {
    const enabled = record[`enabled.${id}`]
    const order = record[`order.${id}`]
    if (enabled === undefined || order === undefined) return MALFORMED
    if (enabled !== '0' && enabled !== '1') return MALFORMED
    if (!ORDER_SHAPE.test(order.trim())) {
      return fail('섹션 순서는 0~999 사이의 정수입니다.', { [`order.${id}`]: '0~999 사이의 정수' })
    }
    desired.set(id, { enabled: enabled === '1', sortOrder: Number(order.trim()) })
  }

  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: schema.pageSections.id,
          enabled: schema.pageSections.enabled,
          sortOrder: schema.pageSections.sortOrder,
          v: versionExpr(schema.pageSections.updatedAt),
        })
        .from(schema.pageSections)
        .for('update')

      // 폼이 알고 있는 섹션 집합과 DB 가 다르면 화면이 낡은 것이다. 부분 저장하지 않는다.
      if (rows.length !== desired.size || rows.some((r) => !desired.has(r.id))) {
        throw new VersionConflict()
      }

      const current = rows.map((r) => r.v).sort().at(-1)
      if (current !== version) throw new VersionConflict()

      for (const row of rows) {
        const next = desired.get(row.id)
        if (!next) continue
        if (next.enabled === row.enabled && next.sortOrder === row.sortOrder) continue
        await tx
          .update(schema.pageSections)
          .set({ enabled: next.enabled, sortOrder: next.sortOrder, updatedAt: sql`now()` })
          .where(eq(schema.pageSections.id, row.id))
      }
    })
  } catch (err) {
    if (err instanceof VersionConflict) return CONFLICT
    console.error('[admin] 섹션 설정 저장 실패')
    return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  revalidateLanding()
  redirect(adminHref({ tab: 'landing', saved: 'sections' }))
}
