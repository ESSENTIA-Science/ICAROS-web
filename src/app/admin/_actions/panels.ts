'use server'

/**
 * 랜딩 패널 CRUD Server Actions.
 *
 * 런타임 지정은 여기가 아니라 `app/admin/layout.tsx`·`page.tsx` 에 있다 —
 * `'use server'` 모듈은 async 함수 외의 export 를 허용하지 않는다.
 */

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/guard'
import { db, schema } from '@/lib/db'
import {
  PANEL_ANCHORS,
  PANEL_CTA_HREFS,
  PANEL_HEIGHTS,
  PANEL_SCRIMS,
} from '@/lib/db/schema'
import { CONFLICT, DENIED, MALFORMED, fail, type ActionResult, type FormState } from './result'
import {
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  emptyToNull,
  formToRecord,
  normalizeNewlines,
  pgError,
  zodFieldErrors,
  zodSummary,
} from '../_lib/form'
import { isVersionToken, versionMatches } from '../_lib/version'
import { adminHref } from '../_tabs'

/** 목록 전체의 버전이 어긋났다는 신호. 사용자 문구는 CONFLICT 가 갖는다. */
class VersionConflict extends Error {}

/**
 * 폼 스키마.
 *
 * 열거값은 **DB CHECK 와 같은 상수 배열**에서 만든다. 두 곳에 적으면 언젠가 갈라지고,
 * 갈라진 쪽이 zod 면 DB 가 막아 주지만 반대면 화면이 조용히 깨진 값을 그린다.
 */
const panelSchema = z
  .object({
    mediaId: z.string().uuid('사진을 골라 주세요.'),
    focalX: z.coerce.number().int().min(0).max(100),
    focalY: z.coerce.number().int().min(0).max(100),
    scrim: z.enum(PANEL_SCRIMS),
    anchor: z.enum(PANEL_ANCHORS),
    height: z.enum(PANEL_HEIGHTS),
    eyebrow: z.string().max(200).transform(emptyToNull),
    headline: z
      .string()
      .transform(normalizeNewlines)
      .refine((v) => v.trim().length > 0, '헤드라인은 비울 수 없습니다.')
      .refine((v) => v.length <= 200, '헤드라인이 너무 깁니다 (200자 이내).'),
    body: z.string().max(600).transform(normalizeNewlines).transform(emptyToNull),
    ctaLabel: z.string().max(60).transform(emptyToNull),
    ctaHref: z
      .string()
      .transform(emptyToNull)
      .refine(
        (v) => v === null || (PANEL_CTA_HREFS as readonly string[]).includes(v),
        '링크는 목록에 있는 경로만 쓸 수 있습니다.'
      ),
  })
  /* 라벨과 링크는 함께 있거나 함께 없다. 한쪽만 있으면 화면에 죽은 버튼이 뜬다.
     DB CHECK 가 최종 방어선이지만, 여기서 막아야 사용자가 어느 칸이 문제인지 안다. */
  .refine((v) => (v.ctaLabel === null) === (v.ctaHref === null), {
    message: 'CTA 는 라벨과 링크를 함께 채우거나 함께 비워 주세요.',
    path: ['ctaLabel'],
  })

function parse(form: FormData) {
  return panelSchema.safeParse(formToRecord(form))
}

/** DB CHECK 위반을 사용자 문구로 옮긴다. 제약 이름이 화면에 새지 않게 한다. */
function fromPgError(err: unknown): ActionResult | null {
  const { code, constraint } = pgError(err)
  if (code === PG_FOREIGN_KEY_VIOLATION) return fail('고른 사진을 찾을 수 없습니다. 목록을 새로고침해 주세요.')
  if (code !== PG_CHECK_VIOLATION) return null
  if (constraint === 'page_panels_cta_pair_ck') return fail('CTA 는 라벨과 링크를 함께 채우거나 함께 비워 주세요.')
  if (constraint === 'page_panels_headline_ck') return fail('헤드라인은 비울 수 없습니다.')
  return fail('저장할 수 없는 값이 있습니다. 입력을 확인해 주세요.')
}

async function assertVersion(token: string): Promise<void> {
  const [row] = await db
    .select({ ok: versionMatches(schema.pagePanels.updatedAt, token) })
    .from(schema.pagePanels)
    .limit(1)
  // 행이 하나도 없으면 비교할 것이 없다 — 첫 패널을 만드는 경우다.
  if (row && row.ok === false) throw new VersionConflict()
}

// ── 생성 ────────────────────────────────────────────────────────────────────

export async function createPanel(_prev: FormState, form: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED

  const parsed = parse(form)
  if (!parsed.success) return fail(zodSummary(parsed.error), zodFieldErrors(parsed.error))

  try {
    /* 새 패널은 **맨 뒤**에 붙고 **비공개**로 만들어진다.
       공개가 기본이면 사진과 문구를 다 채우기 전에 랜딩에 나간다 — 이 화면에서 가장
       되돌리기 어려운 사고가 그것이다. */
    // `noUncheckedIndexedAccess` 가 켜져 있다 — 집계 쿼리라도 배열 인덱싱 결과는 undefined 가능이다.
    const rows = await db
      .select({ next: sql<number>`coalesce(max(${schema.pagePanels.sortOrder}), -1) + 1` })
      .from(schema.pagePanels)

    await db.insert(schema.pagePanels).values({
      ...parsed.data,
      sortOrder: rows[0]?.next ?? 0,
      published: false,
    })
  } catch (err) {
    return fromPgError(err) ?? fail('패널을 만들지 못했습니다.')
  }

  revalidatePath('/')
  revalidatePath('/admin')
  return { ok: true, message: '패널을 만들었습니다. 내용을 확인한 뒤 공개해 주세요.' }
}

