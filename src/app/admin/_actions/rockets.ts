'use server'

/**
 * 로켓 CRUD Server Actions.
 *
 * 런타임 지정에 관하여: 라우트 세그먼트 설정(`export const runtime`)은 page/layout/route 파일에서만
 * 의미가 있고, `'use server'` 모듈은 **async 함수 외의 export 를 허용하지 않는다**
 * (next/dist/build/webpack/loaders/next-flight-loader/action-validate.js).
 * 그래서 Node 런타임은 이 액션들을 호출하는 세그먼트인 `app/admin/layout.tsx`·`page.tsx` 에서
 * 지정한다 — argon2·pg 가 걸린 인증 경로가 Edge 로 새지 않도록 하는 실제 지점은 거기다.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/guard'
import { db, schema } from '@/lib/db'
import {
  CONFLICT,
  DENIED,
  MALFORMED,
  fail,
  type ActionResult,
  type FormState,
} from './result'
import {
  PG_UNIQUE_VIOLATION,
  decimalField,
  emptyToNull,
  formToRecord,
  normalizeNewlines,
  pgError,
  readList,
  zodFieldErrors,
  zodSummary,
} from '../_lib/form'
import {
  MediaRejected,
  checkMediaAttachable,
  deleteGalleryOrder,
  listAttachedMediaIds,
  mediaIdField,
  parseGalleryIds,
  retireMedia,
  saveGalleryOrder,
  stampMediaEntity,
} from '../_lib/media'
import { isVersionToken, versionMatches } from '../_lib/version'
import { adminHref } from '../_tabs'

/** 트랜잭션 안에서 낙관적 잠금 실패를 밖으로 전달하는 신호. 사용자에게 보이는 문구는 CONFLICT 가 갖는다. */
class VersionConflict extends Error {}

/**
 * 대상 행이 아예 없는 경우. CONFLICT 와 섞으면 안 된다 — "새로고침해 최신 값을 확인"하라고
 * 해 놓고 새로고침하면 항목 자체가 없다.
 */
class RowGone extends Error {}

const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{1,47}$/

/** checkbox 는 꺼져 있으면 아예 전송되지 않는다. 폼이 hidden `0` 을 먼저 보내 값을 항상 명시한다. */
const MALFORMED_FLAG = '공개 여부 값이 올바르지 않습니다.'

const rocketSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(SLUG_SHAPE, '식별자는 영소문자·숫자·하이픈만 쓸 수 있고 2~48자여야 합니다. (예: icx2)'),
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(120, '이름은 120자 이내로 입력해 주세요.'),
  series: z.enum(['A', 'B'], '시리즈를 선택해 주세요.'),
  sortOrder: z.string().trim().regex(/^\d{1,4}$/, '정렬순서는 0~9999 사이의 정수입니다.'),
  maxAltitudeM: decimalField({ precision: 10, scale: 2 }),
  sizeM: decimalField({ precision: 10, scale: 3, positive: true }),
  payloadKg: decimalField({ precision: 10, scale: 3 }),
  descriptionMd: z.string().max(20000, '설명은 20,000자 이내로 입력해 주세요.'),
  published: z.enum(['0', '1'], MALFORMED_FLAG),
  // 업로드는 이미 끝난 상태로 온다. 여기 오는 건 그 결과인 media id 하나뿐이고, 빈 값은 "없음"이다.
  coverMediaId: mediaIdField(),
})


const engineSchema = z.object({
  type: z.string().trim().min(1, '엔진 종류를 입력해 주세요.').max(80, '엔진 종류는 80자 이내입니다.'),
  thrustN: decimalField({ precision: 10, scale: 2, positive: true }),
  burnTimeS: decimalField({ precision: 10, scale: 3, positive: true }),
  count: z.string().trim().regex(/^[1-9]\d{0,3}$/, '개수는 1 이상 9999 이하의 정수입니다.'),
  mode: z.string().trim().max(80, '연소 방식은 80자 이내입니다.'),
})

const MAX_ENGINES = 12

type ParsedRocket = z.infer<typeof rocketSchema>
type ParsedEngine = z.infer<typeof engineSchema>

type ParseOutcome =
  | { ok: true; rocket: ParsedRocket; engines: ParsedEngine[]; galleryIds: string[] }
  | { ok: false; result: ActionResult }

/**
 * 폼 → 검증된 값. DB CHECK 는 최후 방어선이지 유일한 방어선이 아니다 (01 §8 결함 #6).
 * 엔진은 같은 이름으로 반복 제출되는 평행 배열이라 길이가 어긋나면 즉시 거부한다.
 */
