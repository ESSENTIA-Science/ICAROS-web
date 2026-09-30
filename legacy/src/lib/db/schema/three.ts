import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { icaros } from './_schema'
import { rockets } from './content'

/**
 * 3D 모델 + Scene 설정. 요구사항 G1~G14.
 *
 * Scene 설정은 **검증된 JSON schema 로만** 저장한다 (G13) — 임의 JavaScript 를 넣을 수 있게 하면
 * CMS 가 곧 원격 코드 실행 경로가 된다. transform/camera/lighting 은 숫자 필드로 못 박고,
 * 확장 여지는 `extras` jsonb 하나로 제한한다.
 */
export const rocketModels = icaros.table(
  'rocket_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rocketId: text('rocket_id').references(() => rockets.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    glbMediaId: uuid('glb_media_id'),
    posterMediaId: uuid('poster_media_id'),

    // transform
    scale: numeric('scale', { precision: 8, scale: 4 }).notNull().default('1'),
    positionX: numeric('position_x', { precision: 10, scale: 4 }).notNull().default('0'),
    positionY: numeric('position_y', { precision: 10, scale: 4 }).notNull().default('0'),
    positionZ: numeric('position_z', { precision: 10, scale: 4 }).notNull().default('0'),
    rotationX: numeric('rotation_x', { precision: 10, scale: 4 }).notNull().default('0'),
    rotationY: numeric('rotation_y', { precision: 10, scale: 4 }).notNull().default('0'),
    rotationZ: numeric('rotation_z', { precision: 10, scale: 4 }).notNull().default('0'),

    // camera
    cameraX: numeric('camera_x', { precision: 10, scale: 4 }).notNull().default('0'),
    cameraY: numeric('camera_y', { precision: 10, scale: 4 }).notNull().default('0'),
    cameraZ: numeric('camera_z', { precision: 10, scale: 4 }).notNull().default('5'),
    targetX: numeric('target_x', { precision: 10, scale: 4 }).notNull().default('0'),
    targetY: numeric('target_y', { precision: 10, scale: 4 }).notNull().default('0'),
    targetZ: numeric('target_z', { precision: 10, scale: 4 }).notNull().default('0'),
    fov: numeric('fov', { precision: 6, scale: 2 }).notNull().default('45'),

    // 스크롤 구간별 카메라 프리셋 (G6). [{at: 0..1, camera:{x,y,z}, target:{x,y,z}, fov}]
    cameraPresets: jsonb('camera_presets').notNull().default(sql`'[]'::jsonb`),

    // lighting / environment (G7)
    environment: text('environment').notNull().default('studio'),
    exposure: numeric('exposure', { precision: 6, scale: 3 }).notNull().default('1'),
    ambientIntensity: numeric('ambient_intensity', { precision: 6, scale: 3 }).notNull().default('1'),
    keyIntensity: numeric('key_intensity', { precision: 6, scale: 3 }).notNull().default('1'),

    autoRotate: boolean('auto_rotate').notNull().default(false),
    animationClip: text('animation_clip'),

    enabledDesktop: boolean('enabled_desktop').notNull().default(true),
    enabledMobile: boolean('enabled_mobile').notNull().default(false),  // 모바일에 WebGL 강제 금지

    extras: jsonb('extras').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('rocket_models_rocket_idx').on(t.rocketId),
    check('rocket_models_scale_ck', sql`${t.scale} > 0`),
    check('rocket_models_fov_ck', sql`${t.fov} > 0 and ${t.fov} < 180`),
    check('rocket_models_exposure_ck', sql`${t.exposure} >= 0`),
    check('rocket_models_env_ck', sql`${t.environment} in ('studio','city','sunset','dawn','night','warehouse','none')`),
    check('rocket_models_presets_ck', sql`jsonb_typeof(${t.cameraPresets}) = 'array'`),
    check('rocket_models_extras_ck', sql`jsonb_typeof(${t.extras}) = 'object'`),
  ]
)

export const rocketHotspots = icaros.table(
  'rocket_hotspots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id').notNull().references(() => rocketModels.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    bodyMd: text('body_md'),
    x: numeric('x', { precision: 10, scale: 4 }).notNull().default('0'),
    y: numeric('y', { precision: 10, scale: 4 }).notNull().default('0'),
    z: numeric('z', { precision: 10, scale: 4 }).notNull().default('0'),
    // 부품 강조 (G11) — GLB 안의 노드 이름. 없으면 강조 없이 라벨만.
    highlightNode: text('highlight_node'),
    sortOrder: numeric('sort_order', { precision: 6, scale: 0 }).notNull().default('0'),
  },
  (t) => [
    index('rocket_hotspots_model_idx').on(t.modelId, t.sortOrder),
    check('rocket_hotspots_title_ck', sql`length(btrim(${t.title})) > 0`),
  ]
)

/** 홈 대표 기체·모델 지정 (B12). site_settings 자유 문자열 대신 제약 있는 단일 행. */
export const homeFeature = icaros.table(
  'home_feature',
  {
    id: text('id').primaryKey().default('singleton'),
    rocketId: text('rocket_id').references(() => rockets.id, { onDelete: 'set null' }),
    modelId: uuid('model_id').references(() => rocketModels.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('home_feature_singleton_uq').on(t.id),
    check('home_feature_singleton_ck', sql`${t.id} = 'singleton'`),
  ]
)
