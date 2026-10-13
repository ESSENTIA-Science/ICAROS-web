import 'server-only'
import { getSnapshot } from '@/lib/content/snapshot'
export const MEMBER_PLACEHOLDER = '/assets/img/member/profile.webp'
export type MemberDto = { id: string; name: string; role: string | null; squad: string | null; squads?: string[]; departmentIds?: string[]; school: string | null; bioMd: string | null; imageSrc: string; hasPhoto: boolean }
export type Department = { id: string; name: string; sortOrder: number; leadMemberId?: string | null }
export const listDepartmentsSafe = async (): Promise<readonly Department[]> => getSnapshot().departments ?? []
export type MemberSquad = { squad: string | null; key: string; members: MemberDto[] }
export const listMembersSafe = async (): Promise<MemberDto[]> => getSnapshot().members
export function groupBySquad(members: readonly MemberDto[], departments: readonly Department[] = []): MemberSquad[] {
  const catalog = [...departments].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const names = new Map(catalog.map(department => [department.id.toLowerCase(), department.name]))
  const groups = new Map<string, MemberDto[]>(); const unassigned: MemberDto[] = []
  for (const member of members) {
    const squads = member.departmentIds?.map(id => id.toLowerCase()) ?? member.squads ?? (member.squad ? [member.squad] : [])
    if (!squads.length) { unassigned.push(member); continue }
    for (const squad of new Set(squads)) {
      if (member.departmentIds !== undefined && !names.has(squad)) continue
      const bucket = groups.get(squad)
      if (bucket) bucket.push(member)
      else groups.set(squad, [member])
    }
  }
  for (const department of catalog) {
    const list = groups.get(department.id.toLowerCase())
    const index = list?.findIndex(member => member.id.toLowerCase() === department.leadMemberId?.toLowerCase()) ?? -1
    if (list && index > 0) list.unshift(...list.splice(index, 1))
  }
  const order = new Map(catalog.map((department, index) => [department.id.toLowerCase(), index]))
  const out: MemberSquad[] = [...groups].sort(([a], [b]) =>
    (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER))
    .map(([squad, list]) => ({ squad: names.get(squad) ?? squad, key: `squad:${squad}`, members: list }))
  if (unassigned.length) out.push({ squad: null, key: 'unassigned', members: unassigned })
  return out
}
