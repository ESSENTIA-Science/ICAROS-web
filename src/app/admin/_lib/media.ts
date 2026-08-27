import 'server-only'

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db, schema } from '@/lib/db'
import { MAX_GALLERY_IMAGES, type MediaEntityType } from '@/lib/image/policy'
import { StorageError, deleteMedia, describeError, enqueueCleanup, isUuid, hasReferences } from '@/lib/s3'

/**
 * 어드민 폼 ↔ `icaros.media` 를 잇는 계층.
 *
 * 업로드 자체는 `/api/upload/*` 가 끝낸다. 여기서 하는 일은 **저장 시점의 부착·해제**다:
 * 폼이 돌려준 media id 를 검증하고, entity 에 도장을 찍고, 떨어져 나간 것을 정리 대상으로 넘긴다.
 *
 * S3 를 직접 부르지 않는다 — 삭제는 전부 `lib/s3` 의 `deleteMedia()` 를 거친다.
 * 그 함수 안에 참조 재확인(I14)·프리픽스 검사(I11)·실패 시 cleanup 적재(I10)가 이미 들어 있고,
 * 여기에 다시 쓰면 두 벌이 갈라진다.
 */

/** drizzle 트랜잭션 핸들. 제네릭을 손으로 적지 않고 `db.transaction` 콜백 인자에서 뽑는다. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * 갤러리 상한은 `lib/image/policy.ts` 가 갖는다 — 브라우저 폼과 서버가 반드시 같은 값을 봐야 하는데
 * 이 파일은 `server-only` 라 폼에서 가져다 쓸 수 없다. 기존 import 경로를 지키려고 여기서 다시 내보낸다.
 */
export { MAX_GALLERY_IMAGES } from '@/lib/image/policy'

// ── 폼 값 검증 ──────────────────────────────────────────────────────────────

/**
 * 대표 이미지 필드. **빈 문자열이 "이미지 없음"**이다 —
 * 폼은 hidden 을 항상 실어 보내므로 "안 보냄"과 "지웠음"이 섞이지 않는다.
 */
export function mediaIdField(): z.ZodType<string, string> {
  return z
    .string()
    .trim()
    .refine(
      (v) => v === '' || isUuid(v),
      '이미지 값이 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.'
    )
}

/** 갤러리 입력이 붙는 폼 필드 이름. 오류를 그 입력 옆에 띄우려면 서버도 같은 이름을 알아야 한다. */
export const GALLERY_FIELD = 'galleryMediaIds'
/** 대표 이미지 입력이 붙는 폼 필드 이름. 로켓·부원이 서로 다른 이름을 쓰므로 호출부가 넘긴다. */
export type CoverFieldName = 'coverMediaId' | 'imageMediaId'

export type GalleryParse = { ok: true; ids: string[] } | { ok: false; message: string }

/**
 * 갤러리 hidden 목록. 순서가 곧 표시 순서라 **입력 순서를 보존**하고 중복만 접는다.
 * 같은 이미지를 두 번 넣어도 오류로 만들지 않는 이유: 사용자가 고칠 수 있는 실수가 아니라
 * 폼 조작 중에 생기는 무해한 상태다.
 */
export function parseGalleryIds(raw: readonly string[]): GalleryParse {
  const ids: string[] = []

  for (const value of raw) {
    const v = value.trim()
    if (v === '') continue
    if (!isUuid(v)) {
      return { ok: false, message: '갤러리 이미지 값이 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.' }
    }
    if (!ids.includes(v)) ids.push(v)
  }

  if (ids.length > MAX_GALLERY_IMAGES) {
    return { ok: false, message: `갤러리 이미지는 최대 ${MAX_GALLERY_IMAGES}장까지 등록할 수 있습니다.` }
  }
  return { ok: true, ids }
}

// ── 갤러리 순서 ─────────────────────────────────────────────────────────────

