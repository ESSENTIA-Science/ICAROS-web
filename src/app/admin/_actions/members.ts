'use server'

/** 런타임 지정 위치에 대한 설명은 `_actions/rockets.ts` 상단 주석 참조. */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/guard'
import { db, schema } from '@/lib/db'
import { CONFLICT, DENIED, MALFORMED, fail, type ActionResult, type FormState } from './result'
import { emptyToNull, formToRecord, zodFieldErrors, zodSummary } from '../_lib/form'
import { isVersionToken, versionMatches } from '../_lib/version'
import { adminHref } from '../_tabs'

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const memberSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(80, '이름은 80자 이내로 입력해 주세요.'),
  role: z.string().trim().max(80, '역할은 80자 이내로 입력해 주세요.'),
  squad: z.string().trim().max(80, '부서는 80자 이내로 입력해 주세요.'),
  school: z.string().trim().max(120, '학교는 120자 이내로 입력해 주세요.'),
  sortOrder: z.string().trim().regex(/^\d{1,4}$/, '정렬순서는 0~9999 사이의 정수입니다.'),
  published: z.enum(['0', '1'], '공개 여부 값이 올바르지 않습니다.'),
})

type ParsedMember = z.infer<typeof memberSchema>

function toMemberValues(m: ParsedMember) {
  return {
    name: m.name,
    role: emptyToNull(m.role),
    squad: emptyToNull(m.squad),
    school: emptyToNull(m.school),
    sortOrder: Number(m.sortOrder),
    published: m.published === '1',
  }
}

function revalidateMembers(): void {
  revalidatePath('/member')
}

export async function createMemberAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const parsed = memberSchema.safeParse(formToRecord(form))
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), zodFieldErrors(parsed.error))
  }

  let created: string
  try {
    const rows = await db
      .insert(schema.members)
      .values(toMemberValues(parsed.data))
      .returning({ id: schema.members.id })
    const row = rows[0]
    if (!row) return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    created = row.id
  } catch {
    console.error('[admin] 부원 생성 실패')
    return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  revalidateMembers()
  redirect(adminHref({ tab: 'members', saved: created }))
}

export async function updateMemberAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const id = form.get('id')
  const version = form.get('version')
  if (typeof id !== 'string' || !UUID_SHAPE.test(id) || !isVersionToken(version)) return MALFORMED

  const parsed = memberSchema.safeParse(formToRecord(form))
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), zodFieldErrors(parsed.error))
  }

  try {
    const updated = await db
      .update(schema.members)
      .set({ ...toMemberValues(parsed.data), updatedAt: sql`now()` })
      .where(and(eq(schema.members.id, id), versionMatches(schema.members.updatedAt, version)))
      .returning({ id: schema.members.id })

    if (!updated[0]) return CONFLICT
  } catch {
    console.error('[admin] 부원 수정 실패')
    return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  revalidateMembers()
  redirect(adminHref({ tab: 'members', saved: id }))
}

export async function deleteMemberAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const id = form.get('id')
  if (typeof id !== 'string' || !UUID_SHAPE.test(id)) return MALFORMED

  try {
    const deleted = await db
      .delete(schema.members)
      .where(eq(schema.members.id, id))
      .returning({ id: schema.members.id })

    if (!deleted[0]) return fail('이미 삭제된 부원입니다.')
  } catch {
    console.error('[admin] 부원 삭제 실패')
    return fail('삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  revalidateMembers()
  redirect(adminHref({ tab: 'members', saved: 'deleted' }))
}
