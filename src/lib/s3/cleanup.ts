import 'server-only'

import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { media, members, rockets, storageCleanupJobs } from '@/lib/db/schema'
import { StorageError, describeError } from './errors'
import { assertKeyWritable } from './keys'
import { deleteObject, headObject } from './objects'

/** 이 횟수를 넘기면 큐에서 빼지 않는다. 사람이 볼 때까지 행으로 남겨 둔다. */
const MAX_ATTEMPTS = 10

/** 확정되지 않은 채 이만큼 지난 `pending` 은 중단된 업로드로 본다. */
const STALE_PENDING_MS = 30 * 60 * 1000

/**
 * 삭제 실패를 적재한다 (요구사항 I10, 07 §6).
 * S3 삭제 실패를 조용히 넘기면 아무도 모르는 고아가 남고, Versioning 이 꺼져 있어
 * 나중에 "이 객체가 왜 있지"를 판정할 근거도 사라진다.
 */
export async function enqueueCleanup(bucket: string, key: string, lastError: string): Promise<string | null> {
  const rows = await db
    .insert(storageCleanupJobs)
    .values({ bucket, key, attempts: 1, lastError: lastError.slice(0, 500) })
    .returning({ id: storageCleanupJobs.id })
  return rows[0]?.id ?? null
}

export interface DeleteMediaResult {
  /** S3 객체까지 실제로 지워졌는가. false 면 `cleanupJobId` 에 재시도가 예약돼 있다. */
  objectRemoved: boolean
  cleanupJobId: string | null
}

/**
 * 미디어 1건 삭제 (요구사항 I11·I14).
 *
 * 순서가 중요하다: 소유 검증 → 참조 검증 → DB soft delete → S3 개별 DeleteObject.
 * S3 를 먼저 지우면 DB 실패 시 되돌릴 수 없다 — Versioning 이 꺼져 있다.
 * 반대 순서면 최악의 경우 고아 객체가 남을 뿐이고, 그건 cleanup 큐로 회수된다.
 */
export async function deleteMedia(mediaId: string): Promise<DeleteMediaResult> {
  const rows = await db
    .select({ id: media.id, bucket: media.bucket, key: media.key })
    .from(media)
    .where(and(eq(media.id, mediaId), isNull(media.deletedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) throw new StorageError('not_found', '삭제할 미디어를 찾을 수 없습니다.')

  // ICAROS 프리픽스 밖이면 여기서 끝난다. `forum/` 도 포함해 우리 것이 아니면 지우지 않는다.
  assertKeyWritable(row.key)

  if (await hasReferences(mediaId)) {
    throw new StorageError('in_use', '아직 사용 중인 이미지입니다. 먼저 연결을 해제해 주세요.')
  }

  // 삭제 표시는 `deleted_at` 하나뿐이다. status 는 pending/ready/failed 라는 업로드 이력이라
  // 여기서 건드리면 "확정됐던 미디어"와 "확정에 실패한 미디어"를 나중에 구분할 수 없다.
  const softDeleted = await db
    .update(media)
    .set({ deletedAt: new Date() })
    .where(and(eq(media.id, mediaId), isNull(media.deletedAt)))
    .returning({ id: media.id })

  // 동시에 다른 요청이 이미 지웠다. S3 삭제는 그쪽이 책임진다.
  if (!softDeleted[0]) return { objectRemoved: false, cleanupJobId: null }

  try {
    await deleteObject(row.key)
    return { objectRemoved: true, cleanupJobId: null }
  } catch (err) {
    const cleanupJobId = await enqueueCleanup(row.bucket, row.key, describeError(err))
    return { objectRemoved: false, cleanupJobId }
  }
}

/**
 * 삭제 전 연결 entity 재확인 (요구사항 I14).
 * `media.entity_id` 는 업로드 시점의 의도일 뿐이라 신뢰하지 않는다 — 실제 참조 쪽에서 확인한다.
 */
async function hasReferences(mediaId: string): Promise<boolean> {
  const [rocketRefs, memberRefs] = await Promise.all([
    db.select({ id: rockets.id }).from(rockets).where(eq(rockets.coverMediaId, mediaId)).limit(1),
    db.select({ id: members.id }).from(members).where(eq(members.imageMediaId, mediaId)).limit(1),
  ])
  return rocketRefs.length > 0 || memberRefs.length > 0
}

export interface CleanupRunResult {
  processed: number
  completed: number
  failed: number
}

/**
 * 실패한 삭제를 재시도한다. 개별 키만 지운다 — 프리픽스 통삭제는 이 계층에 존재하지 않는다.
 * 크론이나 관리 화면에서 호출한다.
 */
export async function runCleanupJobs(limit = 20): Promise<CleanupRunResult> {
  const jobs = await db
    .select()
    .from(storageCleanupJobs)
    .where(and(isNull(storageCleanupJobs.completedAt), lt(storageCleanupJobs.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(storageCleanupJobs.createdAt))
    .limit(limit)

  let completed = 0
  let failed = 0

  for (const job of jobs) {
    try {
      await deleteObject(job.key)
      await db
        .update(storageCleanupJobs)
        .set({ completedAt: new Date(), lastError: null })
        .where(eq(storageCleanupJobs.id, job.id))
      completed += 1
    } catch (err) {
      const terminal = err instanceof StorageError && err.code === 'forbidden_key'
      await db
        .update(storageCleanupJobs)
        .set({
          // 프리픽스 밖 키는 재시도해도 영원히 거부된다. 애초에 지워서는 안 되는 대상이므로
          // 재시도를 멈추되 사유를 남긴다.
          completedAt: terminal ? new Date() : null,
          attempts: sql`${storageCleanupJobs.attempts} + 1`,
          lastError: describeError(err),
        })
        .where(eq(storageCleanupJobs.id, job.id))
      failed += 1
    }
  }

  return { processed: jobs.length, completed, failed }
}

export interface SweepResult {
  scanned: number
  /** S3 에 실제로 남아 있어 회수 대상이 된 건수 */
  orphansFound: number
}

/**
 * DB 행 ↔ S3 객체 불일치 회수 (요구사항 I9).
 *
 * `pending` 인 채 오래된 행은 두 경우다:
 *  - 브라우저가 PUT 전에 이탈 → S3 에 아무것도 없다. 행만 정리한다.
 *  - PUT 은 성공했는데 `/confirm` 이 못 왔다 → 아무도 참조하지 않는 객체가 남았다. 지운다.
 */
export async function sweepStalePendingUploads(limit = 50): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - STALE_PENDING_MS)

  const stale = await db
    .select({ id: media.id, bucket: media.bucket, key: media.key })
    .from(media)
    .where(and(eq(media.status, 'pending'), isNull(media.deletedAt), lt(media.createdAt, cutoff)))
    .orderBy(asc(media.createdAt))
    .limit(limit)

  let orphansFound = 0

  for (const row of stale) {
    let exists = false
    try {
      exists = (await headObject(row.key)) !== null
    } catch {
      // Head 가 실패하면 판정을 미룬다. 다음 스윕이 다시 본다.
      continue
    }

    if (exists) {
      orphansFound += 1
      try {
        await deleteObject(row.key)
      } catch (err) {
        await enqueueCleanup(row.bucket, row.key, describeError(err))
      }
    }

    await db
      .update(media)
      .set({ status: 'failed', deletedAt: new Date() })
      .where(and(eq(media.id, row.id), eq(media.status, 'pending')))
  }

  return { scanned: stale.length, orphansFound }
}