/**
 * 갤러리 **순서**만 `icaros.site_settings` 에 둔다 (C7).
 *
 * 소속(어떤 로켓의 갤러리인가)은 `media.entity_type='rocket' + entity_id=<slug>` 가 이미 답하므로
 * 조인 테이블이 필요 없다. 남는 문제는 순서 하나뿐인데 `media` 에는 정렬 컬럼이 없고
 * 스키마는 이 트랙에서 바꿀 수 없다. 그래서:
 *
 *  - 순서 목록은 **보조 정보**다. 없거나 낡아도 갤러리는 업로드 순서로 정상 동작한다.
 *  - `site_settings` 는 이미 이 코드베이스가 미디어 참조를 담는 곳이다 —
 *    랜딩 이미지도 `value` 안에 `/api/media/{id}` 로 들어가고, `deleteMedia()` 의 참조 검사가
 *    그 문자열까지 본다. 따라서 여기 적힌 id 는 **자동으로 삭제 보호를 받는다.**
 *  - 랜딩 편집기는 `LANDING_KEYS` 화이트리스트로만 읽고 쓰므로(`_data/landing.ts`)
 *    이 키가 랜딩 탭에 노출되거나 Save All 에 덮여 사라지지 않는다.
 *
 * 기각안: `media.created_at` 순서 고정 — 재정렬이 아예 불가능해 "5번을 맨 앞으로"를 하려면
 * 지웠다 다시 올려야 한다. 갤러리를 붙이는 목적 자체가 반감된다.
 */
export function galleryOrderKey(rocketId: string): string {
  return `rocket.${rocketId}.gallery`
}

/** 저장된 순서 문자열 → id 목록. 형식이 깨져 있으면 그 항목만 버린다(전체를 버리지 않는다). */
export function parseGalleryOrder(value: string | null): string[] {
  if (!value) return []
  const out: string[] = []
  for (const raw of value.split(',')) {
    const v = raw.trim()
    if (isUuid(v) && !out.includes(v)) out.push(v)
  }
  return out
}

export async function saveGalleryOrder(tx: Tx, rocketId: string, ids: readonly string[]): Promise<void> {
  const key = galleryOrderKey(rocketId)

  if (ids.length === 0) {
    await tx.delete(schema.siteSettings).where(eq(schema.siteSettings.key, key))
    return
  }

  const value = ids.join(',')
  await tx
    .insert(schema.siteSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.siteSettings.key,
      set: { value, updatedAt: sql`now()` },
    })
}

export async function deleteGalleryOrder(tx: Tx, rocketId: string): Promise<void> {
  await tx.delete(schema.siteSettings).where(eq(schema.siteSettings.key, galleryOrderKey(rocketId)))
}

// ── 부착 ────────────────────────────────────────────────────────────────────

/**
 * 부착 거부를 트랜잭션 밖으로 옮기는 신호. 문구는 그대로 사용자에게 보여 준다.
 *
 * `fields` 는 **어느 입력이 원인인가**다. 예전에는 호출부가 무조건 대표 이미지 필드에 붙였는데,
 * 갤러리 12번째 사진이 문제여도 오류가 대표 이미지 아래에 떠서 멀쩡한 대표 이미지를 지우고
 * 다시 올리는 오진을 유도했다. 원인 id 를 필드로 되돌려 그 입력 옆에 띄운다.
 */
export class MediaRejected extends Error {
  readonly fields: readonly string[]
  constructor(message: string, fields: readonly string[]) {
    super(message)
    this.fields = fields
  }
}

export type AttachCheck =
  | { ok: true }
  /** `ids` = 거부를 유발한 media id. 호출부가 이걸로 대표/갤러리를 가른다. 특정 불가면 빈 배열. */
  | { ok: false; message: string; ids: readonly string[] }

