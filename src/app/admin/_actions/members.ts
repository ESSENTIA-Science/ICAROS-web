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
import {
  MediaRejected,
  checkMediaAttachable,
  listAttachedMediaIds,
  mediaIdField,
  retireMedia,
  stampMediaEntity,
} from '../_lib/media'
import { isVersionToken, versionMatches } from '../_lib/version'
import { adminHref } from '../_tabs'

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 트랜잭션 안의 실패를 밖으로 옮기는 신호. 사용자 문구는 호출부가 붙인다. */
class VersionConflict extends Error {}
class RowMissing extends Error {}

/**
 * 대상 행이 아예 없는 경우. CONFLICT("새로고침해 최신 값을 확인")와 섞으면 안 된다 —
 * 새로고침하면 항목 자체가 사라져 있어서, 시킨 대로 해도 확인할 값이 없다.
 */
const MEMBER_GONE =
  '이 부원은 다른 곳에서 이미 삭제되었습니다. 저장할 대상이 없습니다 — 목록으로 돌아간 뒤 필요하면 다시 등록해 주세요.'

const memberSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(80, '이름은 80자 이내로 입력해 주세요.'),
  role: z.string().trim().max(80, '역할은 80자 이내로 입력해 주세요.'),
  squad: z.string().trim().max(80, '부서는 80자 이내로 입력해 주세요.'),
  school: z.string().trim().max(120, '학교는 120자 이내로 입력해 주세요.'),
  sortOrder: z.string().trim().regex(/^\d{1,4}$/, '정렬순서는 0~9999 사이의 정수입니다.'),
  published: z.enum(['0', '1'], '공개 여부 값이 올바르지 않습니다.'),
  // 업로드가 끝난 뒤의 media id. 빈 값은 "사진 없음"이고, 그때는 공개 페이지가 플레이스홀더를 쓴다 (E6).
  imageMediaId: mediaIdField(),
})

type ParsedMember = z.infer<typeof memberSchema>

function toMemberValues(m: ParsedMember) {
  return {
    name: m.name,
    role: emptyToNull(m.role),
    squad: emptyToNull(m.squad),
    school: emptyToNull(m.school),
    sortOrder: Number(m.sortOrder),
    imageMediaId: emptyToNull(m.imageMediaId),
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

  const image = emptyToNull(parsed.data.imageMediaId)

  let created: string
  try {
    created = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(schema.members)
        .values(toMemberValues(parsed.data))
        .returning({ id: schema.members.id })

      const row = rows[0]
      if (!row) throw new Error('insert returned no row')

      // id 가 DB 에서 생성되므로 검증이 insert 뒤로 온다. 거부하면 트랜잭션째 되돌아간다.
      const attach = image ? [image] : []
      const attachable = await checkMediaAttachable(tx, attach, 'member', row.id)
      if (!attachable.ok) throw new MediaRejected(attachable.message)
      await stampMediaEntity(tx, attach, 'member', row.id)

      return row.id
    })
  } catch (err) {
    if (err instanceof MediaRejected) return fail(err.message, { imageMediaId: err.message })
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

  const image = emptyToNull(parsed.data.imageMediaId)
  const attach = image ? [image] : []
  /** 이번 저장으로 떨어져 나간 사진. 커밋 뒤에만 정리한다. */
  let dropped: string[] = []

  try {
    await db.transaction(async (tx) => {
      /**
       * 이전 사진을 알아야 교체분을 정리할 수 있어 행을 **먼저 잠근다**.
       * 잠금 이후에는 읽기와 쓰기 사이가 열리지 않으므로 버전 대조를 UPDATE 안에 둔 채로도
       * 경합이 없고(F12), "행이 없다"와 "버전이 다르다"가 여기서 바로 갈린다 —
       * 두 경우의 복구 방법이 서로 다르기 때문에 뭉뚱그리면 안 된다.
       */
      const before = await tx
        .select({ imageMediaId: schema.members.imageMediaId })
        .from(schema.members)
        .where(eq(schema.members.id, id))
        .for('update')

      const previous = before[0]
      if (!previous) throw new RowMissing()

      const attachable = await checkMediaAttachable(tx, attach, 'member', id)
      if (!attachable.ok) throw new MediaRejected(attachable.message)

      const previousIds = await listAttachedMediaIds(tx, 'member', id)

      const updated = await tx
        .update(schema.members)
        .set({ ...toMemberValues(parsed.data), updatedAt: sql`now()` })
        .where(and(eq(schema.members.id, id), versionMatches(schema.members.updatedAt, version)))
        .returning({ id: schema.members.id })

      // 행은 잠근 채로 확인했으므로 0행은 버전 불일치 하나뿐이다.
      if (!updated[0]) throw new VersionConflict()

      await stampMediaEntity(tx, attach, 'member', id)

      const keep = new Set(attach)
      const out = new Set<string>()
      if (previous.imageMediaId && !keep.has(previous.imageMediaId)) out.add(previous.imageMediaId)
      for (const mediaId of previousIds) if (!keep.has(mediaId)) out.add(mediaId)
      dropped = [...out]
    })
  } catch (err) {
    if (err instanceof VersionConflict) return CONFLICT
    if (err instanceof RowMissing) return fail(MEMBER_GONE)
    if (err instanceof MediaRejected) return fail(err.message, { imageMediaId: err.message })
    console.error('[admin] 부원 수정 실패')
    return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  // 커밋 이후다 — 참조가 끊긴 것이 확정된 뒤라야 deleteMedia 의 참조 재확인이 통과한다 (I14).
  await retireMedia(dropped)

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

  let dropped: string[] = []

  try {
    await db.transaction(async (tx) => {
      const before = await tx
        .select({ imageMediaId: schema.members.imageMediaId })
        .from(schema.members)
        .where(eq(schema.members.id, id))
        .for('update')

      const previous = before[0]
      if (!previous) throw new RowMissing()

      // 참조를 끊는 것까지가 트랜잭션. media 행과 S3 객체는 커밋 뒤에 정리한다 (F6).
      const attachedBefore = await listAttachedMediaIds(tx, 'member', id)
      await tx.delete(schema.members).where(eq(schema.members.id, id))

      const out = new Set<string>(attachedBefore)
      if (previous.imageMediaId) out.add(previous.imageMediaId)
      dropped = [...out]
    })
  } catch (err) {
    if (err instanceof RowMissing) return fail('이미 삭제된 부원입니다.')
    console.error('[admin] 부원 삭제 실패')
    return fail('삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  await retireMedia(dropped)

  revalidateMembers()
  redirect(adminHref({ tab: 'members', saved: 'deleted' }))
}
