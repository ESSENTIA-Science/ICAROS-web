import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { icaros } from './_schema'

/** 랜딩 카피 + 후원 현황. 레거시 site_content(18 keys) 를 그대로 이어받는다. */
export const siteSettings = icaros.table('site_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** 섹션 활성화·순서. 신규 — 레거시에는 없던 기능. */
export const pageSections = icaros.table(
  'page_sections',
  {
    id: text('id').primaryKey(),           // 'hero' | 'about' | 'vision' | ...
    label: text('label').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('page_sections_order_idx').on(t.sortOrder)]
)

/**
 * 로켓 카테고리(시리즈).
 *
 * 원래는 `rockets.series` 의 CHECK `in ('A','B')` 와 `components/rocket/series.ts` 의 배열,
 * 두 벌이 코드에 하드코딩돼 있었다. 카테고리를 하나 늘리려면 **마이그레이션과 배포**가
 * 필요했다는 뜻이다 — 로켓·멤버·랜딩 카피는 전부 `/admin` 에서 고치는데 여기만 그랬다.
 * 그래서 행으로 내린다. `id` 는 여전히 공개 URL(`/rocket?series=…`)에 그대로 나간다.
 *
 * **`id` 는 만든 뒤 바꿀 수 없다** — 바꾸면 그 카테고리를 가리키던 링크·북마크가 전부 죽는다.
 * 라벨만 고친다. 표시에 쓰이는 것은 `label` 이지 `id` 가 아니라서 실무상 아쉬울 일이 없다.
 */
export const rocketSeries = icaros.table(
  'rocket_series',
  {
    /** URL 에 나가는 값. 기존 데이터가 'A'·'B' 라 대문자를 허용한다. */
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('rocket_series_id_ck', sql`${t.id} ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,31}$'`),
    check('rocket_series_label_ck', sql`length(btrim(${t.label})) > 0`),
    index('rocket_series_order_idx').on(t.sortOrder),
  ]
)

export const rockets = icaros.table(
  'rockets',
  {
    id: text('id').primaryKey(),           // slug. 예: 'icx1'
    name: text('name').notNull(),
    /**
     * 카테고리. 예전에는 CHECK `in ('A','B')` 였다 — 이제 FK 다.
     * `restrict` 라 로켓이 붙어 있는 카테고리는 지워지지 않는다. 그게 유일한 안전장치다:
     * cascade 였다면 카테고리 하나를 지우는 순간 그 안의 로켓이 전부 사라진다.
     */
    series: text('series')
      .notNull()
      .default('A')
      .references(() => rocketSeries.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    descriptionMd: text('description_md'),
    coverMediaId: uuid('cover_media_id'),
    // 전환용. 레거시는 이미지를 레포의 public/ 경로로 DB 에 넣어 뒀다.
    // P9 에서 S3 로 옮기고 coverMediaId 로 대체한 뒤 이 컬럼을 제거한다.
    legacyImagePath: text('legacy_image_path'),
    maxAltitudeM: numeric('max_altitude_m', { precision: 10, scale: 2 }),
    sizeM: numeric('size_m', { precision: 10, scale: 3 }),
    payloadKg: numeric('payload_kg', { precision: 10, scale: 3 }),
    published: boolean('published').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 레거시에는 CHECK 제약이 하나도 없어 PostgREST 로 직접 쏘면 뚫렸다 (01 §8 결함 #6).
    // `series` 의 CHECK 는 FK 로 대체됐다 — 값 집합이 코드가 아니라 행이 되었으므로,
    // 목록을 상수로 적어 두면 카테고리를 추가한 순간 그 상수가 거짓말이 된다.
    check('rockets_altitude_ck', sql`${t.maxAltitudeM} is null or ${t.maxAltitudeM} >= 0`),
    check('rockets_size_ck', sql`${t.sizeM} is null or ${t.sizeM} > 0`),
    check('rockets_payload_ck', sql`${t.payloadKg} is null or ${t.payloadKg} >= 0`),
    // 시리즈 안에서만 순서가 의미를 가진다
    uniqueIndex('rockets_series_order_uq').on(t.series, t.sortOrder),
  ]
)

/** 레거시 rockets.engines jsonb 배열을 정규화. */
export const rocketEngines = icaros.table(
  'rocket_engines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rocketId: text('rocket_id').notNull().references(() => rockets.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    thrustN: numeric('thrust_n', { precision: 10, scale: 2 }),
    burnTimeS: numeric('burn_time_s', { precision: 10, scale: 3 }),
    count: integer('count').notNull().default(1),
    mode: text('mode'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('rocket_engines_rocket_idx').on(t.rocketId, t.sortOrder),
    check('rocket_engines_count_ck', sql`${t.count} >= 1`),
    check('rocket_engines_thrust_ck', sql`${t.thrustN} is null or ${t.thrustN} > 0`),
    check('rocket_engines_burn_ck', sql`${t.burnTimeS} is null or ${t.burnTimeS} > 0`),
  ]
)

export const members = icaros.table(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    role: text('role'),
    squad: text('squad'),                  // 추진공학부 / 전자부 / 비행제어부 / ...
    school: text('school'),
    imageMediaId: uuid('image_media_id'),
    legacyImagePath: text('legacy_image_path'),  // 전환용 — rockets 와 동일
    published: boolean('published').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 레거시는 sort_order 5 가 3행에 중복이라 정렬이 비결정적이었다 (01 §8 결함 #4).
    // unique 를 걸면 CMS 재정렬이 까다로워지므로, 대신 조회를 항상 (sort_order, created_at) 로 한다.
    index('members_order_idx').on(t.sortOrder, t.createdAt),
    check('members_name_ck', sql`length(btrim(${t.name})) > 0`),
  ]
)
