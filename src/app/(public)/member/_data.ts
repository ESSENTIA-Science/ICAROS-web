import 'server-only'

import { and, asc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import { mediaUrl } from '@/lib/image/contract'

/** 사진이 없는 부원 23/27 명이 이 이미지를 쓴다 (E6). */
export const MEMBER_PLACEHOLDER = '/assets/img/member/profile.webp'

export type MemberDto = {
  id: string
  name: string
  role: string | null
  squad: string | null
  school: string | null
  imageSrc: string
  /**
   * 실제 사진인지, 27명 중 23명이 공유하는 플레이스홀더인지.
   * 뷰가 `imageSrc === MEMBER_PLACEHOLDER` 로 문자열 비교를 하게 두면 경로가 바뀌는 날
   * 조용히 틀린다. 판정을 해석이 일어나는 자리(DAL)에 둔다.
   */
  hasPhoto: boolean
}

export type MemberSquad = {
  /**
   * 부서명 원본. 소속이 없는 그룹은 **null 센티널**이다 — 표시 라벨은 렌더 시점에 붙인다.
   * 문자열 '기타' 를 센티널로 쓰면 운영자가 실제 부서명을 '기타'로 넣는 순간 같은 이름의
   * 그룹이 둘 생기고 key 까지 겹친다. 자유 텍스트와 센티널은 네임스페이스를 나눈다.
   */
  squad: string | null
  /** React key. 자유 텍스트와 센티널이 절대 충돌하지 않도록 접두사를 붙인다. */
  key: string
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
      // 신규(S3) 와 레거시(레포 public/) 두 세대가 공존한다. P9 가 레거시를 옮기면 뒤엣것을 뺀다.
      // media 를 left join 해 ready + 미삭제일 때만 신규 경로를 쓴다 — 조인 없이 컬럼만 읽으면
      // 미디어가 정리된 뒤에도 죽은 URL 을 계속 내보낸다.
      mediaId: schema.media.id,
      legacyImagePath: schema.members.legacyImagePath,
    })
    .from(schema.members)
    .leftJoin(
      schema.media,
      and(
        eq(schema.media.id, schema.members.imageMediaId),
        eq(schema.media.status, 'ready'),
        isNull(schema.media.deletedAt)
      )
    )
    .where(eq(schema.members.published, true))
    .orderBy(asc(schema.members.sortOrder), asc(schema.members.createdAt), asc(schema.members.id))

  return rows.map((r) => {
    const imageSrc = resolveMemberImage(r.mediaId, r.legacyImagePath)
    return {
      id: r.id,
      name: r.name,
      role: blankToNull(r.role),
      squad: blankToNull(r.squad),
      school: blankToNull(r.school),
      imageSrc,
      hasPhoto: imageSrc !== MEMBER_PLACEHOLDER,
    }
  })
}

const blankToNull = (v: string | null): string | null => (v && v.trim() !== '' ? v.trim() : null)

/** 신규(S3) → 레거시 레포 경로 → 플레이스홀더 순 (E6). */
function resolveMemberImage(mediaId: string | null, legacyPath: string | null): string {
  if (mediaId) return mediaUrl(mediaId)
  const v = legacyPath?.trim()
  return v ? v : MEMBER_PLACEHOLDER
}

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

  const out: MemberSquad[] = [...groups].map(([squad, list]) => ({
    squad,
    key: `squad:${squad}`,
    members: list,
  }))
  if (unassigned.length > 0) out.push({ squad: null, key: 'unassigned', members: unassigned })
  return out
}
