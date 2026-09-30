import 'server-only'

import { and, asc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import { mediaUrl } from '@/lib/image/contract'
import { galleryOrderKey, parseGalleryOrder } from '../_lib/media'

/**
 * 어드민 미디어 DAL.
 *
 * 폼에 그릴 것만 돌려준다 — bucket·key·etag 는 화면에 필요 없고, 클라이언트 컴포넌트로
 * 넘어가는 값이므로 S3 내부 구조를 그쪽으로 흘리지 않는다.
 */

export type AdminMediaRef = {
  id: string
  /** 항상 `/api/media/{id}`. presigned URL 은 클라이언트에 절대 노출하지 않는다 (D3·D15). */
  url: string
  filename: string | null
  width: number | null
  height: number | null
  size: number | null
}

const refColumns = {
  id: schema.media.id,
  originalFilename: schema.media.originalFilename,
  width: schema.media.width,
  height: schema.media.height,
  size: schema.media.size,
} as const

type RawRef = {
  id: string
  originalFilename: string | null
  width: number | null
  height: number | null
  size: number | null
}

function toRef(row: RawRef): AdminMediaRef {
  return {
    id: row.id,
    url: mediaUrl(row.id),
    filename: row.originalFilename,
    width: row.width,
    height: row.height,
    size: row.size,
  }
}

/**
 * 대표 이미지 한 장. `ready` + 미삭제만 통과한다 —
 * 그 밖의 상태를 폼에 그리면 화면에는 있는데 `/api/media/{id}` 는 404 를 주는 조합이 된다.
 */
export async function getMediaRef(id: string | null): Promise<AdminMediaRef | null> {
  if (!id) return null

  const rows = await db
    .select(refColumns)
    .from(schema.media)
    .where(and(eq(schema.media.id, id), eq(schema.media.status, 'ready'), isNull(schema.media.deletedAt)))
    .limit(1)

  const row = rows[0]
  return row ? toRef(row) : null
}

/**
 * 로켓 갤러리 (C7).
 *
 * **소속은 `media.entity_type`+`entity_id` 가 정한다** — 조인 테이블이 없다.
 * 순서만 `site_settings` 의 보조 목록을 따르고, 그 목록에 없는 것은 업로드 순서로 뒤에 붙는다.
 * 그래서 순서 행이 사라져도 갤러리가 비지 않는다.
 *
 * 대표 이미지는 같은 도장을 갖지만 갤러리에서는 뺀다 — 같은 사진이 두 번 나오면 안 된다.
 */
export async function listRocketGallery(
  rocketId: string,
  excludeId: string | null
): Promise<AdminMediaRef[]> {
  const [rows, orderRows] = await Promise.all([
    db
      .select(refColumns)
      .from(schema.media)
      .where(
        and(
          eq(schema.media.entityType, 'rocket'),
          eq(schema.media.entityId, rocketId),
          eq(schema.media.status, 'ready'),
          isNull(schema.media.deletedAt)
        )
      )
      .orderBy(asc(schema.media.createdAt), asc(schema.media.id)),
    db
      .select({ value: schema.siteSettings.value })
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.key, galleryOrderKey(rocketId)))
      .limit(1),
  ])

  // Map 은 삽입 순서를 보존한다 — 남는 항목이 곧 업로드 순서가 된다.
  const remaining = new Map<string, AdminMediaRef>()
  for (const row of rows) {
    if (row.id === excludeId) continue
    remaining.set(row.id, toRef(row))
  }

  const out: AdminMediaRef[] = []
  for (const id of parseGalleryOrder(orderRows[0]?.value ?? null)) {
    const ref = remaining.get(id)
    if (!ref) continue
    out.push(ref)
    remaining.delete(id)
  }
  for (const ref of remaining.values()) out.push(ref)

  return out
}