function parseRocketForm(form: FormData): ParseOutcome {
  const parsed = rocketSchema.safeParse(formToRecord(form))
  if (!parsed.success) {
    return { ok: false, result: fail(zodSummary(parsed.error), zodFieldErrors(parsed.error)) }
  }

  const types = readList(form, 'engine.type')
  const thrusts = readList(form, 'engine.thrustN')
  const burns = readList(form, 'engine.burnTimeS')
  const counts = readList(form, 'engine.count')
  const modes = readList(form, 'engine.mode')

  const lengths = new Set([types.length, thrusts.length, burns.length, counts.length, modes.length])
  if (lengths.size > 1) return { ok: false, result: MALFORMED }
  if (types.length > MAX_ENGINES) {
    return { ok: false, result: fail(`엔진은 최대 ${MAX_ENGINES}개까지 등록할 수 있습니다.`) }
  }

  const engines: ParsedEngine[] = []
  const fieldErrors: Record<string, string> = {}

  for (let i = 0; i < types.length; i += 1) {
    const row = engineSchema.safeParse({
      type: types[i] ?? '',
      thrustN: thrusts[i] ?? '',
      burnTimeS: burns[i] ?? '',
      count: counts[i] ?? '',
      mode: modes[i] ?? '',
    })
    if (row.success) {
      engines.push(row.data)
      continue
    }
    for (const [key, message] of Object.entries(zodFieldErrors(row.error))) {
      fieldErrors[`engine.${i}.${key}`] = message
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, result: fail('엔진 정보를 확인해 주세요.', fieldErrors) }
  }

  // 갤러리는 hidden 이 순서대로 반복 제출된다. 그 순서가 곧 공개 화면의 표시 순서다 (C7).
  const gallery = parseGalleryIds(readList(form, 'galleryMediaIds'))
  if (!gallery.ok) return { ok: false, result: fail(gallery.message) }

  return { ok: true, rocket: parsed.data, engines, galleryIds: gallery.ids }
}

/** 이 저장으로 로켓에 붙는 미디어 전부 — 대표 이미지 + 갤러리. 중복은 접는다. */
function attachedIds(parsed: { rocket: ParsedRocket; galleryIds: readonly string[] }): string[] {
  const cover = emptyToNull(parsed.rocket.coverMediaId)
  const ids = new Set<string>(parsed.galleryIds)
  if (cover) ids.add(cover)
  return [...ids]
}

function toRocketValues(r: ParsedRocket) {
  return {
    name: r.name,
    series: r.series,
    sortOrder: Number(r.sortOrder),
    maxAltitudeM: emptyToNull(r.maxAltitudeM),
    sizeM: emptyToNull(r.sizeM),
    payloadKg: emptyToNull(r.payloadKg),
    descriptionMd: emptyToNull(normalizeNewlines(r.descriptionMd)),
    coverMediaId: emptyToNull(r.coverMediaId),
    published: r.published === '1',
  }
}

function toEngineValues(rocketId: string, engines: readonly ParsedEngine[]) {
  return engines.map((e, index) => ({
    rocketId,
    type: e.type,
    thrustN: emptyToNull(e.thrustN),
    burnTimeS: emptyToNull(e.burnTimeS),
    count: Number(e.count),
    mode: emptyToNull(e.mode),
    sortOrder: index,
  }))
}

/** 공개 로켓 화면 전부. 지금은 force-dynamic 이라 즉시 반영되지만, ISR 로 바꿀 때를 대비해 배선해 둔다. */
function revalidateRockets(): void {
  revalidatePath('/rocket')
  revalidatePath('/rocket/[slug]', 'page')
}

function describeWriteError(err: unknown): ActionResult {
  if (err instanceof VersionConflict) return CONFLICT
  // 미디어 부착 거부는 사용자가 고칠 수 있는 상황이라 문구를 그대로 보여 준다.
  if (err instanceof MediaRejected) return fail(err.message, { coverMediaId: err.message })
  if (err instanceof RowGone) {
    return fail(
      '이 로켓은 다른 곳에서 이미 삭제되었습니다. 저장할 대상이 없습니다 — 목록으로 돌아간 뒤 필요하면 다시 등록해 주세요.'
    )
  }

  const { code, constraint } = pgError(err)
  if (code === PG_UNIQUE_VIOLATION) {
    if (constraint === 'rockets_series_order_uq') {
      return fail('같은 시리즈에 동일한 정렬순서가 이미 있습니다. 다른 번호를 사용해 주세요.', {
        sortOrder: '이 시리즈에서 이미 사용 중인 번호입니다.',
      })
    }
    if (constraint === 'rockets_pkey') {
      return fail('같은 식별자의 로켓이 이미 있습니다.', { id: '이미 사용 중인 식별자입니다.' })
    }
  }

  // 에러 객체를 화면으로도 로그로도 흘리지 않는다.
  console.error('[admin] 로켓 저장 실패')
  return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
}

export async function createRocketAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const parsed = parseRocketForm(form)
  if (!parsed.ok) return parsed.result

  const id = parsed.rocket.id
  const attach = attachedIds(parsed)

  try {
    await db.transaction(async (tx) => {
      // 부착 검증이 먼저다. 행을 만든 뒤에 거부하면 롤백으로 되돌아가긴 하지만,
      // 그 사이에 UNIQUE 위반 같은 다른 오류가 겹치면 원인이 둘로 보인다.
      const attachable = await checkMediaAttachable(tx, attach, 'rocket', id)
      if (!attachable.ok) throw new MediaRejected(attachable.message)

      await tx.insert(schema.rockets).values({ id, ...toRocketValues(parsed.rocket) })
      const engines = toEngineValues(id, parsed.engines)
      if (engines.length > 0) await tx.insert(schema.rocketEngines).values(engines)

      await stampMediaEntity(tx, attach, 'rocket', id)
      await saveGalleryOrder(tx, id, parsed.galleryIds)
    })
  } catch (err) {
    return describeWriteError(err)
  }

  revalidateRockets()
  redirect(adminHref({ tab: 'rockets', saved: id }))
}

