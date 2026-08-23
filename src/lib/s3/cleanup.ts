import 'server-only'

import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { media, members, rockets, siteSettings, storageCleanupJobs } from '@/lib/db/schema'
import { StorageError, describeError } from './errors'
import { assertKeyWritable } from './keys'
import { deleteObject, headObject } from './objects'
import { isUuid } from './predicates'

/**
 * 이 횟수 이상이면 큐에서 더 꺼내지 않는다.
 * **`completed_at` 은 끝까지 null 로 둔다** — 그게 "지웠다"의 유일한 표시이기 때문이다.
 * 지우지 못한 것을 완료로 찍으면 지운 것과 구별할 수 없고, 조회 조건이 `completed_at is null`
 * 하나뿐이라 그 행은 다시는 눈에 띄지 않는다. 요구사항 I10 이 요구하는 것의 정반대다.
 */
const MAX_ATTEMPTS = 10

/** 확정되지 않은 채 이만큼 지난 `pending` 은 중단된 업로드로 본다. */
const STALE_PENDING_MS = 30 * 60 * 1000

/** 아직 처리되지 않은 잡. 재시도 대상과 포기된 것을 나누는 기준은 `attempts` 하나다. */
const OPEN_JOB = isNull(storageCleanupJobs.completedAt)

/**
 * 삭제 실패를 적재한다 (요구사항 I10, 07 §6).
 * S3 삭제 실패를 조용히 넘기면 아무도 모르는 고아가 남고, Versioning 이 꺼져 있어
 * 나중에 "이 객체가 왜 있지"를 판정할 근거도 사라진다.
 *
 * 같은 (bucket, key) 로 열려 있는 잡이 있으면 새로 만들지 않고 사유만 갱신한다.
 * 스윕이 실패한 객체를 매 주기 다시 만나기 때문에, 그대로 두면 같은 키의 잡이 계속 쌓여
 * 큐 조회 limit 을 한 키가 다 먹는다. (unique 인덱스가 없어 동시 호출 시 중복이 생길 수는 있지만,
 * 개별 DeleteObject 는 멱등이라 중복 잡의 대가는 여분의 호출 한 번뿐이다.)
 *
 * **`attempts` 는 여기서 올리지 않는다.** 여기 오는 건 "적재"이고 실제 재시도는 `runCleanupJobs`
 * 가 한다. 적재 때마다 올리면 한 번도 재시도되지 않은 잡이 상한에 닿아 포기 처리된다.
 */
