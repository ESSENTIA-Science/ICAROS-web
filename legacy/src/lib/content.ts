import 'server-only'

import { cache } from 'react'
import { db, schema } from '@/lib/db'

export type SiteContent = Record<string, string>

/**
 * 랜딩 카피 전체를 { key: value } 로 읽는다.
 *
 * 레거시 home.jsx 는 DEFAULTS 하드코딩 사본을 두고 DB 값을 그 위에 덮었는데,
 * 두 벌이 어긋난 채로 방치돼 있었다 (01 §5). 폴백 사본을 두지 않는다 —
 * DB 가 유일한 원본이고, 값이 없으면 그 자리는 비워 둔다.
 */
export const getSiteContent = cache(async (): Promise<SiteContent> => {
  const rows = await db
    .select({ key: schema.siteSettings.key, value: schema.siteSettings.value })
    .from(schema.siteSettings)

  const out: SiteContent = {}
  for (const r of rows) if (r.value != null && r.value !== '') out[r.key] = r.value
  return out
})

/**
 * 실패를 삼키는 변형. **루트 레이아웃 전용**이다.
 *
 * `app/layout.tsx` 는 `/admin` 로그인 화면을 포함한 모든 라우트를 감싼다. 거기서 던지면
 * DB 장애가 곧 전체 500 이 되어 복구할 창구까지 사라진다. 메타데이터는 카피와 달리
 * "값이 없으면 비워 둔다"가 성립하지 않으므로(빈 `<title>`·사라진 메뉴), 호출부가
 * 코드 기본값으로 되돌린다.
 */
export const getSiteContentSafe = cache(async (): Promise<SiteContent> => {
  try {
    return await getSiteContent()
  } catch {
    console.error('[content] site_settings 조회 실패 — 기본값으로 렌더합니다')
    return {}
  }
})

/**
 * 헤더 메뉴 (A2 · F10). 라벨만 CMS 가 정하고 **경로는 코드가 정한다** —
 * 잘못된 href 는 운영자가 고칠 수 없는 종류의 사고이고, 여기 없는 경로를 CMS 에서
 * 만들 수 있게 하면 라우트가 없는 링크가 생긴다.
 */
export const NAV_ITEMS = [
  { href: '/#about', key: 'nav.about', fallback: 'About Us' },
  // `key` 는 `nav.rocket` 그대로 둔다 — `site_settings` 의 행 이름이다. 바꾸면 그 행을
  // 못 찾아 라벨이 조용히 아래 `fallback` 으로 떨어진다(팀이 /admin 에서 고친 값이 사라진다).
  { href: '/vehicles', key: 'nav.rocket', fallback: 'Vehicles' },
  { href: '/posts', key: 'nav.posts', fallback: 'Posts' },
  { href: '/member', key: 'nav.member', fallback: 'Members' },
] as const

export type NavItem = { readonly href: string; readonly label: string }

/** 행이 없거나 비었으면 코드 기본값으로. 내비게이션은 비어 있어도 되는 자리가 아니다. */
export const getNavItems = (c: SiteContent): readonly NavItem[] =>
  NAV_ITEMS.map((item) => ({ href: item.href, label: c[item.key] ?? item.fallback }))

/**
 * SEO·OG (F10). 기본값은 **DB 행이 없을 때만** 쓰인다 — 관리자가 값을 비우는 경로는
 * `_data/landing.ts` 에서 required 로 막아 두었다. 두 벌이 갈라져도 조용히 넘어가지 않게
 * 여기 한 곳에만 둔다.
 */
export const SEO_FALLBACK = {
  title: 'ICAROS',
  description:
    'ICAROS는 학생 주도 항공우주·로켓 연구팀으로 무인기 설계, 비행 제어, 고체연료 로켓 개발과 발사를 수행합니다.',
  ogImage: '/og.png',
} as const

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SeoContent = { readonly title: string; readonly description: string; readonly ogImage: string }

/**
 * OG 이미지는 media id 로 저장하고 여기서 프록시 URL 로 바꾼다 (D3/D15).
 * id 가 UUID 형태가 아니면 존재하지 않는 URL 을 만드는 대신 정적 파일로 되돌린다 —
 * 오타 하나가 모든 공유 링크의 썸네일을 깨뜨리는 일을 막는다.
 */
export const getSeo = (c: SiteContent): SeoContent => {
  const mediaId = c['og.image_media_id']?.trim()
  return {
    title: c['seo.title'] ?? SEO_FALLBACK.title,
    description: c['seo.description'] ?? SEO_FALLBACK.description,
    ogImage: mediaId && UUID_SHAPE.test(mediaId) ? `/api/media/${mediaId}` : SEO_FALLBACK.ogImage,
  }
}

/**
 * Instagram 값은 **핸들만** 저장돼 있고, 운영자가 `@` 를 붙여 넣는 일이 실제로 있다.
 * 표기용 핸들과 URL 을 여기 한 곳에서 만든다 — 랜딩 Contact 와 `/posts` 두 곳이 쓰므로
 * 사본을 두면 `@` 처리가 언젠가 갈라진다.
 */
export const instagramHandle = (handle: string): string => handle.replace(/^@/, '')

export const instagramUrl = (handle: string): string =>
  `https://www.instagram.com/${encodeURIComponent(instagramHandle(handle))}/`

/** `\n` 구분 리스트를 배열로. 빈 줄은 버린다. */
export const toList = (v: string | undefined): string[] =>
  (v ?? '').split('\n').map((s) => s.trim()).filter(Boolean)

/**
 * 후원 금액 같은 수치 문자열을 숫자로.
 * 운영자가 CMS 에 `3,200,000` 처럼 콤마를 넣어 저장하는 일이 실제로 일어난다.
 * 그대로 Number() 하면 NaN → 0 이 되어 화면에 `/ 0`, `0%` 가 뜨고 에러도 로그도 남지 않는다.
 */
export const toNumber = (v: string | undefined): number => {
  if (v == null) return 0
  const n = Number(String(v).replace(/[,\s_]/g, ''))
  return Number.isFinite(n) ? n : 0
}