export async function updateRocketAction(
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

  const parsed = parseRocketForm(form)
  if (!parsed.ok) return parsed.result

  const id = parsed.rocket.id
  const attach = attachedIds(parsed)
  /** 이번 저장으로 떨어져 나간 미디어. 커밋된 뒤에만 정리한다. */
  let dropped: string[] = []

  try {
    await db.transaction(async (tx) => {
      /**
       * 이전 대표 이미지를 알아야 교체분을 정리할 수 있어 행을 **먼저 잠근다**.
       * 잠금이 걸린 뒤에는 읽기와 쓰기 사이가 열리지 않으므로 버전 대조를 UPDATE 안에 그대로 두어도
       * 경합이 생기지 않는다 (F12). 덤으로 "행이 없다"와 "버전이 다르다"가 여기서 바로 갈린다 —
       * 두 경우의 복구 방법이 서로 다르다.
       */
      const before = await tx
        .select({ coverMediaId: schema.rockets.coverMediaId })
        .from(schema.rockets)
        .where(eq(schema.rockets.id, id))
        .for('update')

      const previous = before[0]
      if (!previous) throw new RowGone()

      const attachable = await checkMediaAttachable(tx, attach, 'rocket', id)
      if (!attachable.ok) throw new MediaRejected(attachable.message)

      const previousIds = await listAttachedMediaIds(tx, 'rocket', id)

      const updated = await tx
        .update(schema.rockets)
        .set({ ...toRocketValues(parsed.rocket), updatedAt: sql`now()` })
        .where(and(eq(schema.rockets.id, id), versionMatches(schema.rockets.updatedAt, version)))
        .returning({ id: schema.rockets.id })

      // 행은 잠근 채로 확인했으므로 0행은 버전 불일치 하나뿐이다.
      if (!updated[0]) throw new VersionConflict()

      // 엔진은 통째로 갈아 끼운다. id 를 보존해 봐야 참조하는 곳이 없고, 부분 갱신은 순서 재배치에서 어긋난다.
      await tx.delete(schema.rocketEngines).where(eq(schema.rocketEngines.rocketId, id))
      const engines = toEngineValues(id, parsed.engines)
      if (engines.length > 0) await tx.insert(schema.rocketEngines).values(engines)

      await stampMediaEntity(tx, attach, 'rocket', id)
      await saveGalleryOrder(tx, id, parsed.galleryIds)

      // 남는 것과 빠지는 것을 여기서 확정한다. 대표 이미지를 갤러리로 옮기는 이동도 이 계산에 포함된다.
      const keep = new Set(attach)
      const out = new Set<string>()
      if (previous.coverMediaId && !keep.has(previous.coverMediaId)) out.add(previous.coverMediaId)
      for (const mediaId of previousIds) if (!keep.has(mediaId)) out.add(mediaId)
      dropped = [...out]
    })
  } catch (err) {
    return describeWriteError(err)
  }

  // 커밋 이후다 — 참조가 끊긴 것이 확정된 뒤라야 deleteMedia 의 참조 재확인이 통과한다 (I14).
  await retireMedia(dropped)

  revalidateRockets()
  redirect(adminHref({ tab: 'rockets', saved: id }))
}

export async function deleteRocketAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const id = form.get('id')
  if (typeof id !== 'string' || !SLUG_SHAPE.test(id)) return MALFORMED

  let dropped: string[] = []

  try {
    await db.transaction(async (tx) => {
      const before = await tx
        .select({ coverMediaId: schema.rockets.coverMediaId })
        .from(schema.rockets)
        .where(eq(schema.rockets.id, id))
        .for('update')

      const previous = before[0]
      if (!previous) throw new RowGone()

      // 참조를 **끊는 것까지가 트랜잭션**이다. media 행과 S3 객체는 커밋 뒤에 정리한다 (F6).
      const attachedBefore = await listAttachedMediaIds(tx, 'rocket', id)
      await deleteGalleryOrder(tx, id)

      // 엔진 행은 FK 의 on delete cascade 가 함께 지운다.
      await tx.delete(schema.rockets).where(eq(schema.rockets.id, id))

      const out = new Set<string>(attachedBefore)
      if (previous.coverMediaId) out.add(previous.coverMediaId)
      dropped = [...out]
    })
  } catch (err) {
    if (err instanceof RowGone) return fail('이미 삭제된 로켓입니다.')
    console.error('[admin] 로켓 삭제 실패')
    return fail('삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  await retireMedia(dropped)

  revalidateRockets()
  redirect(adminHref({ tab: 'rockets', saved: 'deleted' }))
}
