import type { DepartmentRepository, DepartmentTransaction } from '../departments.js'

export interface DepartmentSqlClient {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  release(): void
}

export interface DepartmentSqlPool {
  connect(): Promise<DepartmentSqlClient>
}

const versionSql = `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** A checked-out connection is mandatory: pool.query cannot keep BEGIN and the writes on one session. */
export function createPostgresDepartmentRepository(pool: DepartmentSqlPool): DepartmentRepository {
  return {
    async transaction<T>(work: (tx: DepartmentTransaction) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      let committed = false
      try {
        await client.query('BEGIN')
        const tx: DepartmentTransaction = {
          async lockDepartment(id) {
            // FOR UPDATE conflicts with the FK's KEY SHARE lock on a new member assignment.
            const result = await client.query(
              `select ${versionSql} as version from icaros.departments where id = $1 for update`, [id])
            const version = result.rows[0]?.version
            if (version === undefined) return null
            if (typeof version !== 'string') throw new TypeError('Invalid department version')
            return { version }
          },
          async countMembers(id) {
            // Lock existing assignments until the source row is deleted.
            const result = await client.query(
              'select id from icaros.members where department_id = $1 for update', [id])
            return result.rows.length
          },
          async departmentExists(id) {
            // Hold the destination key lock until the reassignment commits.
            const result = await client.query(
              'select id from icaros.departments where id = $1 for key share', [id])
            return result.rows.length > 0
          },
          async reassignMembers(fromId, toId) {
            if (toId === null) {
              await client.query(`update icaros.members as m
                set department_id = null, squad = null,
                    updated_at = greatest(clock_timestamp(), m.updated_at + interval '1 microsecond')
                where m.department_id = $1`, [fromId])
            } else {
              // Mirror the legacy squad reader from the destination's canonical name.
              await client.query(`update icaros.members as m
                set department_id = destination.id, squad = destination.name,
                    updated_at = greatest(clock_timestamp(), m.updated_at + interval '1 microsecond')
                from icaros.departments as destination
                where m.department_id = $1 and destination.id = $2`, [fromId, toId])
            }
          },
          async deleteIfVersion(id, version) {
            const result = await client.query(
              `delete from icaros.departments where id = $1 and ${versionSql} = $2 returning id`, [id, version])
            return result.rows.length === 1
          },
        }
        const result = await work(tx)
        await client.query('COMMIT')
        committed = true
        return result
      } catch (error) {
        if (!committed) {
          try { await client.query('ROLLBACK') } catch { /* Preserve the original failure. */ }
        }
        throw error
      } finally {
        client.release()
      }
    },
  }
}
