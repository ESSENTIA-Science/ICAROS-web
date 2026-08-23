import 'server-only'

import { asc, eq } from 'drizzle-orm'
import { db, schema } from '@/lib/db'

/** 사진이 없는 부원 23/27 명이 이 이미지를 쓴다 (E6). */
export const MEMBER_PLACEHOLDER = '/assets/img/member/profile.webp'

/** squad 가 비어 있는 부원을 모을 그룹. 마지막에 온다. */
export const UNASSIGNED_SQUAD = '기타'

export type MemberDto = {
  id: string
  name: string
  role: string | null
  squad: string | null
  school: string | null
  imageSrc: string
}

export type MemberSquad = {
  /** 화면에 찍히는 이름. squad 가 null 인 그룹은 UNASSIGNED_SQUAD. */
  label: string
  members: MemberDto[]
}

/**
 * 레거시는 sort_order 5 가 3행에 중복이라 새로고침마다 순서가 달라졌다 (01 §8 결함 #4).
 * 스키마가 unique 를 걸지 않기로 한 대신, 조회를 항상 (sort_order, created_at, id) 로 고정한다 (E3).
 */
export async function listMembers(): Promise<MemberDto[]> {
  const rows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      role: schema.members.role,
      squad: schema.members.squad,
      school: schema.members.school,
      imageSrc: schema.members.legacyImagePath,
    })
    .from(schema.members)
    .where(eq(schema.members.published, true))
    .orderBy(asc(schema.members.sortOrder), asc(schema.members.createdAt), asc(schema.members.id))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: blankToNull(r.role),
    squad: blankToNull(r.squad),
    school: blankToNull(r.school),
    imageSrc: r.imageSrc && r.imageSrc.trim() !== '' ? r.imageSrc : MEMBER_PLACEHOLDER,
  }))
}

const blankToNull = (v: string | null): string | null => (v && v.trim() !== '' ? v.trim() : null)

/**
 * 부서별 그룹 (E4). 그룹 순서는 정렬된 명단에서 그 부서가 **처음 등장한 위치**를 따른다 —
 * 부서 순서를 따로 관리하는 컬럼이 없으므로 sort_order 가 사실상의 조직도 순서다.
 * squad 가 없는 사람은 어떤 부서에도 끼지 않으므로 항상 마지막 그룹으로 밀어낸다.
 */
export function groupBySquad(members: readonly MemberDto[]): MemberSquad[] {
  const groups = new Map<string, MemberDto[]>()
  const unassigned: MemberDto[] = []

  for (const m of members) {
    if (m.squad == null) {
      unassigned.push(m)
      continue
    }
    const bucket = groups.get(m.squad)
    if (bucket) bucket.push(m)
    else groups.set(m.squad, [m])
  }

  const out: MemberSquad[] = [...groups].map(([label, list]) => ({ label, members: list }))
  if (unassigned.length > 0) out.push({ label: UNASSIGNED_SQUAD, members: unassigned })
  return out
}
