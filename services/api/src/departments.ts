/** Department deletion must be one DB transaction. The adapter must lock the source
 * department and its members and serialize new assignments until commit. */
export interface DepartmentTransaction {
  lockDepartment(id: string): Promise<{ version: string } | null>
  countMembers(id: string): Promise<number>
  departmentExists(id: string): Promise<boolean>
  reassignMembers(fromId: string, toId: string | null): Promise<void>
  deleteIfVersion(id: string, version: string): Promise<boolean>
}

export interface DepartmentRepository {
  transaction<T>(work: (tx: DepartmentTransaction) => Promise<T>): Promise<T>
}

export type DeleteDepartmentResult =
  | { ok: true; reassigned: number }
  | { ok: false; code: 'DENIED' | 'MALFORMED' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'DEPARTMENT_HAS_MEMBERS' | 'DESTINATION_NOT_FOUND' | 'UNAVAILABLE'; memberCount?: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createDepartmentService<Request>(deps: {
  requireAdmin: (request: Request) => Promise<boolean>
  repository: DepartmentRepository
}) {
  if (typeof deps?.requireAdmin !== 'function' || typeof deps.repository?.transaction !== 'function') {
    throw new TypeError('Department authorization and repository are required')
  }
  return {
    async delete(request: Request, input: {
      id: string; version: string; reassignTo?: string | null
    }): Promise<DeleteDepartmentResult> {
      try {
        if (await deps.requireAdmin(request) !== true) return { ok: false, code: 'DENIED' }
      } catch { return { ok: false, code: 'DENIED' } }
      if (!input || !UUID.test(input.id) || !input.version || input.version.length > 200 ||
          (input.reassignTo !== undefined && input.reassignTo !== null && !UUID.test(input.reassignTo)) ||
          input.reassignTo === input.id) return { ok: false, code: 'MALFORMED' }
      try {
        return await deps.repository.transaction(async (tx) => {
          const source = await tx.lockDepartment(input.id)
          if (!source) return { ok: false, code: 'NOT_FOUND' }
          if (source.version !== input.version) return { ok: false, code: 'VERSION_CONFLICT' }
          const count = await tx.countMembers(input.id)
          if (count > 0 && input.reassignTo === undefined) {
            return { ok: false, code: 'DEPARTMENT_HAS_MEMBERS', memberCount: count }
          }
          if (input.reassignTo && !(await tx.departmentExists(input.reassignTo))) {
            return { ok: false, code: 'DESTINATION_NOT_FOUND' }
          }
          if (count > 0) await tx.reassignMembers(input.id, input.reassignTo ?? null)
          if (!(await tx.deleteIfVersion(input.id, input.version))) {
            throw new Error('Concurrent department change')
          }
          return { ok: true, reassigned: count }
        })
      } catch { return { ok: false, code: 'UNAVAILABLE' } }
    },
  }
}