export async function enqueueCleanup(bucket: string, key: string, lastError: string): Promise<string | null> {
  const reason = lastError.slice(0, 500)

  const existing = await db
    .select({ id: storageCleanupJobs.id })
    .from(storageCleanupJobs)
    .where(and(eq(storageCleanupJobs.bucket, bucket), eq(storageCleanupJobs.key, key), OPEN_JOB))
    .limit(1)

  const open = existing[0]
  if (open) {
    await db.update(storageCleanupJobs).set({ lastError: reason }).where(eq(storageCleanupJobs.id, open.id))
    return open.id
  }

  const rows = await db
    .insert(storageCleanupJobs)
    .values({ bucket, key, attempts: 0, lastError: reason })
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
  // 참조 검사(`hasReferences`)가 이 값을 LIKE 패턴에 넣는다. 형태를 여기서 못 박아 둔다.
  if (!isUuid(mediaId)) throw new StorageError('invalid_request', '잘못된 미디어 식별자입니다.')

  const rows = await db
    .select({ id: media.id, bucket: media.bucket, key: media.key })
    .from(media)
    .where(and(eq(media.id, mediaId), isNull(media.deletedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) throw new StorageError('not_found', '삭제할 미디어를 찾을 수 없습니다.')

  // 참조 검사를 프리픽스 검사보다 **먼저** 한다.
  // 순서가 반대면 S3 설정이 없을 때(`assertKeyWritable` → `getS3Config()` 가 던짐)
  // 참조 검사에 도달하지 못하고, 그 예외를 잡아 폴백하는 호출부가 살아 있는 참조를 지워 버린다.
  // 참조 검사는 DB 만 보므로 S3 설정과 무관하게 항상 돌 수 있다.
  if (await hasReferences(mediaId)) {
    throw new StorageError('in_use', '아직 사용 중인 이미지입니다. 먼저 연결을 해제해 주세요.')
  }

  // ICAROS 프리픽스 밖이면 여기서 끝난다. `forum/` 도 포함해 우리 것이 아니면 지우지 않는다.
  assertKeyWritable(row.key)

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
    await deleteObject(row.bucket, row.key)
    return { objectRemoved: true, cleanupJobId: null }
  } catch (err) {
    const cleanupJobId = await enqueueCleanup(row.bucket, row.key, describeError(err))
    return { objectRemoved: false, cleanupJobId }
  }
}

/**
 * 삭제 전 연결 entity 재확인 (요구사항 I14).
 * `media.entity_id` 는 업로드 시점의 의도일 뿐이라 신뢰하지 않는다 — 실제 참조 쪽에서 확인한다.
 *
 * 랜딩 이미지에는 전용 FK 컬럼이 없다. `site_settings.value` 가 자유 문자열이고 거기에
 * `/api/media/{id}` 형태로 박히므로, 그 문자열 안에 id 가 있는지까지 봐야 참조 검사가 닫힌다.
 */
/**
 * 이 미디어를 아직 가리키는 곳이 있는가.
 *
 * export 하는 이유: 호출부가 `deleteMedia()` 를 부르기 전에 스스로 확인해야 하는 경우가 있다.
 * `deleteMedia` 는 `assertKeyWritable()`(→ `getS3Config()`)를 먼저 부르므로 `S3_BUCKET` 이
 * 비어 있으면 참조 검사에 도달하기 전에 던진다. 그 예외를 잡아 폴백하는 호출부가
 * 참조 확인 없이 soft delete 하는 경로가 실제로 있었다.
 */
export async function hasReferences(mediaId: string): Promise<boolean> {
  const [rocketRefs, memberRefs, landingRefs] = await Promise.all([
    db.select({ id: rockets.id }).from(rockets).where(eq(rockets.coverMediaId, mediaId)).limit(1),
    db.select({ id: members.id }).from(members).where(eq(members.imageMediaId, mediaId)).limit(1),
    // `mediaId` 는 호출부에서 UUID 임을 확인했으므로 LIKE 와일드카드가 섞일 수 없다.
    // 대소문자 표기가 갈릴 수 있어 ilike 로 본다.
    db
      .select({ key: siteSettings.key })
      .from(siteSettings)
      .where(sql`${siteSettings.value} ilike ${`%${mediaId}%`}`)
      .limit(1),
  ])
  return rocketRefs.length > 0 || memberRefs.length > 0 || landingRefs.length > 0
}

export interface CleanupRunResult {
  processed: number
  completed: number
  /** 재시도 가능한 실패. 다음 실행이 다시 집는다. */
  failed: number
  /** 재시도해도 소용없어 상한까지 올린 건수. 행은 남아 있고 `listAbandonedCleanupJobs()` 로 보인다. */
  abandoned: number
}

/**
 * 실패한 삭제를 재시도한다. 개별 키만 지운다 — 프리픽스 통삭제는 이 계층에 존재하지 않는다.
 * 크론이나 관리 화면에서 호출한다.
 */
export async function runCleanupJobs(limit = 20): Promise<CleanupRunResult> {
  const jobs = await db
    .select()
    .from(storageCleanupJobs)
    .where(and(OPEN_JOB, lt(storageCleanupJobs.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(storageCleanupJobs.createdAt))
    .limit(limit)

  let completed = 0
  let failed = 0
  let abandoned = 0

  for (const job of jobs) {
    try {
      await deleteObject(job.bucket, job.key)
      await db
        .update(storageCleanupJobs)
        .set({ completedAt: new Date(), lastError: null })
        .where(eq(storageCleanupJobs.id, job.id))
      completed += 1
    } catch (err) {
      // 프리픽스 밖 키·다른 버킷은 재시도해도 영원히 거부된다. 애초에 우리가 지워서는 안 되는 대상이다.
      // 재시도만 멈추고 행은 그대로 둔다 — 사람이 볼 수 있어야 조사가 된다.
      const terminal = err instanceof StorageError && err.code === 'forbidden_key'
      await db
        .update(storageCleanupJobs)
        .set({
          attempts: terminal
            ? sql`greatest(${storageCleanupJobs.attempts} + 1, ${sql.raw(String(MAX_ATTEMPTS))})`
            : sql`${storageCleanupJobs.attempts} + 1`,
          lastError: describeError(err),
        })
        .where(eq(storageCleanupJobs.id, job.id))
      if (terminal) abandoned += 1
      else failed += 1
    }
  }

  return { processed: jobs.length, completed, failed, abandoned }
}

export interface AbandonedCleanupJob {
  id: string
  bucket: string
  key: string
  attempts: number
  lastError: string | null
  createdAt: Date
}

/**
 * 상한까지 시도했는데도 지우지 못한 잡 (요구사항 I10 의 가시성 절반).
 * SQL 로는 `where completed_at is null and attempts >= 10`.
 * 여기 뜨는 행은 S3 에 객체가 남아 있을 수 있다는 뜻이므로 사람이 판단해야 한다.
 */
export async function listAbandonedCleanupJobs(limit = 50): Promise<AbandonedCleanupJob[]> {
  return db
    .select({
      id: storageCleanupJobs.id,
      bucket: storageCleanupJobs.bucket,
      key: storageCleanupJobs.key,
      attempts: storageCleanupJobs.attempts,
      lastError: storageCleanupJobs.lastError,
      createdAt: storageCleanupJobs.createdAt,
    })
    .from(storageCleanupJobs)
    .where(and(OPEN_JOB, gte(storageCleanupJobs.attempts, MAX_ATTEMPTS)))
    .orderBy(desc(storageCleanupJobs.createdAt))
    .limit(limit)
}

export interface SweepResult {
  scanned: number
  /** S3 에 실제로 남아 있어 회수 대상이 된 건수 */
  orphansFound: number
  /** 그중 지우지 못해 `pending` 으로 남긴 건수. cleanup 큐에 잡이 있다. */
  orphansPending: number
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
  let orphansPending = 0

  for (const row of stale) {
    let exists = false
    try {
      exists = (await headObject(row.bucket, row.key)) !== null
    } catch {
      // Head 가 실패하면 판정을 미룬다. 다음 스윕이 다시 본다.
      continue
    }

    if (exists) {
      orphansFound += 1
      try {
        await deleteObject(row.bucket, row.key)
      } catch (err) {
        // **행을 지우지 않는다.** soft delete 를 찍으면 살아 있는 객체를 가리키는 유일한 기록이
        // cleanup 잡 하나로 줄어들고, 그 잡이 사라지면 아무 기록도 없는 S3 고아가 된다 —
        // I9 가 막으려던 바로 그 상태다. `pending` 으로 남겨 다음 스윕이 다시 보게 한다.
        await enqueueCleanup(row.bucket, row.key, describeError(err))
        orphansPending += 1
        continue
      }
    }

    await db
      .update(media)
      .set({ status: 'failed', deletedAt: new Date() })
      .where(and(eq(media.id, row.id), eq(media.status, 'pending')))
  }

  return { scanned: stale.length, orphansFound, orphansPending }
}
