import 'server-only'

import { asc, eq, sql } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import { versionExpr } from '../_lib/version'

/**
 * 어드민 멤버 DAL. 공개 DAL 과 달리 비공개 부원도 함께 읽는다.
 * 목록 정렬은 공개 페이지와 **같은 키**(sort_order, created_at)를 쓴다 —
 * 어드민에서 본 순서와 실제 노출 순서가 다르면 재정렬 작업이 성립하지 않는다 (E3).
 */

export type AdminMemberListItem = {
  id: string
  name: string
  role: string | null
  squad: string | null
  school: string | null
  sortOrder: number
  published: boolean
}

export type AdminMemberDetail = {
  id: string
  name: string
  role: string
  squad: string
  school: string
  sortOrder: number
  published: boolean
  version: string
}

export async function listMembersForAdmin(): Promise<AdminMemberListItem[]> {
  return db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      role: schema.members.role,
      squad: schema.members.squad,
      school: schema.members.school,
      sortOrder: schema.members.sortOrder,
      published: schema.members.published,
    })
    .from(schema.members)
    .orderBy(asc(schema.members.sortOrder), asc(schema.members.createdAt), asc(schema.members.id))
}

export async function getMemberForAdmin(id: string): Promise<AdminMemberDetail | null> {
  const rows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      role: schema.members.role,
      squad: schema.members.squad,
      school: schema.members.school,
      sortOrder: schema.members.sortOrder,
      published: schema.members.published,
      version: versionExpr(schema.members.updatedAt),
    })
    .from(schema.members)
    .where(eq(schema.members.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    role: row.role ?? '',
    squad: row.squad ?? '',
    school: row.school ?? '',
    sortOrder: row.sortOrder,
    published: row.published,
    version: row.version,
  }
}

/** 이미 쓰이고 있는 부서 이름. 자유 입력이지만 datalist 로 오타·표기 흔들림을 줄인다 (E4). */
export async function listSquads(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ squad: schema.members.squad })
    .from(schema.members)
    .orderBy(asc(schema.members.squad))
  return rows
    .map((r) => r.squad)
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
}

export async function nextMemberSortOrder(): Promise<number> {
  const rows = await db
    .select({ next: sql<number>`coalesce(max(${schema.members.sortOrder}), -1) + 1` })
    .from(schema.members)
  return rows[0]?.next ?? 0
}
