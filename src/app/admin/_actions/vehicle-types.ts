'use server'

/**
 * 기체 분류(`vehicle_types`) CRUD Server Actions.
 *
 * 시리즈(`_actions/rocket-series.ts`)와 **의도적으로 같은 모양**이다 — 스키마가 같은 모양이라
 * 검증·낙관적 잠금·오류 문구 배선을 그대로 옮겨 올 수 있다. 새 패턴을 만들지 않는다.
 * 시리즈 쪽을 고칠 일이 생기면 여기도 같이 본다.
 *
 * 파일을 나눈 이유는 시리즈를 로켓에서 나눈 이유와 같다 — 분류는 시리즈보다도 덜 바뀐다.
 *
 * 런타임 지정은 여기가 아니라 이 액션을 호출하는 세그먼트(`admin/layout.tsx`·`page.tsx`)에 있다 —
 * `'use server'` 모듈은 async 함수 외의 export 를 허용하지 않는다.
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
 * 분류 id 형태. DB CHECK `vehicle_types_id_ck` 와 **같은 정규식**이다. 한쪽만 고치지 말 것.
 * 시리즈와 같은 이유로 대문자를 허용한다 — 두 테이블의 CHECK 가 글자 그대로 같다.
 */
const TYPE_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/

class VersionConflict extends Error {}
class RowGone extends Error {}
/** 마지막 남은 분류를 지우려 한 경우. FK 로는 막을 수 없어 액션이 직접 본다. */
class LastType extends Error {}

const createSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(
      TYPE_ID_SHAPE,
      '식별자는 영문·숫자로 시작하고 영문·숫자·하이픈만 쓸 수 있으며 1~32자여야 합니다. (예: uavs)'
    ),
  label: z
    .string()
    .trim()
    .min(1, '표시 이름을 입력해 주세요.')
    .max(80, '표시 이름은 80자 이내로 입력해 주세요.'),
  sortOrder: z.string().trim().regex(/^\d{1,4}$/, '정렬순서는 0~9999 사이의 정수입니다.'),
})

/** 수정에서는 `id` 를 받지 않는다 — 공개 URL(`/vehicles?type=…`)이라 바꾸면 링크가 죽는다. */
const updateSchema = createSchema.omit({ id: true })

/**
 * 분류를 고치면 `/vehicles` 의 첫 줄 탭이 통째로 바뀐다.
 * 경로가 `/vehicles` 인 이유와 `'page'` 인자를 빼면 안 되는 이유는 `rockets.ts` 의
 * 같은 이름 함수 주석에 있다 — 상세는 SSG 라 이 줄이 유일한 무효화 수단이다.
 */
function revalidateVehicles(): void {
  revalidatePath('/vehicles')
  revalidatePath('/vehicles/[slug]', 'page')
}

function describeWriteError(err: unknown): ActionResult {
  if (err instanceof VersionConflict) return CONFLICT
  if (err instanceof RowGone) {
    return fail('이 분류는 다른 곳에서 이미 삭제되었습니다. 목록으로 돌아가 주세요.')
  }

  const { code, constraint } = pgError(err)
  if (code === PG_UNIQUE_VIOLATION && constraint === 'vehicle_types_pkey') {
    return fail('같은 식별자의 분류가 이미 있습니다.', {
      id: '이미 사용 중인 식별자입니다.',
    })
  }

  console.error('[admin] 기체 분류 저장 실패')
  return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
}

const LIST_HREF = { tab: 'rockets', sub: 'types' } as const

export async function createVehicleTypeAction(
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
    await db.insert(schema.vehicleTypes).values({
      id: parsed.data.id,
      label: parsed.data.label,
      sortOrder: Number(parsed.data.sortOrder),
    })
  } catch (err) {
    return describeWriteError(err)
  }

  revalidateVehicles()
  redirect(adminHref({ ...LIST_HREF, saved: parsed.data.id }))
}

