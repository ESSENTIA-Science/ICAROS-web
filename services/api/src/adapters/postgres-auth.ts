import type { SessionStore, StoredAdminSession } from '../auth/index.js'
import type { LoginDependencies } from '../login.js'

export interface AuthSqlClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

/** Supply the existing Argon2id verifier at composition time. The adapter never handles raw password hashes in SQL. */
export function createPostgresAuthAdapters(db: AuthSqlClient, options: {
  verifyPassword: LoginDependencies['verifyPassword']
}): { authSessions: SessionStore; login: LoginDependencies } {
  if (typeof options.verifyPassword !== 'function') throw new Error('Argon2id verifier is required')
  return {
    authSessions: {
      async findByTokenHash(tokenHash) {
        const result = await db.query(`select s.id as session_id, s.user_id, u.email, u.display_name,
          s.token_hash, s.created_at, s.expires_at, s.last_seen_at, s.revoked_at,
          u.is_active, u.password_changed_at
          from icaros.admin_sessions s join icaros.admin_users u on u.id = s.user_id
          where s.token_hash = $1`, [tokenHash])
        const row = result.rows[0]
        if (!row) return null
        return {
          sessionId: row.session_id, userId: row.user_id, email: row.email,
          displayName: row.display_name, tokenHash: row.token_hash,
          createdAt: row.created_at, expiresAt: row.expires_at,
          lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at,
          isActive: row.is_active, passwordChangedAt: row.password_changed_at,
        } as StoredAdminSession
      },
      async touch(sessionId, at) {
        await db.query(`update icaros.admin_sessions s set last_seen_at = $2
          from icaros.admin_users u where s.id = $1 and u.id = s.user_id
          and u.is_active and s.revoked_at is null and s.expires_at > $2
          and u.password_changed_at <= s.created_at and s.last_seen_at <= $2
          and s.last_seen_at <= $2 - interval '5 minutes'`, [sessionId, at])
      },
    },
    login: {
      attempts: {
        async consume(ip) {
          // A single UPSERT serializes concurrent requests for the same IP.
          const result = await db.query(`insert into icaros.login_attempts
            (key, fail_count, first_fail_at, last_fail_at, locked_until)
            values ($1, 1, now(), now(), null)
            on conflict (key) do update set
              fail_count = case when login_attempts.first_fail_at < now() - interval '24 hours'
                then 1 else login_attempts.fail_count + 1 end,
              first_fail_at = case when login_attempts.first_fail_at < now() - interval '24 hours'
                then now() else login_attempts.first_fail_at end,
              last_fail_at = now(),
              locked_until = case
                when login_attempts.first_fail_at < now() - interval '24 hours' then null
                when login_attempts.fail_count + 1 >= 8 then now() + interval '1 hour'
                when login_attempts.fail_count + 1 = 7 then now() + interval '15 minutes'
                when login_attempts.fail_count + 1 = 6 then now() + interval '5 minutes'
                when login_attempts.fail_count + 1 = 5 then now() + interval '1 minute'
                else null end
            where login_attempts.locked_until is null or login_attempts.locked_until <= now()
            returning true as allowed`, [`ip:${ip}`])
          return result.rows.length > 0
        },
        async reset(ip) {
          await db.query('delete from icaros.login_attempts where key = $1', [`ip:${ip}`])
        },
      },
      accounts: {
        async findByEmail(email) {
          const result = await db.query(`select id, password_hash, is_active
            from icaros.admin_users where email = $1`, [email])
          const row = result.rows[0]
          return row ? { id: row.id as string, passwordHash: row.password_hash as string,
            isActive: row.is_active as boolean } : null
        },
      },
      verifyPassword: options.verifyPassword,
      sessions: {
        async create({ userId, tokenHash, expiresAt, ip }) {
          await db.query(`insert into icaros.admin_sessions
            (user_id, token_hash, expires_at, ip) values ($1, $2, $3, $4)`,
          [userId, tokenHash, expiresAt, ip])
        },
        async revoke(sessionId) {
          await db.query(`update icaros.admin_sessions set revoked_at = now()
            where id = $1 and revoked_at is null`, [sessionId])
        },
      },
    },
  }
}