/**
 * 폼이 돌려준 media id 를 이 entity 에 붙여도 되는지 본다.
 *
 * id 는 클라이언트가 준 값이다. `ready` 가 아니거나 이미 **다른 주인이 있는** 미디어를 그대로 받으면,
 * 나중에 그 주인을 지울 때 살아 있는 화면의 이미지가 함께 사라진다.
 * (`deleteMedia()` 의 참조 검사가 마지막에 한 번 더 막지만, 그건 삭제 시점이라 너무 늦다 —
 * 여기서 막아야 "왜 저장이 안 되지"가 아니라 "다른 항목에 연결된 이미지입니다"가 보인다.)
 */
export async function checkMediaAttachable(
  tx: Tx,
  ids: readonly string[],
  entityType: MediaEntityType,
  entityId: string
): Promise<AttachCheck> {
  if (ids.length === 0) return { ok: true }

  const rows = await tx
    .select({
      id: schema.media.id,
      entityType: schema.media.entityType,
      entityId: schema.media.entityId,
    })
    .from(schema.media)
    .where(
      and(
        inArray(schema.media.id, [...ids]),
        eq(schema.media.status, 'ready'),
        isNull(schema.media.deletedAt)
      )
    )

  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => r.id))
    return {
      ok: false,
      message: '선택한 이미지를 찾을 수 없습니다. 업로드가 끝난 뒤 저장해 주세요.',
      ids: ids.filter((id) => !found.has(id)),
    }
  }

  for (const row of rows) {
    if (row.entityType !== null && row.entityType !== entityType) {
      return {
        ok: false,
        message: '다른 용도로 올린 이미지는 여기에 사용할 수 없습니다.',
        ids: [row.id],
      }
    }
    if (row.entityId !== null && row.entityId !== entityId) {
      return { ok: false, message: '이미 다른 항목에 연결된 이미지입니다.', ids: [row.id] }
    }
  }

  return { ok: true }
}

/**
 * 거부된 media id → 오류를 붙일 폼 필드.
 *
 * 대표 이미지와 갤러리가 동시에 걸릴 수 있으므로 **둘 다** 돌려준다.
 * 원인을 특정하지 못했으면(빈 배열) 대표 이미지 쪽으로 보낸다 — 갤러리는 폼에서 항목별로
 * 지울 수 있어 사용자가 스스로 좁힐 수 있지만, 대표 이미지는 한 칸뿐이라 놓치면 단서가 없다.
 */
export function rejectedFields(
  rejected: readonly string[],
  cover: string | null,
  galleryIds: readonly string[],
  coverField: CoverFieldName
): string[] {
  if (rejected.length === 0) return [coverField]

  const fields: string[] = []
  if (cover !== null && rejected.includes(cover)) fields.push(coverField)
  if (rejected.some((id) => galleryIds.includes(id))) fields.push(GALLERY_FIELD)
  // 어느 쪽에도 속하지 않는 id 가 남았다면 폼과 서버가 어긋난 것이다. 최소한 한 군데엔 띄운다.
  return fields.length > 0 ? fields : [coverField]
}

/**
 * 소속 도장. **presign 때가 아니라 저장 때** 찍는다 —
 * 업로드해 놓고 폼을 취소한 이미지가 갤러리에 나타나면 안 되기 때문이다.
 * (`entity_type` 은 presign 에서 이미 정해진다. 캐시 정책이 그 값으로 갈리므로 거기서 필요하다.)
 */
export async function stampMediaEntity(
  tx: Tx,
  ids: readonly string[],
  entityType: MediaEntityType,
  entityId: string
): Promise<void> {
  if (ids.length === 0) return
  await tx
    .update(schema.media)
    .set({ entityType, entityId })
    .where(inArray(schema.media.id, [...ids]))
}

/** 이 entity 에 도장이 찍힌 미디어 전부. 상태로 거르지 않는다 — 정리 대상을 놓치면 고아가 남는다. */
export async function listAttachedMediaIds(
  tx: Tx,
  entityType: MediaEntityType,
  entityId: string
): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(
      and(
        eq(schema.media.entityType, entityType),
        eq(schema.media.entityId, entityId),
        isNull(schema.media.deletedAt)
      )
    )
  return rows.map((r) => r.id)
}

