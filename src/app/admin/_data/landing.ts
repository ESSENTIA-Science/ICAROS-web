import 'server-only'

import { asc, inArray } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import { maxVersionExpr } from '../_lib/version'

/**
 * 랜딩 카피 카탈로그 — `icaros.site_settings` 26키의 **유일한 목록**.
 *
 * 여기 없는 키는 폼에 뜨지도, 저장되지도 않는다(화이트리스트). 반대로 여기 있는데 DB 에 없으면
 * 로드 자체를 실패로 본다 — 값을 모른 채 빈 입력을 그리면 저장 시 그 키가 공백으로 덮인다.
 * 그게 레거시의 최악 결함이었다 (F8 / 01 §8 결함 #1).
 */
export type LandingFieldKind = 'text' | 'slogan' | 'multiline' | 'list' | 'number'

export type LandingField = {
  readonly key: string
  readonly label: string
  readonly kind: LandingFieldKind
  readonly hint?: string
  /**
   * 비워 둘 수 없는 필드. 공개 페이지가 값이 없어도 섹션을 통째로 접도록 만들어져 있어
   * 대부분은 선택 입력이다. 여기 true 인 넷은 **소비처가 조건 없이 그리거나 계산에 쓰는** 값이다.
   */
  readonly required: boolean
}

export type LandingGroup = {
  readonly id: string
  readonly title: string
  readonly fields: readonly LandingField[]
}

const SLOGAN_HINT = '강조할 단어를 **별표 두 개**로 감싸면 액센트 색으로 표시됩니다.'
const LIST_HINT = '한 줄에 하나씩 입력합니다. 빈 줄은 무시됩니다.'

