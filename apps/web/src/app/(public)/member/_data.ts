import 'server-only'
import { getSnapshot } from '@/lib/content/snapshot'
export const MEMBER_PLACEHOLDER = '/assets/img/member/profile.webp'
export type MemberDto = { id: string; name: string; role: string | null; squad: string | null; squads?: string[]; school: string | null; bioMd: string | null; imageSrc: string; hasPhoto: boolean }
export type MemberSquad = { squad: string | null; key: string; members: MemberDto[] }
export const listMembersSafe = async (): Promise<MemberDto[]> => getSnapshot().members
export function groupBySquad(members: readonly MemberDto[]): MemberSquad[] {
  const groups = new Map<string, MemberDto[]>(); const unassigned: MemberDto[] = []
  for (const member of members) {
    const squads = member.squads ?? (member.squad ? [member.squad] : [])
    if (!squads.length) { unassigned.push(member); continue }
    for (const squad of new Set(squads)) {
      const bucket = groups.get(squad)
      if (bucket) bucket.push(member)
      else groups.set(squad, [member])
    }
  }
  const out: MemberSquad[] = [...groups].map(([squad, list]) => ({ squad, key: `squad:${squad}`, members: list }))
  if (unassigned.length) out.push({ squad: null, key: 'unassigned', members: unassigned })
  return out
}