export async function updateVehicleTypeAction(
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
  if (typeof id !== 'string' || !TYPE_ID_SHAPE.test(id)) return MALFORMED

  const parsed = updateSchema.safeParse(formToRecord(form))
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), zodFieldErrors(parsed.error))
  }

  try {
    await db.transaction(async (tx) => {
      // "행이 없다" 와 "버전이 다르다" 를 갈라 놓는다 — 복구 방법이 서로 다르다.
      const before = await tx
        .select({ id: schema.vehicleTypes.id })
        .from(schema.vehicleTypes)
        .where(eq(schema.vehicleTypes.id, id))
        .for('update')

      if (!before[0]) throw new RowGone()

      /**
       * 이 행 하나의 토큰으로만 대조한다. 목록 전체의 집계 토큰(`maxVersionExpr`)을 여기에
       * 쓰면 한 분류를 고친 순간부터 나머지가 영원히 충돌로 막힌다.
       */
      const updated = await tx
        .update(schema.vehicleTypes)
        .set({
          label: parsed.data.label,
          sortOrder: Number(parsed.data.sortOrder),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.vehicleTypes.id, id),
            versionMatches(schema.vehicleTypes.updatedAt, version)
          )
        )
        .returning({ id: schema.vehicleTypes.id })

      if (!updated[0]) throw new VersionConflict()
    })
  } catch (err) {
    return describeWriteError(err)
  }

  revalidateVehicles()
  redirect(adminHref({ ...LIST_HREF, saved: id }))
}

export async function deleteVehicleTypeAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const id = form.get('id')
  if (typeof id !== 'string' || !TYPE_ID_SHAPE.test(id)) return MALFORMED

  try {
    await db.transaction(async (tx) => {
      const before = await tx
        .select({ id: schema.vehicleTypes.id })
        .from(schema.vehicleTypes)
        .where(eq(schema.vehicleTypes.id, id))
        .for('update')

      if (!before[0]) throw new RowGone()

      /**
       * 마지막 하나는 지우지 않는다 — 시리즈의 `LastSeries` 와 같은 사정이다.
       *
       * FK 가 막아 주는 것은 "시리즈가 붙어 있는 분류"뿐이다. 시리즈가 0개인 분류가 하나
       * 남았을 때 그것까지 지우면 `rocket_series.type_id` 가 NOT NULL 이라 **시리즈를 새로
       * 만들 수 없는 상태**가 되고, 시리즈가 없으면 기체도 만들 수 없다. 두 단계 위에서
       * 원인이 끊기므로 그 화면에서는 무엇이 잘못됐는지 보이지 않는다.
       */
      const [remaining] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.vehicleTypes)

      if ((remaining?.n ?? 0) <= 1) {
        throw new LastType()
      }

      await tx.delete(schema.vehicleTypes).where(eq(schema.vehicleTypes.id, id))
    })
  } catch (err) {
    if (err instanceof RowGone) return fail('이미 삭제된 분류입니다.')
    if (err instanceof LastType) {
      return fail(
        '마지막 분류는 삭제할 수 없습니다. 시리즈를 등록하려면 분류가 최소 하나 있어야 합니다.'
      )
    }

    /**
     * FK restrict (`rocket_series_type_id_vehicle_types_id_fk`). 목록이 시리즈 수를 보여 주므로
     * 보통 여기까지 오지 않지만, 확인 화면을 열어 둔 사이에 다른 탭에서 시리즈가 추가되면 도달한다.
     * DB 원문(`update or delete on table … violates foreign key constraint`)을 그대로 흘리지
     * 않는다 — 무엇을 해야 하는지가 들어 있지 않다.
     */
    const { code } = pgError(err)
    if (code === PG_FOREIGN_KEY_VIOLATION) {
      return fail(
        '이 분류에 시리즈가 남아 있어 삭제할 수 없습니다. 시리즈를 다른 분류로 옮기거나 먼저 삭제해 주세요.'
      )
    }

    console.error('[admin] 기체 분류 삭제 실패')
    return fail('삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  revalidateVehicles()
  redirect(adminHref({ ...LIST_HREF, saved: 'deleted' }))
}