export const LANDING_GROUPS: readonly LandingGroup[] = [
  {
    id: 'hero',
    title: 'Hero',
    fields: [{ key: 'hero.tagline', label: '태그라인', kind: 'text', required: false }],
  },
  {
    id: 'about',
    title: 'About us',
    fields: [
      { key: 'about.slogan', label: '슬로건', kind: 'slogan', hint: SLOGAN_HINT, required: false },
      { key: 'about.body', label: '본문', kind: 'multiline', required: false },
    ],
  },
  {
    id: 'vision',
    title: 'Vision',
    fields: [
      { key: 'vision.slogan', label: '슬로건', kind: 'slogan', hint: SLOGAN_HINT, required: false },
      { key: 'vision.body', label: '본문', kind: 'multiline', required: false },
    ],
  },
  {
    id: 'research',
    title: 'Research Areas',
    fields: [
      { key: 'research.uav.title', label: '무인기 · 제목', kind: 'text', required: false },
      { key: 'research.uav.body', label: '무인기 · 본문', kind: 'multiline', required: false },
      { key: 'research.control.title', label: '비행제어 · 제목', kind: 'text', required: false },
      { key: 'research.control.body', label: '비행제어 · 본문', kind: 'multiline', required: false },
      { key: 'research.rocketry.title', label: '추진 · 제목', kind: 'text', required: false },
      { key: 'research.rocketry.body', label: '추진 · 본문', kind: 'multiline', required: false },
    ],
  },
  {
    id: 'mission',
    title: 'Mission',
    fields: [
      { key: 'mission.body', label: '본문', kind: 'multiline', required: false },
      { key: 'mission.list_intro', label: '목록 도입 문장', kind: 'text', required: false },
      { key: 'mission.list', label: '활동 목록', kind: 'list', hint: LIST_HINT, required: false },
    ],
  },
  {
    id: 'donate',
    title: 'Donate',
    fields: [
      { key: 'donate.intro', label: '도입 문단', kind: 'multiline', required: false },
      { key: 'donate.usage_title', label: '사용처 제목', kind: 'text', required: false },
      { key: 'donate.usage_list', label: '사용처 목록', kind: 'list', hint: LIST_HINT, required: false },
      { key: 'donate.quote', label: '인용구', kind: 'text', required: false },
      { key: 'donate.outro', label: '마무리 문장', kind: 'multiline', required: false },
      { key: 'donate.cta_label', label: 'CTA 버튼 문구', kind: 'text', required: false },
      {
        key: 'donation.goal',
        label: '후원 목표액 (원)',
        kind: 'number',
        hint: '진행률 계산에 쓰입니다.',
        required: true,
      },
      { key: 'donation.current', label: '현재 모금액 (원)', kind: 'number', required: true },
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    fields: [
      { key: 'contact.body', label: '본문', kind: 'multiline', required: false },
      {
        key: 'contact.email',
        label: '이메일',
        kind: 'text',
        hint: 'Contact 섹션이 꺼져 있을 때 후원 CTA 가 이 주소로 연결됩니다.',
        required: true,
      },
      {
        key: 'contact.instagram',
        label: 'Instagram 아이디',
        kind: 'text',
        hint: '@ 없이 아이디만 입력합니다.',
        required: false,
      },
    ],
  },
  {
    id: 'footer',
    title: 'Footer',
    fields: [
      {
        key: 'footer.copyright',
        label: '저작권 표기',
        kind: 'text',
        hint: '모든 공개 페이지 하단에 조건 없이 표시됩니다.',
        required: true,
      },
    ],
  },
]

export const LANDING_FIELDS: readonly LandingField[] = LANDING_GROUPS.flatMap((g) => g.fields)
export const LANDING_KEYS: readonly string[] = LANDING_FIELDS.map((f) => f.key)

export type AdminSectionRow = {
  id: string
  label: string
  enabled: boolean
  sortOrder: number
}

export type LandingData = {
  /** 카탈로그의 모든 키가 채워져 있음이 보장된다. */
  values: Readonly<Record<string, string>>
  version: string
  sections: readonly AdminSectionRow[]
  /** 섹션이 하나도 없으면 null — 저장할 대상이 없다는 뜻이다. */
  sectionsVersion: string | null
}

export type LandingLoad = { ok: true; data: LandingData } | { ok: false; error: string }

/**
 * 랜딩 편집에 필요한 것을 **전부 또는 아무것도** 로 읽는다 (F8).
 *
 * 실패를 `{}` 로 흡수하지 않는 것이 이 함수의 존재 이유다. 호출부는 `ok:false` 일 때
 * 폼을 그리지 않고 에러 화면만 낸다 — 그러면 저장 버튼 자체가 DOM 에 없어서
 * "빈 폼을 저장해 카피를 날리는" 경로가 구조적으로 사라진다.
 */
export async function loadLanding(): Promise<LandingLoad> {
  let rows: { key: string; value: string | null }[]
  let version: string | null
  let sectionRows: AdminSectionRow[]
  let sectionsVersion: string | null

  try {
    const settings = await db
      .select({ key: schema.siteSettings.key, value: schema.siteSettings.value })
      .from(schema.siteSettings)
      .where(inArray(schema.siteSettings.key, [...LANDING_KEYS]))

    const versionRows = await db
      .select({ v: maxVersionExpr(schema.siteSettings.updatedAt) })
      .from(schema.siteSettings)
      .where(inArray(schema.siteSettings.key, [...LANDING_KEYS]))

    sectionRows = await db
      .select({
        id: schema.pageSections.id,
        label: schema.pageSections.label,
        enabled: schema.pageSections.enabled,
        sortOrder: schema.pageSections.sortOrder,
      })
      .from(schema.pageSections)
      .orderBy(asc(schema.pageSections.sortOrder), asc(schema.pageSections.id))

    const sectionVersionRows = await db
      .select({ v: maxVersionExpr(schema.pageSections.updatedAt) })
      .from(schema.pageSections)

    rows = settings
    version = versionRows[0]?.v ?? null
    sectionsVersion = sectionVersionRows[0]?.v ?? null
  } catch {
    // 에러 객체를 화면으로 흘리지 않는다. 서버 로그에도 메시지만 남긴다.
    console.error('[admin] 랜딩 콘텐츠 조회 실패')
    return {
      ok: false,
      error: '랜딩 콘텐츠를 불러오지 못했습니다. 데이터베이스 연결을 확인한 뒤 새로고침해 주세요.',
    }
  }

  const found = new Map(rows.map((r) => [r.key, r.value ?? '']))
  const missing = LANDING_KEYS.filter((k) => !found.has(k))
  if (missing.length > 0 || version === null) {
    return {
      ok: false,
      error:
        `설정 항목 ${missing.length}개를 찾을 수 없어 편집을 막았습니다: ${missing.join(', ')}. ` +
        '이 상태로 저장하면 해당 항목이 빈 값으로 덮어써집니다. DB 에 행을 복구한 뒤 다시 시도해 주세요.',
    }
  }

  const values: Record<string, string> = {}
  for (const key of LANDING_KEYS) values[key] = found.get(key) ?? ''

  return { ok: true, data: { values, version, sections: sectionRows, sectionsVersion } }
}
