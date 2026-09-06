import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { icaros } from './_schema'
import { media } from './media'

/**
 * 랜딩 패널 — **사진 한 장 + 그 위에 얹는 텍스트.**
 *
 * 랜딩은 섹션 컴포넌트를 손으로 조립한 페이지가 아니라 이 레코드의 배열이다.
 * 순서를 바꾸거나 한 장을 갈아 끼우는 것이 랜딩을 고치는 유일한 방법이 되게 만드는 것이 목적이다.
 *
 * ## `media_id` 가 NOT NULL 이다 — 이 한 줄이 이 설계의 전부
 *
 * 사진 없는 패널을 만들 수 없으면 운영자가 랜딩에 문단을 더할 방법이 없다.
 * 텍스트만 있는 패널을 허용하는 순간 문단이 하나씩 붙고, 반년이면 랜딩이 다시 문서가 된다.
 * **"정보를 더 넣고 싶으면 하위 페이지로 간다"를 문서가 아니라 스키마가 강제한다.**
 * `headline` 도 NOT NULL 이다 — 사진만 있고 글이 없으면 그게 무슨 사진인지 알 수 없고,
 * 접근성 트리에서도 이 값이 제목 역할을 한다.
 *
 * ## 열거값만 저장한다
 *
 * `scrim`·`anchor`·`height` 는 CHECK 로 좁힌 문자열이다. 임의 CSS 를 저장하지 않는다 —
 * `scene_settings` 에서 이미 정한 원칙과 같다. CMS 가 임의 코드를 받으면 곧 실행 경로가 된다.
 * 조판 자유도는 열거값 몇 개로 충분하다는 것은 프로토타입(S6)에서 다섯 패널로 확인했다.
 *
 * ## 초점을 사람이 정한다
 *
 * 같은 사진이 데스크톱 16:9, 모바일 9:16 으로 잘린다. 가운데 크롭을 기본으로 두면
 * 세로에서 인물 머리가 잘리는 일이 반드시 생기고, 어디가 주인공인지는 자동으로 알 수 없다.
 * `focal_x/y` 가 그대로 `object-position` 으로 나간다.
 *
 * ## `cta_href` 는 자유 입력이 아니다
 *
 * `lib/content.ts` 의 내비 원칙과 같다 — 잘못된 href 는 운영자가 고칠 수 없는 종류의 사고다.
 * 라우트 없는 링크를 CMS 에서 만들 수 있게 하면 언젠가 만들어진다.
 * 목록은 `PANEL_CTA_HREFS` 하나로 관리하고 CHECK 가 DB 에서 한 번 더 막는다.
 */

export const PANEL_SCRIMS = ['none', 'bottom', 'full', 'top'] as const
export const PANEL_ANCHORS = ['bottom-left', 'bottom-center', 'center', 'top-left'] as const
export const PANEL_HEIGHTS = ['full', 'tall', 'half'] as const

/**
 * CTA 가 갈 수 있는 곳. **코드가 정하고 CMS 는 고르기만 한다.**
 * 여기 없는 경로를 추가하려면 라우트를 먼저 만들어야 한다 — 그게 이 목록의 목적이다.
 *
 * ⚠️ **이 배열은 코드에서만 바꿀 수 없다.** 값이 `page_panels_cta_href_ck` CHECK 에 그대로
 * 박히므로, 항목을 **빼거나 이름을 바꿀 때는** 그 값을 쓰고 있는 행을 먼저 `UPDATE` 하는
 * 마이그레이션이 필요하다. 순서를 뒤집으면(CHECK 를 먼저 조이면) 남아 있는 행 때문에
 * 마이그레이션이 통째로 실패한다 — `/rocket` → `/vehicles` 전환(0007)이 그 경우였다.
 * 항목을 **더하기만** 할 때는 CHECK 가 느슨해지는 방향이라 데이터 이동이 필요 없다.
 */
export const PANEL_CTA_HREFS = ['/vehicles', '/member', '/posts', '#support', '#contact'] as const

export type PanelScrim = (typeof PANEL_SCRIMS)[number]
export type PanelAnchor = (typeof PANEL_ANCHORS)[number]
export type PanelHeight = (typeof PANEL_HEIGHTS)[number]
export type PanelCtaHref = (typeof PANEL_CTA_HREFS)[number]

/** CHECK 제약의 `in (...)` 목록을 상수 하나에서 만든다 — 두 곳에 적으면 언젠가 갈라진다. */
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '))

export const pagePanels = icaros.table(
  'page_panels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sortOrder: integer('sort_order').notNull().default(0),
    published: boolean('published').notNull().default(false),

    /**
     * 패널의 정체. `onDelete: 'restrict'` 다 — 화면에 걸린 사진이 조용히 사라지면
     * 랜딩에 검은 구멍이 생기고, 그 사실을 아무도 모른 채 배포된다.
     * 사진을 지우려면 패널에서 먼저 떼야 한다.
     */
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'restrict' }),

    focalX: smallint('focal_x').notNull().default(50),
    focalY: smallint('focal_y').notNull().default(50),

    scrim: text('scrim').notNull().default('bottom'),
    anchor: text('anchor').notNull().default('bottom-left'),
    height: text('height').notNull().default('full'),

    eyebrow: text('eyebrow'),
    headline: text('headline').notNull(),
    body: text('body'),
    ctaLabel: text('cta_label'),
    ctaHref: text('cta_href'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('page_panels_order_idx').on(t.sortOrder),
    // 공개된 것만 순서대로 읽는 것이 이 테이블의 유일한 읽기 경로다.
    index('page_panels_published_idx').on(t.published, t.sortOrder),

    check('page_panels_focal_x_ck', sql`${t.focalX} between 0 and 100`),
    check('page_panels_focal_y_ck', sql`${t.focalY} between 0 and 100`),
    check('page_panels_scrim_ck', sql`${t.scrim} in (${inList(PANEL_SCRIMS)})`),
    check('page_panels_anchor_ck', sql`${t.anchor} in (${inList(PANEL_ANCHORS)})`),
    check('page_panels_height_ck', sql`${t.height} in (${inList(PANEL_HEIGHTS)})`),
    check('page_panels_cta_href_ck', sql`${t.ctaHref} is null or ${t.ctaHref} in (${inList(PANEL_CTA_HREFS)})`),
    // 라벨과 링크는 함께 있거나 함께 없다. 한쪽만 있으면 화면에 죽은 버튼이 뜬다.
    check(
      'page_panels_cta_pair_ck',
      sql`(${t.ctaLabel} is null) = (${t.ctaHref} is null)`
    ),
    // 빈 문자열은 값이 아니다. NOT NULL 만으로는 `''` 이 통과한다.
    check('page_panels_headline_ck', sql`length(btrim(${t.headline})) > 0`),
  ]
)