// ── 해제 ────────────────────────────────────────────────────────────────────

/**
 * 떨어져 나간 미디어를 정리한다 (F6·I9·I14).
 *
 * **반드시 커밋 이후에** 부른다. 참조가 끊긴 것이 확정된 다음에야 `deleteMedia()` 의 참조 검사가
 * 통과하고, 반대 순서면 롤백된 트랜잭션 때문에 살아 있는 이미지를 지우게 된다.
 *
 * 절대 던지지 않는다 — 정리 실패가 "삭제했습니다"를 "삭제에 실패했습니다"로 바꾸면
 * 사용자는 이미 사라진 행을 다시 지우려 든다.
 */
export async function retireMedia(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    try {
      // 참조 재확인 → soft delete → S3 개별 삭제 → 실패 시 cleanup 적재까지 전부 여기 안에 있다.
      await deleteMedia(id)
    } catch (err) {
      if (err instanceof StorageError && (err.code === 'in_use' || err.code === 'not_found')) {
        // in_use: 아직 누군가 참조 중이다. not_found: 이미 정리됐다. 객체는 건드리지 않는다.
        //
        // 다만 **소속은 반드시 끊는다.** 갤러리 목록은 `entity_type + entity_id` 로만 뽑고
        // 순서 행은 정렬 힌트일 뿐이라, entity_id 를 남겨 두면 관리자가 방금 뺀 사진이
        // 저장 직후 목록 맨 뒤에 아무 안내 없이 되살아난다.
        await db
          .update(schema.media)
          .set({ entityId: null })
          .where(eq(schema.media.id, id))
        console.warn(`[admin] 미디어 객체 정리 보류 (${err.code}) — 소속만 해제: ${id}`)
        continue
      }
      await queueForCleanup(id, err)
    }
  }
}

/**
 * `deleteMedia()` 가 **상태를 하나도 바꾸지 못하고** 던진 경우의 회수 경로.
 * 실제로는 `S3_BUCKET` 미설정(`config_missing`)이나 프리픽스 밖 키(`forbidden_key`)뿐이다.
 *
 * 행을 `ready` 로 남겨 두면 아무도 참조하지 않는데 살아 있는 것처럼 보이므로 soft delete 하고,
 * S3 객체는 큐에 넣어 나중에 회수한다. `completed_at` 이 채워지기 전까지 잡은 계속 보인다.
 *
 * `hasReferences()` 로 참조를 **직접 재확인한다.** 예전에는 그 함수가 비공개라 이 경로에서
 * 검사를 건너뛰었고, `S3_BUCKET` 미설정 상태(= 지금 로컬)에서는 모든 호출이 여기로 떨어져
 * 살아 있는 참조를 soft delete 하는 구멍이 있었다. 참조 검사는 DB 만 보므로 S3 설정과 무관하다.
 */
async function queueForCleanup(mediaId: string, cause: unknown): Promise<void> {
  try {
    const rows = await db
      .select({ bucket: schema.media.bucket, key: schema.media.key })
      .from(schema.media)
      .where(and(eq(schema.media.id, mediaId), isNull(schema.media.deletedAt)))
      .limit(1)

    const row = rows[0]
    if (!row) return

    // 살아 있는 참조를 지우지 않는다. 이 경로는 deleteMedia 가 상태를 바꾸기 전에 던진 경우라
    // 그 안의 검사가 돌지 않았다.
    if (await hasReferences(mediaId)) {
      console.warn(`[admin] 참조가 남아 있어 정리하지 않음: ${mediaId}`)
      return
    }

    await db
      .update(schema.media)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.media.id, mediaId), isNull(schema.media.deletedAt)))

    await enqueueCleanup(row.bucket, row.key, describeError(cause))
  } catch {
    // 에러 객체를 그대로 흘리지 않는다. 여기까지 실패하면 사람이 봐야 한다.
    console.error('[admin] 미디어 정리 예약 실패')
  }
}