// ── 수정 ────────────────────────────────────────────────────────────────────

export async function updatePanel(_prev: FormState, form: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED

  const id = form.get('id')
  const version = form.get('version')
  if (typeof id !== 'string' || !isVersionToken(version)) return MALFORMED

  const parsed = parse(form)
  if (!parsed.success) return fail(zodSummary(parsed.error), zodFieldErrors(parsed.error))

  try {
    const updated = await db
      .update(schema.pagePanels)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(schema.pagePanels.id, id), versionMatches(schema.pagePanels.updatedAt, version)))
      .returning({ id: schema.pagePanels.id })

    if (updated.length === 0) {
      const [exists] = await db
        .select({ id: schema.pagePanels.id })
        .from(schema.pagePanels)
        .where(eq(schema.pagePanels.id, id))
      // 없는 항목과 충돌은 다른 사고다. 섞으면 "새로고침하라"고 해 놓고 새로고침하면 항목이 없다.
      return exists ? CONFLICT : fail('이미 삭제된 패널입니다.')
    }
  } catch (err) {
    return fromPgError(err) ?? fail('패널을 저장하지 못했습니다.')
  }

  revalidatePath('/')
  revalidatePath('/admin')
  return { ok: true, message: '저장했습니다.' }
}

// ── 공개 토글 ───────────────────────────────────────────────────────────────

export async function togglePanelPublished(_prev: FormState, form: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED

  const id = form.get('id')
  const next = form.get('published')
  if (typeof id !== 'string' || (next !== 'on' && next !== 'off')) return MALFORMED

  const updated = await db
    .update(schema.pagePanels)
    .set({ published: next === 'on', updatedAt: new Date() })
    .where(eq(schema.pagePanels.id, id))
    .returning({ id: schema.pagePanels.id })

  if (updated.length === 0) return fail('이미 삭제된 패널입니다.')

  revalidatePath('/')
  revalidatePath('/admin')
  return { ok: true, message: next === 'on' ? '공개했습니다.' : '내렸습니다.' }
}

// ── 순서 ────────────────────────────────────────────────────────────────────

export async function movePanel(_prev: FormState, form: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED

  const id = form.get('id')
  const dir = form.get('direction')
  const version = form.get('version')
  if (typeof id !== 'string' || (dir !== 'up' && dir !== 'down') || !isVersionToken(version)) {
    return MALFORMED
  }

  try {
    await db.transaction(async (tx) => {
      await assertVersion(version)

      const rows = await tx
        .select({ id: schema.pagePanels.id, sortOrder: schema.pagePanels.sortOrder })
        .from(schema.pagePanels)
        .orderBy(schema.pagePanels.sortOrder, schema.pagePanels.id)

      const at = rows.findIndex((r) => r.id === id)
      if (at < 0) throw new VersionConflict()
      const swapWith = dir === 'up' ? at - 1 : at + 1
      // 양 끝에서 누른 것은 사고가 아니다 — 조용히 아무 일도 하지 않는다.
      if (swapWith < 0 || swapWith >= rows.length) return

      /* 두 행의 `sort_order` 를 맞바꾸지 않고 **전체를 0..n-1 로 다시 매긴다.**
         맞바꾸기는 두 값이 같을 때(시드나 수동 INSERT 로 충분히 생긴다) 아무 일도 일어나지 않는다.
         전체 재부여는 그런 상태를 만나도 한 번에 정상으로 되돌린다. */
      const next = rows.slice()
      const [moved] = next.splice(at, 1)
      if (!moved) throw new VersionConflict()
      next.splice(swapWith, 0, moved)

      const now = new Date()
      for (const [i, row] of next.entries()) {
        if (row.sortOrder === i) continue
        await tx
          .update(schema.pagePanels)
          .set({ sortOrder: i, updatedAt: now })
          .where(eq(schema.pagePanels.id, row.id))
      }
    })
  } catch (err) {
    if (err instanceof VersionConflict) return CONFLICT
    return fail('순서를 바꾸지 못했습니다.')
  }

  revalidatePath('/')
  revalidatePath('/admin')
  return { ok: true, message: '순서를 바꿨습니다.' }
}

// ── 삭제 ────────────────────────────────────────────────────────────────────

export async function deletePanel(_prev: FormState, form: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED

  const id = form.get('id')
  if (typeof id !== 'string') return MALFORMED

  const removed = await db
    .delete(schema.pagePanels)
    .where(eq(schema.pagePanels.id, id))
    .returning({ id: schema.pagePanels.id })

  if (removed.length === 0) return fail('이미 삭제된 패널입니다.')

  /* 사진은 지우지 않는다. `media` 는 다른 패널이나 다른 화면이 함께 쓸 수 있고,
     S3 는 Versioning 이 꺼져 있어 잘못 지우면 복구가 없다. 정리는 `storage_cleanup_jobs` 의 몫이다. */
  revalidatePath('/')
  revalidatePath('/admin')
  return { ok: true, message: '패널을 삭제했습니다.' }
}

/** 저장 후 목록으로 돌려보낼 때 쓰는 주소. 쿼리 조립은 `_tabs.ts` 한 곳에서만 한다. */
export async function panelsListHref(saved?: string): Promise<string> {
  return adminHref({ tab: 'panels', saved })
}
