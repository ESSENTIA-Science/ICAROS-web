import { sql } from 'drizzle-orm'
import { bigint, check, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { icaros } from './_schema'

export const mediaStatus = icaros.enum('media_status', ['pending', 'ready', 'failed'])

/**
 * S3 오브젝트 메타데이터. 바이트는 S3 에만 있고 여기엔 메타만 둔다 (07 §5).
 * pending → ready 2단계로 두는 이유: DB 트랜잭션과 S3 PUT 이 원자적이지 않기 때문.
 */
export const media = icaros.table(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    originalFilename: text('original_filename'),  // 키에는 넣지 않는다. 다운로드 시 Content-Disposition 용
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }),
    etag: text('etag'),
    width: integer('width'),
    height: integer('height'),
    status: mediaStatus('status').notNull().default('pending'),
    entityType: text('entity_type'),              // 'rocket' | 'member' | 'landing' | 'model' | 'poster'
    entityId: text('entity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('media_key_uq').on(t.bucket, t.key),
    index('media_entity_idx').on(t.entityType, t.entityId),
    index('media_status_idx').on(t.status, t.createdAt),
    // ICAROS 프리픽스 밖의 키를 애초에 기록하지 못하게 막는다 (07 §6 — Versioning 이 꺼져 있어 복구 불가).
    check('media_key_prefix_ck', sql`${t.key} like 'icaros-web/%' or ${t.key} like 'forum/%'`),
    check('media_size_ck', sql`${t.size} is null or ${t.size} >= 0`),
  ]
)

/**
 * 삭제 실패 재시도 큐. S3 delete 는 예외를 삼키지 않고 여기에 적재한다.
 * 프리픽스 통삭제(`s3 rm --recursive`)는 전면 금지 — 개별 키만 지운다.
 */
export const storageCleanupJobs = icaros.table(
  'storage_cleanup_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('storage_cleanup_pending_idx').on(t.completedAt, t.createdAt)]
)
