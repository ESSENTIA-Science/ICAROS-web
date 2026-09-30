import { sql } from 'drizzle-orm'
import { boolean, check, customType, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { icaros } from './_schema'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/** 이메일은 lower() 유니크 인덱스로 정규화를 강제한다 (citext 가용 여부 미확인 — 06 §11). */
export const adminUsers = icaros.table(
  'admin_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),   // Argon2id PHC 문자열
    displayName: text('display_name'),
    isActive: boolean('is_active').notNull().default(true),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('admin_users_email_uq').on(sql`lower(${t.email})`),
    check('admin_users_email_ck', sql`${t.email} = lower(btrim(${t.email}))`),
    check('admin_users_hash_ck', sql`${t.passwordHash} like '$argon2id$%'`),
  ]
)

/**
 * 쿠키에는 원문 토큰, DB 에는 SHA-256 해시만 (06 §4).
 * DB 가 유출돼도 세션을 만들 수 없다.
 */
export const adminSessions = icaros.table(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('admin_sessions_token_uq').on(t.tokenHash),
    index('admin_sessions_user_idx').on(t.userId, t.revokedAt),
    index('admin_sessions_expiry_idx').on(t.expiresAt),
  ]
)

/** 비밀번호·토큰·해시를 절대 넣지 않는다 (06 §10). */
export const authEvents = icaros.table(
  'auth_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').notNull(),
    emailAttempted: text('email_attempted'),
    userId: uuid('user_id'),               // FK 아님 — 계정 삭제 후에도 로그를 보존한다
    ip: text('ip'),
    userAgent: text('user_agent'),
    detail: jsonb('detail'),
  },
  (t) => [
    index('auth_events_at_idx').on(t.at),
    index('auth_events_kind_idx').on(t.kind, t.at),
    check(
      'auth_events_kind_ck',
      sql`${t.kind} in ('login_success','login_fail','logout','session_expired','password_changed','admin_deactivated','rate_limited','bootstrap')`
    ),
  ]
)

/** 서버리스라 in-memory 카운터를 신뢰할 수 없어 DB 기반으로 둔다 (06 §6). */
export const loginAttempts = icaros.table(
  'login_attempts',
  {
    key: text('key').primaryKey(),         // 'ip:1.2.3.4' | 'email:a@b.c'
    failCount: integer('fail_count').notNull().default(0),
    firstFailAt: timestamp('first_fail_at', { withTimezone: true }),
    lastFailAt: timestamp('last_fail_at', { withTimezone: true }),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [
    index('login_attempts_locked_idx').on(t.lockedUntil),
    check('login_attempts_count_ck', sql`${t.failCount} >= 0`),
  ]
)
