import 'server-only'
import { getSnapshot } from '@/lib/content/snapshot'
export const MEMBER_PLACEHOLDER = '/assets/img/member/profile.webp'
export type MemberDto = { id: string; name: string; role: string | null; squad: string | null; school: string | null; bioMd: string | null; imageSrc: string; hasPhoto: boolean }
export type MemberSquad = { squad: string | null; key: string; members: MemberDto[] }
export const listMembersSafe = async (): Promise<MemberDto[]> => getSnapshot().members
export function groupBySquad(members: readonly MemberDto[]): MemberSquad[] {
  const groups = new Map<string, MemberDto[]>(); const unassigned: MemberDto[] = []
  for (const member of members) {
    if (!member.squad) { unassigned.push(member); continue }
    const bucket = groups.get(member.squad)
    if (bucket) bucket.push(member)
    else groups.set(member.squad, [member])
  }
  const out: MemberSquad[] = [...groups].map(([squad, list]) => ({ squad, key: `squad:${squad}`, members: list }))
  if (unassigned.length) out.push({ squad: null, key: 'unassigned', members: unassigned })
  return out
}
