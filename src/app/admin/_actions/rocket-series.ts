'use server'

/**
 * 로켓 카테고리(시리즈) CRUD Server Actions.
 *
 * 로켓과 파일을 나눈 이유는 수명이 다르기 때문이다 — 카테고리는 거의 안 바뀌고 로켓은 자주 바뀐다.
 * 한 파일에 두면 카테고리 규칙을 고칠 때마다 로켓 저장 경로를 다시 읽어야 한다.
 *
 * 런타임 지정은 여기가 아니라 이 액션을 호출하는 세그먼트(`admin/layout.tsx`·`page.tsx`)에 있다 —
 * `'use server'` 모듈은 async 함수 외의 export 를 허용하지 않는다. `_actions/rockets.ts` 와 같다.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/guard'
import { db, schema } from '@/lib/db'
import { CONFLICT, DENIED, MALFORMED, fail, type ActionResult, type FormState } from './result'
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  formToRecord,
  pgError,
  zodFieldErrors,
  zodSummary,
} from '../_lib/form'
import { isVersionToken, versionMatches } from '../_lib/version'
import { adminHref } from '../_tabs'

/**
 * 카테고리 id 형태. 기존 데이터가 `A`·`B` 라 **대문자를 허용한다** —
 * 로켓 slug 규칙(영소문자만)을 그대로 가져오면 지금 있는 두 행이 규칙 위반이 된다.
 * DB CHECK `rocket_series_id_ck` 와 같은 정규식이다. 한쪽만 고치지 말 것.
 */
const SERIES_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/

class VersionConflict extends Error {}
class RowGone extends Error {}
/** 마지막 남은 카테고리를 지우려 한 경우. FK 로는 막을 수 없어 액션이 직접 본다. */
class LastSeries extends Error {}

const createSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(
      SERIES_ID_SHAPE,
      '식별자는 영문·숫자로 시작하고 영문·숫자·하이픈만 쓸 수 있으며 1~32자여야 합니다. (예: C, mv2)'
    ),
  label: z
    .string()
    .trim()
    .min(1, '표시 이름을 입력해 주세요.')
    .max(80, '표시 이름은 80자 이내로 입력해 주세요.'),
  sortOrder: z.string().trim().regex(/^\d{1,4}$/, '정렬순서는 0~9999 사이의 정수입니다.'),
})

/** 수정에서는 `id` 를 받지 않는다 — 공개 URL 이라 바꾸면 링크가 죽는다. */
const updateSchema = createSchema.omit({ id: true })

function revalidateRockets(): void {
  revalidatePath('/rocket')
  revalidatePath('/rocket/[slug]', 'page')
}

function describeWriteError(err: unknown): ActionResult {
  if (err instanceof VersionConflict) return CONFLICT
  if (err instanceof RowGone) {
    return fail('이 카테고리는 다른 곳에서 이미 삭제되었습니다. 목록으로 돌아가 주세요.')
  }

  const { code, constraint } = pgError(err)
  if (code === PG_UNIQUE_VIOLATION && constraint === 'rocket_series_pkey') {
    return fail('같은 식별자의 카테고리가 이미 있습니다.', {
      id: '이미 사용 중인 식별자입니다.',
    })
  }

  console.error('[admin] 로켓 카테고리 저장 실패')
  return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
}

const LIST_HREF = { tab: 'rockets', sub: 'series' } as const

export async function createRocketSeriesAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const parsed = createSchema.safeParse(formToRecord(form))
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), zodFieldErrors(parsed.error))
  }

  try {
    await db.insert(schema.rocketSeries).values({
      id: parsed.data.id,
      label: parsed.data.label,
      sortOrder: Number(parsed.data.sortOrder),
    })
  } catch (err) {
    return describeWriteError(err)
  }

  revalidateRockets()
  redirect(adminHref({ ...LIST_HREF, saved: parsed.data.id }))
}

export async function updateRocketSeriesAction(
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

  const id = form.get('id')
  if (typeof id !== 'string' || !SERIES_ID_SHAPE.test(id)) return MALFORMED

  const parsed = updateSchema.safeParse(formToRecord(form))
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), zodFieldErrors(parsed.error))
  }

  try {
    await db.transaction(async (tx) => {
      // "행이 없다" 와 "버전이 다르다" 를 갈라 놓는다 — 복구 방법이 서로 다르다.
      const before = await tx
        .select({ id: schema.rocketSeries.id })
        .from(schema.rocketSeries)
        .where(eq(schema.rocketSeries.id, id))
        .for('update')

      if (!before[0]) throw new RowGone()

      const updated = await tx
        .update(schema.rocketSeries)
        .set({
          label: parsed.data.label,
          sortOrder: Number(parsed.data.sortOrder),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.rocketSeries.id, id),
            versionMatches(schema.rocketSeries.updatedAt, version)
          )
        )
        .returning({ id: schema.rocketSeries.id })

      if (!updated[0]) throw new VersionConflict()
    })
  } catch (err) {
    return describeWriteError(err)
  }

  revalidateRockets()
  redirect(adminHref({ ...LIST_HREF, saved: id }))
}

export async function deleteRocketSeriesAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const id = form.get('id')
  if (typeof id !== 'string' || !SERIES_ID_SHAPE.test(id)) return MALFORMED

  try {
    await db.transaction(async (tx) => {
      const before = await tx
        .select({ id: schema.rocketSeries.id })
        .from(schema.rocketSeries)
        .where(eq(schema.rocketSeries.id, id))
        .for('update')

      if (!before[0]) throw new RowGone()

      /**
       * 마지막 하나는 지우지 않는다.
       *
       * FK 가 막아 주는 것은 "로켓이 붙어 있는 카테고리"뿐이다. 로켓이 0대인 카테고리가
       * 하나 남았을 때 그것까지 지우면 **로켓을 새로 만들 수 없는 상태**가 된다 —
       * 폼의 시리즈 select 에 고를 것이 없어지고, 그 화면에서는 원인이 보이지 않는다.
       */
      const [remaining] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.rocketSeries)

      if ((remaining?.n ?? 0) <= 1) {
        throw new LastSeries()
      }

      await tx.delete(schema.rocketSeries).where(eq(schema.rocketSeries.id, id))
    })
  } catch (err) {
    if (err instanceof RowGone) return fail('이미 삭제된 카테고리입니다.')
    if (err instanceof LastSeries) {
      return fail(
        '마지막 카테고리는 삭제할 수 없습니다. 로켓을 등록하려면 카테고리가 최소 하나 있어야 합니다.'
      )
    }

    // FK restrict. 목록이 개수를 보여 주므로 보통 여기까지 오지 않지만,
    // 확인 화면을 열어 둔 사이에 다른 탭에서 로켓이 추가되면 도달한다.
    const { code } = pgError(err)
    if (code === PG_FOREIGN_KEY_VIOLATION) {
      return fail(
        '이 카테고리에 로켓이 남아 있어 삭제할 수 없습니다. 로켓을 다른 카테고리로 옮기거나 먼저 삭제해 주세요.'
      )
    }

    console.error('[admin] 로켓 카테고리 삭제 실패')
    return fail('삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  revalidateRockets()
  redirect(adminHref({ ...LIST_HREF, saved: 'deleted' }))
}
