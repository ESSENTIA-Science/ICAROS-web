'use server'

/**
 * 3D Scene 설정 Server Actions (F9 / G1~G14).
 *
 * 런타임 지정 위치에 대한 설명은 `_actions/rockets.ts` 상단 주석 참조 —
 * `'use server'` 모듈은 async 함수 외의 export 를 허용하지 않으므로
 * Node 런타임은 이 액션을 호출하는 세그먼트(`app/admin/layout.tsx`·`page.tsx`)가 정한다.
 *
 * **여기에 임의 JavaScript 가 들어올 자리는 없다** (G13). 숫자·열거형은 전용 컬럼으로,
 * 확장은 `extras` 객체 한 겹으로만 받고, jsonb 두 칸은 `scene/validation.ts` 의
 * strict 스키마를 통과해야만 DB 에 닿는다.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/guard'
import { db, schema } from '@/lib/db'
import { UPLOAD_POLICIES } from '@/lib/image/policy'
import {
  ANIMATION_CLIP_MAX,
  EXTRA_KEY_SHAPE,
  EXTRA_VALUE_MAX,
  EXTRA_VALUE_TYPES,
  FOV_MAX_EXCLUSIVE,
  FOV_MIN_EXCLUSIVE,
  HIGHLIGHT_NODE_MAX,
  HOME_FEATURE_NEW_TOKEN,
  HOTSPOT_BODY_MAX,
  HOTSPOT_TITLE_MAX,
  LABEL_MAX,
  MAX_CAMERA_PRESETS,
  MAX_EXTRAS,
  MAX_HOTSPOTS,
  SCENE_ENVIRONMENTS,
} from '@/components/admin/scene/constants'
import { sceneHref } from '@/components/admin/scene/href'
import {
  cameraPresetsSchema,
  describeSceneIssue,
  extrasSchema,
  type CameraPreset,
  type SceneExtras,
} from '@/components/admin/scene/validation'
import {
  CONFLICT,
  DENIED,
  MALFORMED,
  fail,
  type ActionResult,
  type FormState,
} from './result'
import {
  PG_CHECK_VIOLATION,
  formToRecord,
  normalizeNewlines,
  pgError,
  readList,
  zodFieldErrors,
  zodSummary,
} from '../_lib/form'
import { isVersionToken, versionMatches } from '../_lib/version'

/** 낙관적 잠금 실패 (F12). 사용자 문구는 CONFLICT 가 갖는다. */
class VersionConflict extends Error {}
/** 대상 행이 사라진 경우. "새로고침 후 재시도" 안내는 여기에 맞지 않는다. */
class RowGone extends Error {}

// ── 형태 ────────────────────────────────────────────────────────────────────

/**
 * `z.uuid()` 는 RFC 버전 비트까지 본다. 우리 컬럼은 `gen_random_uuid()`(v4) 라 지금은 같지만,
 * 나중에 v7 로 바꾸거나 외부에서 이관된 id 가 섞이면 "DB 에는 있는데 폼이 거부"가 된다.
 * Postgres 의 `uuid` 가 받아들이는 범위와 같게 16진 형태만 본다.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROCKET_SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{1,47}$/

const UNSIGNED_SHAPE = /^\d+(\.\d+)?$/
const SIGNED_SHAPE = /^-?\d+(\.\d+)?$/

/** checkbox 는 꺼져 있으면 전송되지 않는다. 폼이 hidden `0` 을 함께 보내 값을 항상 명시한다. */
const flagSchema = z.enum(['0', '1'], '토글 값이 올바르지 않습니다.')

type NumericSpec = {
  precision: number
  scale: number
  /** 음수를 허용할지. 위치·회전·카메라는 허용, 크기·강도·화각은 불허. */
  signed?: boolean
  gt?: number
  gte?: number
  lt?: number
}

/** numeric(precision, scale) 에 실제로 들어가는지. 자릿수 초과는 DB 가 반올림하거나 거부한다. */
function fitsPrecision(value: string, precision: number, scale: number): boolean {
  const body = value.startsWith('-') ? value.slice(1) : value
  const [intRaw = '', frac = ''] = body.split('.')
  const int = intRaw.replace(/^0+(?=\d)/, '')
  return int.length <= precision - scale && frac.length <= scale
}

function rangeOk(value: number, spec: NumericSpec): boolean {
  if (spec.gt !== undefined && !(value > spec.gt)) return false
  if (spec.gte !== undefined && !(value >= spec.gte)) return false
  if (spec.lt !== undefined && !(value < spec.lt)) return false
  return true
}

function rangeMessage(spec: NumericSpec): string {
  const parts: string[] = []
  if (spec.gt !== undefined) parts.push(`${spec.gt}보다 커야`)
  if (spec.gte !== undefined) parts.push(`${spec.gte} 이상이어야`)
  if (spec.lt !== undefined) parts.push(`${spec.lt}보다 작아야`)
  return parts.length > 0 ? `${parts.join(', ')} 합니다.` : '값의 범위를 확인해 주세요.'
}

/**
 * numeric 컬럼 입력.
 *
 * **문자열을 그대로 통과시킨다.** 범위 판정에만 `Number()` 를 쓰고 저장값은 원문이다 —
 * 드라이버가 문자열로 주는 값을 float 로 왕복시키면 사용자가 건드리지도 않은 자리가 바뀐다.
 * 전부 NOT NULL + DEFAULT 인 컬럼이라 빈 값은 "지움"이 아니라 입력 누락이다.
 */
function numericField(spec: NumericSpec): z.ZodType<string, string> {
  const shape = spec.signed === true ? SIGNED_SHAPE : UNSIGNED_SHAPE
  const maxInt = spec.precision - spec.scale
  const shapeMessage =
    spec.signed === true
      ? '숫자만 입력할 수 있습니다. (예: -1.25)'
      : '0 이상의 숫자만 입력할 수 있습니다. (예: 1.25)'

  return z
    .string()
    .trim()
    .min(1, '값을 입력해 주세요.')
    .refine((v) => v === '' || shape.test(v), shapeMessage)
    .refine((v) => !shape.test(v) || fitsPrecision(v, spec.precision, spec.scale), {
      message: `정수부 ${maxInt}자리, 소수부 ${spec.scale}자리까지 입력할 수 있습니다.`,
    })
    .refine((v) => !shape.test(v) || rangeOk(Number(v), spec), { message: rangeMessage(spec) })
}

/** 위치·회전·카메라·타깃·핫스팟 좌표는 전부 numeric(10,4) 부호 허용. */
const coordField = () => numericField({ precision: 10, scale: 4, signed: true })
/** 노출·환경광·키라이트는 numeric(6,3) 0 이상. */
const intensityField = () => numericField({ precision: 6, scale: 3, gte: 0 })

const mediaIdField = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || UUID_SHAPE.test(v), `${label}는 UUID 형식이어야 합니다.`)

const modelSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, '모델 이름을 입력해 주세요.')
    .max(LABEL_MAX, `모델 이름은 ${LABEL_MAX}자 이내로 입력해 주세요.`),
  rocketId: z
    .string()
    .trim()
    .refine((v) => v === '' || ROCKET_SLUG_SHAPE.test(v), '연결할 로켓을 다시 선택해 주세요.'),
  glbMediaId: mediaIdField('GLB media id'),
  posterMediaId: mediaIdField('포스터 media id'),

  scale: numericField({ precision: 8, scale: 4, gt: 0 }),
  positionX: coordField(),
  positionY: coordField(),
  positionZ: coordField(),
  rotationX: coordField(),
  rotationY: coordField(),
  rotationZ: coordField(),

  cameraX: coordField(),
  cameraY: coordField(),
  cameraZ: coordField(),
  targetX: coordField(),
  targetY: coordField(),
  targetZ: coordField(),
  fov: numericField({ precision: 6, scale: 2, gt: FOV_MIN_EXCLUSIVE, lt: FOV_MAX_EXCLUSIVE }),

  environment: z.enum(SCENE_ENVIRONMENTS, '환경 프리셋을 선택해 주세요.'),
  exposure: intensityField(),
  ambientIntensity: intensityField(),
  keyIntensity: intensityField(),

  autoRotate: flagSchema,
  animationClip: z
    .string()
    .trim()
    .max(ANIMATION_CLIP_MAX, `애니메이션 클립 이름은 ${ANIMATION_CLIP_MAX}자 이내입니다.`),
  enabledDesktop: flagSchema,
  enabledMobile: flagSchema,
})

const hotspotSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, '핫스팟 제목을 입력해 주세요.')
    .max(HOTSPOT_TITLE_MAX, `제목은 ${HOTSPOT_TITLE_MAX}자 이내입니다.`),
  bodyMd: z.string().max(HOTSPOT_BODY_MAX, `본문은 ${HOTSPOT_BODY_MAX}자 이내입니다.`),
  x: coordField(),
  y: coordField(),
  z: coordField(),
  highlightNode: z
    .string()
    .trim()
    .max(HIGHLIGHT_NODE_MAX, `강조 노드 이름은 ${HIGHLIGHT_NODE_MAX}자 이내입니다.`),
})

type ParsedModel = z.infer<typeof modelSchema>
type ParsedHotspot = z.infer<typeof hotspotSchema>

type ParsedForm = {
  model: ParsedModel
  presets: CameraPreset[]
  extras: SceneExtras
  hotspots: ParsedHotspot[]
}

type ParseOutcome = { ok: true; value: ParsedForm } | { ok: false; result: ActionResult }

// ── 프리셋 ──────────────────────────────────────────────────────────────────

/** 셀 하나. 여기서 잡은 오류는 입력 옆에 붙는다 — 배열 전체 스키마는 그 다음 관문이다. */
function presetCell(raw: string | undefined, field: string, index: number, errors: Record<string, string>): number | null {
  const v = (raw ?? '').trim()
  if (v === '') {
    errors[`preset.${index}.${field}`] = '값을 입력해 주세요.'
    return null
  }
  if (!SIGNED_SHAPE.test(v)) {
    errors[`preset.${index}.${field}`] = '숫자만 입력할 수 있습니다.'
    return null
  }
  return Number(v)
}

type PresetParse =
  | { ok: true; presets: CameraPreset[] }
  | { ok: false; result: ActionResult }

/**
 * 프리셋 행 → 검증된 배열 (G6).
 *
 * 두 단계인 이유: 셀 단위 검사는 **어느 칸이 틀렸는지** 말해 주고,
 * `cameraPresetsSchema` 는 **형태 자체**(0~1 범위·개수 상한·중복·알 수 없는 키)를 못 박는다.
 * 후자는 읽기 경로와 공유하는 단 하나의 진실이라, 여기서도 반드시 통과시킨다.
 */
function parsePresets(form: FormData): PresetParse {
  const at = readList(form, 'preset.at')
  const cx = readList(form, 'preset.cx')
  const cy = readList(form, 'preset.cy')
  const cz = readList(form, 'preset.cz')
  const tx = readList(form, 'preset.tx')
  const ty = readList(form, 'preset.ty')
  const tz = readList(form, 'preset.tz')
  const fov = readList(form, 'preset.fov')

  const lengths = new Set([at, cx, cy, cz, tx, ty, tz, fov].map((l) => l.length))
  if (lengths.size > 1) return { ok: false, result: MALFORMED }
  if (at.length > MAX_CAMERA_PRESETS) {
    return {
      ok: false,
      result: fail(`카메라 프리셋은 최대 ${MAX_CAMERA_PRESETS}개까지 등록할 수 있습니다.`),
    }
  }

  const errors: Record<string, string> = {}
  const rows: CameraPreset[] = []

  for (let i = 0; i < at.length; i += 1) {
    const atValue = presetCell(at[i], 'at', i, errors)
    const camera = {
      x: presetCell(cx[i], 'cx', i, errors),
      y: presetCell(cy[i], 'cy', i, errors),
      z: presetCell(cz[i], 'cz', i, errors),
    }
    const target = {
      x: presetCell(tx[i], 'tx', i, errors),
      y: presetCell(ty[i], 'ty', i, errors),
      z: presetCell(tz[i], 'tz', i, errors),
    }

    // fov 는 비워 두면 모델 기본 화각을 그대로 쓴다 — 구간마다 화각을 바꿀 이유는 흔치 않다.
    const rawFov = (fov[i] ?? '').trim()
    let fovValue: number | undefined
    if (rawFov !== '') {
      if (!SIGNED_SHAPE.test(rawFov)) errors[`preset.${i}.fov`] = '숫자만 입력할 수 있습니다.'
      else fovValue = Number(rawFov)
    }

    if (
      atValue === null ||
      camera.x === null ||
      camera.y === null ||
      camera.z === null ||
      target.x === null ||
      target.y === null ||
      target.z === null
    ) {
      continue
    }

    rows.push({
      at: atValue,
      camera: { x: camera.x, y: camera.y, z: camera.z },
      target: { x: target.x, y: target.y, z: target.z },
      ...(fovValue === undefined ? {} : { fov: fovValue }),
    })
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, result: fail('카메라 프리셋 값을 확인해 주세요.', errors) }
  }

  const parsed = cameraPresetsSchema.safeParse(rows)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = presetFieldKey(issue.path)
      if (key !== null) fieldErrors[key] ??= issue.message
    }
    return { ok: false, result: fail(describeSceneIssue(parsed.error), fieldErrors) }
  }

  return { ok: true, presets: parsed.data }
}

/**
 * zod 이슈 경로 → 폼 필드 이름.
 *
 * 스키마는 중첩 객체(`camera.x`)로 보는데 폼은 납작한 이름(`preset.0.cx`)으로 보낸다.
 * 이 변환이 없으면 범위 위반이 입력 옆이 아니라 상단 배너에만 뜬다.
 * 배열 전체에 걸린 이슈(개수 상한·배열 아님)는 붙일 입력이 없으므로 null 이다.
 */
function presetFieldKey(path: readonly PropertyKey[]): string | null {
  const index = path[0]
  if (typeof index !== 'number') return null

  const field = path[1]
  if (field === 'at' || field === 'fov') return `preset.${index}.${field}`
  if (field === 'camera' || field === 'target') {
    const axis = path[2]
    if (axis !== 'x' && axis !== 'y' && axis !== 'z') return null
    return `preset.${index}.${field === 'camera' ? 'c' : 't'}${axis}`
  }
  // 알 수 없는 키처럼 행 전체에 걸린 이슈는 `at` 옆에 붙인다 — 그 행에서 가장 먼저 보이는 칸이다.
  return `preset.${index}.at`
}

// ── extras ──────────────────────────────────────────────────────────────────

type ExtrasParse = { ok: true; extras: SceneExtras } | { ok: false; result: ActionResult }

function parseExtras(form: FormData): ExtrasParse {
  const keys = readList(form, 'extra.key')
  const types = readList(form, 'extra.type')
  const values = readList(form, 'extra.value')

  const lengths = new Set([keys.length, types.length, values.length])
  if (lengths.size > 1) return { ok: false, result: MALFORMED }
  if (keys.length > MAX_EXTRAS) {
    return { ok: false, result: fail(`확장 값은 최대 ${MAX_EXTRAS}개까지 등록할 수 있습니다.`) }
  }

  const errors: Record<string, string> = {}
  const record: Record<string, string | number | boolean> = {}

  for (let i = 0; i < keys.length; i += 1) {
    const key = (keys[i] ?? '').trim()
    const type = (types[i] ?? '').trim()
    const raw = (values[i] ?? '').trim()

    if (key === '') {
      errors[`extra.${i}.key`] = '키를 입력해 주세요.'
      continue
    }
    /**
     * 키 모양은 `extrasSchema` 도 보지만, record 의 키 오류는 이슈 경로가 키 자체라
     * 몇 번째 행인지가 남지 않는다. 여기서 먼저 잡아야 입력 옆에 붙는다.
     */
    if (!EXTRA_KEY_SHAPE.test(key)) {
      errors[`extra.${i}.key`] =
        '키는 영문으로 시작하고 영숫자·`_`·`.`·`-` 만 쓸 수 있습니다. (40자 이내)'
      continue
    }
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      errors[`extra.${i}.key`] = '같은 키가 이미 있습니다.'
      continue
    }
    // 열거형 밖의 타입은 폼이 만들 수 없다 — 오면 조립된 요청이다.
    if (!EXTRA_VALUE_TYPES.some((t) => t === type)) return { ok: false, result: MALFORMED }

    if (type === 'number') {
      if (!SIGNED_SHAPE.test(raw)) {
        errors[`extra.${i}.value`] = '숫자만 입력할 수 있습니다.'
        continue
      }
      record[key] = Number(raw)
    } else if (type === 'boolean') {
      const lowered = raw.toLowerCase()
      if (lowered !== 'true' && lowered !== 'false') {
        errors[`extra.${i}.value`] = 'true 또는 false 만 입력할 수 있습니다.'
        continue
      }
      record[key] = lowered === 'true'
    } else {
      if (raw.length > EXTRA_VALUE_MAX) {
        errors[`extra.${i}.value`] = `값은 ${EXTRA_VALUE_MAX}자 이내로 입력해 주세요.`
        continue
      }
      record[key] = raw
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, result: fail('확장 값을 확인해 주세요.', errors) }
  }

  const parsed = extrasSchema.safeParse(record)
  if (!parsed.success) {
    return { ok: false, result: fail(describeSceneIssue(parsed.error)) }
  }
  return { ok: true, extras: parsed.data }
}

// ── 핫스팟 ──────────────────────────────────────────────────────────────────

type HotspotParse = { ok: true; hotspots: ParsedHotspot[] } | { ok: false; result: ActionResult }

function parseHotspots(form: FormData): HotspotParse {
  const titles = readList(form, 'hotspot.title')
  const bodies = readList(form, 'hotspot.bodyMd')
  const xs = readList(form, 'hotspot.x')
  const ys = readList(form, 'hotspot.y')
  const zs = readList(form, 'hotspot.z')
  const nodes = readList(form, 'hotspot.highlightNode')

  const lengths = new Set([titles, bodies, xs, ys, zs, nodes].map((l) => l.length))
  if (lengths.size > 1) return { ok: false, result: MALFORMED }
  if (titles.length > MAX_HOTSPOTS) {
    return { ok: false, result: fail(`핫스팟은 최대 ${MAX_HOTSPOTS}개까지 등록할 수 있습니다.`) }
  }

  const errors: Record<string, string> = {}
  const hotspots: ParsedHotspot[] = []

  for (let i = 0; i < titles.length; i += 1) {
    const row = hotspotSchema.safeParse({
      title: titles[i] ?? '',
      bodyMd: bodies[i] ?? '',
      x: xs[i] ?? '',
      y: ys[i] ?? '',
      z: zs[i] ?? '',
      highlightNode: nodes[i] ?? '',
    })
    if (row.success) {
      hotspots.push(row.data)
      continue
    }
    for (const [key, message] of Object.entries(zodFieldErrors(row.error))) {
      errors[`hotspot.${i}.${key}`] = message
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, result: fail('핫스팟 정보를 확인해 주세요.', errors) }
  }
  return { ok: true, hotspots }
}

// ── 폼 전체 ─────────────────────────────────────────────────────────────────

function parseModelForm(form: FormData): ParseOutcome {
  const model = modelSchema.safeParse(formToRecord(form))
  if (!model.success) {
    return { ok: false, result: fail(zodSummary(model.error), zodFieldErrors(model.error)) }
  }

  const presets = parsePresets(form)
  if (!presets.ok) return { ok: false, result: presets.result }

  const extras = parseExtras(form)
  if (!extras.ok) return { ok: false, result: extras.result }

  const hotspots = parseHotspots(form)
  if (!hotspots.ok) return { ok: false, result: hotspots.result }

  return {
    ok: true,
    value: {
      model: model.data,
      presets: presets.presets,
      extras: extras.extras,
      hotspots: hotspots.hotspots,
    },
  }
}

/**
 * media id 실재 확인 (G1·G2).
 *
 * 업로드 위젯은 다른 트랙이 만든다. 그때까지 이 필드는 사람이 id 를 붙여 넣는 칸이라
 * **오타가 기본값**이다. FK 가 없는 컬럼이라 DB 는 아무것도 막아 주지 않는다 —
 * 확인은 여기서만 일어난다.
 */
async function verifyMediaRefs(glbMediaId: string, posterMediaId: string): Promise<ActionResult | null> {
  const wanted: { id: string; field: string; label: string; mime: string }[] = []
  if (glbMediaId !== '') {
    wanted.push({ id: glbMediaId, field: 'glbMediaId', label: 'GLB', mime: UPLOAD_POLICIES.glb.mime })
  }
  if (posterMediaId !== '') {
    wanted.push({
      id: posterMediaId,
      field: 'posterMediaId',
      label: '포스터',
      mime: UPLOAD_POLICIES.poster.mime,
    })
  }
  if (wanted.length === 0) return null

  const rows = await db
    .select({
      id: schema.media.id,
      mime: schema.media.mime,
      status: schema.media.status,
      deletedAt: schema.media.deletedAt,
    })
    .from(schema.media)
    .where(inArray(schema.media.id, wanted.map((w) => w.id)))

  const byId = new Map(rows.map((r) => [r.id, r]))
  const errors: Record<string, string> = {}

  for (const want of wanted) {
    const row = byId.get(want.id)
    if (!row) {
      errors[want.field] = '이 id 의 파일이 없습니다. 업로드 후 발급된 media id 를 입력해 주세요.'
      continue
    }
    if (row.deletedAt !== null) {
      errors[want.field] = '삭제된 파일입니다. 다른 파일을 지정해 주세요.'
      continue
    }
    if (row.status !== 'ready') {
      errors[want.field] = `업로드가 확정되지 않은 파일입니다. (상태: ${row.status})`
      continue
    }
    if (row.mime !== want.mime) {
      errors[want.field] = `${want.label} 파일이 아닙니다. ${want.mime} 가 필요한데 ${row.mime} 입니다.`
    }
  }

  return Object.keys(errors).length > 0 ? fail('지정한 파일을 확인해 주세요.', errors) : null
}

async function rocketExists(rocketId: string): Promise<boolean> {
  if (rocketId === '') return true
  const rows = await db
    .select({ id: schema.rockets.id })
    .from(schema.rockets)
    .where(eq(schema.rockets.id, rocketId))
    .limit(1)
  return rows[0] !== undefined
}

function toModelValues(v: ParsedForm) {
  const m = v.model
  return {
    label: m.label,
    rocketId: m.rocketId === '' ? null : m.rocketId,
    glbMediaId: m.glbMediaId === '' ? null : m.glbMediaId,
    posterMediaId: m.posterMediaId === '' ? null : m.posterMediaId,
    scale: m.scale,
    positionX: m.positionX,
    positionY: m.positionY,
    positionZ: m.positionZ,
    rotationX: m.rotationX,
    rotationY: m.rotationY,
    rotationZ: m.rotationZ,
    cameraX: m.cameraX,
    cameraY: m.cameraY,
    cameraZ: m.cameraZ,
    targetX: m.targetX,
    targetY: m.targetY,
    targetZ: m.targetZ,
    fov: m.fov,
    cameraPresets: v.presets,
    environment: m.environment,
    exposure: m.exposure,
    ambientIntensity: m.ambientIntensity,
    keyIntensity: m.keyIntensity,
    autoRotate: m.autoRotate === '1',
    animationClip: m.animationClip === '' ? null : m.animationClip,
    enabledDesktop: m.enabledDesktop === '1',
    enabledMobile: m.enabledMobile === '1',
    extras: v.extras,
  }
}

function toHotspotValues(modelId: string, hotspots: readonly ParsedHotspot[]) {
  return hotspots.map((h, index) => ({
    modelId,
    title: h.title,
    bodyMd: h.bodyMd.trim() === '' ? null : normalizeNewlines(h.bodyMd).trim(),
    x: h.x,
    y: h.y,
    z: h.z,
    highlightNode: h.highlightNode === '' ? null : h.highlightNode,
    // numeric(6,0) 컬럼이라 문자열로 넣는다. 순서는 화면의 행 순서 그대로다.
    sortOrder: String(index),
  }))
}

/**
 * 3D 는 홈 히어로(B12)와 로켓 상세 양쪽에 걸린다.
 * 지금은 force-dynamic 이라 즉시 반영되지만, ISR 로 바꿀 때를 대비해 배선해 둔다.
 */
function revalidateScene(): void {
  revalidatePath('/')
  revalidatePath('/rocket')
  revalidatePath('/rocket/[slug]', 'page')
}

function describeWriteError(err: unknown): ActionResult {
  if (err instanceof VersionConflict) return CONFLICT
  if (err instanceof RowGone) {
    return fail('이 모델은 다른 곳에서 이미 삭제되었습니다. 목록으로 돌아간 뒤 다시 등록해 주세요.')
  }

  const { code, constraint } = pgError(err)
  if (code === PG_CHECK_VIOLATION) {
    // 앱 검증을 통과했는데 CHECK 에 걸렸다면 둘이 어긋난 것이다. 사용자에게는 조용히, 로그에는 제약명만.
    console.error(`[admin] scene CHECK 위반: ${constraint ?? 'unknown'}`)
    return fail('저장할 수 없는 값이 있습니다. 입력값을 다시 확인해 주세요.')
  }

  console.error('[admin] 3D 모델 저장 실패')
  return fail('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
}

// ── 액션 ────────────────────────────────────────────────────────────────────

export async function createSceneModelAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const parsed = parseModelForm(form)
  if (!parsed.ok) return parsed.result

  const mediaError = await verifyMediaRefs(parsed.value.model.glbMediaId, parsed.value.model.posterMediaId)
  if (mediaError) return mediaError

  if (!(await rocketExists(parsed.value.model.rocketId))) {
    return fail('연결하려는 로켓을 찾을 수 없습니다.', { rocketId: '이미 삭제된 로켓입니다.' })
  }

  let newId: string
  try {
    newId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.rocketModels)
        .values(toModelValues(parsed.value))
        .returning({ id: schema.rocketModels.id })

      const row = inserted[0]
      if (!row) throw new Error('insert returned no row')

      const hotspots = toHotspotValues(row.id, parsed.value.hotspots)
      if (hotspots.length > 0) await tx.insert(schema.rocketHotspots).values(hotspots)
      return row.id
    })
  } catch (err) {
    return describeWriteError(err)
  }

  revalidateScene()
  redirect(sceneHref({ saved: newId }))
}

export async function updateSceneModelAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const id = form.get('id')
  if (typeof id !== 'string' || !UUID_SHAPE.test(id)) return MALFORMED

  const version = form.get('version')
  if (!isVersionToken(version)) return MALFORMED

  const parsed = parseModelForm(form)
  if (!parsed.ok) return parsed.result

  const mediaError = await verifyMediaRefs(parsed.value.model.glbMediaId, parsed.value.model.posterMediaId)
  if (mediaError) return mediaError

  if (!(await rocketExists(parsed.value.model.rocketId))) {
    return fail('연결하려는 로켓을 찾을 수 없습니다.', { rocketId: '이미 삭제된 로켓입니다.' })
  }

  const nextGlb = parsed.value.model.glbMediaId === '' ? null : parsed.value.model.glbMediaId
  let glbChanged = false

  try {
    await db.transaction(async (tx) => {
      /**
       * 행을 **잠근 채로** 존재를 확인한다. `.limit(1)` 만 걸어 두면 이 SELECT 와 아래 UPDATE 사이에
       * 남이 모델을 지울 수 있고, 그러면 0행이 돌아와 `VersionConflict` 로 보고된다 —
       * "새로고침해 최신 값을 확인"하라고 해 놓고 새로고침하면 모델 자체가 없는 그 상황이다.
       * 잠금을 걸면 0행의 원인이 버전 불일치 하나로 좁혀진다 (rockets·members 와 같은 규약).
       */
      const before = await tx
        .select({ glbMediaId: schema.rocketModels.glbMediaId })
        .from(schema.rocketModels)
        .where(eq(schema.rocketModels.id, id))
        .for('update')

      const previous = before[0]
      // 행이 아예 없는 것과 남이 먼저 고친 것은 다른 사건이고, 사용자가 할 일도 다르다.
      if (!previous) throw new RowGone()
      glbChanged = previous.glbMediaId !== nextGlb

      // 버전 대조를 UPDATE 안에서 한다 — 읽고 나서 쓰는 두 단계로 나누면 그 사이가 경합 구간이 된다 (F12).
      const updated = await tx
        .update(schema.rocketModels)
        .set({ ...toModelValues(parsed.value), updatedAt: sql`now()` })
        .where(and(eq(schema.rocketModels.id, id), versionMatches(schema.rocketModels.updatedAt, version)))
        .returning({ id: schema.rocketModels.id })

      // 행은 잠근 채로 확인했으므로 0행은 버전 불일치 하나뿐이다.
      if (!updated[0]) throw new VersionConflict()

      // 핫스팟은 통째로 갈아 끼운다. id 를 참조하는 곳이 없고, 부분 갱신은 순서 재배치에서 어긋난다.
      await tx.delete(schema.rocketHotspots).where(eq(schema.rocketHotspots.modelId, id))
      const hotspots = toHotspotValues(id, parsed.value.hotspots)
      if (hotspots.length > 0) await tx.insert(schema.rocketHotspots).values(hotspots)
    })
  } catch (err) {
    return describeWriteError(err)
  }

  revalidateScene()
  // GLB 를 바꾸면 예전 모델에 맞춰 둔 카메라·스케일이 프레이밍을 깨뜨린다 (G14). 저장 직후에 짚어 준다.
  redirect(sceneHref({ saved: glbChanged ? 'glb' : id }))
}

export async function deleteSceneModelAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const id = form.get('id')
  if (typeof id !== 'string' || !UUID_SHAPE.test(id)) return MALFORMED

  try {
    // 핫스팟은 FK cascade 가, 홈 대표 지정은 on delete set null 이 함께 처리한다.
    const deleted = await db
      .delete(schema.rocketModels)
      .where(eq(schema.rocketModels.id, id))
      .returning({ id: schema.rocketModels.id })

    if (!deleted[0]) return fail('이미 삭제된 모델입니다.')
  } catch {
    console.error('[admin] 3D 모델 삭제 실패')
    return fail('삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  }

  revalidateScene()
  redirect(sceneHref({ saved: 'deleted' }))
}

const homeFeatureSchema = z.object({
  rocketId: z
    .string()
    .trim()
    .refine((v) => v === '' || ROCKET_SLUG_SHAPE.test(v), '대표 로켓을 다시 선택해 주세요.'),
  modelId: z
    .string()
    .trim()
    .refine((v) => v === '' || UUID_SHAPE.test(v), '대표 모델을 다시 선택해 주세요.'),
})

/** 홈 대표 기체·모델 지정 (B12). `site_settings` 자유 문자열이 아니라 제약 있는 단일 행이다. */
export async function saveHomeFeatureAction(
  _prev: FormState,
  form: FormData
): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch {
    return DENIED
  }

  const rawVersion = form.get('version')
  if (typeof rawVersion !== 'string') return MALFORMED
  const creating = rawVersion === HOME_FEATURE_NEW_TOKEN
  if (!creating && !isVersionToken(rawVersion)) return MALFORMED

  const parsed = homeFeatureSchema.safeParse(formToRecord(form))
  if (!parsed.success) {
    return fail(zodSummary(parsed.error), zodFieldErrors(parsed.error))
  }

  const rocketId = parsed.data.rocketId === '' ? null : parsed.data.rocketId
  const modelId = parsed.data.modelId === '' ? null : parsed.data.modelId

  if (rocketId !== null && !(await rocketExists(rocketId))) {
    return fail('대표 로켓을 찾을 수 없습니다.', { rocketId: '이미 삭제된 로켓입니다.' })
  }

  if (modelId !== null) {
    const rows = await db
      .select({ id: schema.rocketModels.id, rocketId: schema.rocketModels.rocketId })
      .from(schema.rocketModels)
      .where(eq(schema.rocketModels.id, modelId))
      .limit(1)

    const model = rows[0]
    if (!model) return fail('대표 모델을 찾을 수 없습니다.', { modelId: '이미 삭제된 모델입니다.' })

    /**
     * 모델이 어떤 로켓에 매여 있는데 대표 로켓이 다르면, 홈에서 A 를 소개하며 B 를 돌리게 된다.
     * 모델 쪽 연결이 비어 있으면(범용 모델) 아무 로켓과도 함께 쓸 수 있으므로 통과시킨다.
     */
    if (model.rocketId !== null && rocketId !== null && model.rocketId !== rocketId) {
      return fail('선택한 모델은 다른 로켓에 연결되어 있습니다.', {
        modelId: `이 모델은 ${model.rocketId} 에 연결되어 있습니다.`,
      })
    }
  }

  try {
    if (creating) {
      // 다른 곳에서 먼저 만들었으면 덮지 않는다 — 그건 우리가 못 본 값이다.
      const inserted = await db
        .insert(schema.homeFeature)
        .values({ id: 'singleton', rocketId, modelId })
        .onConflictDoNothing({ target: schema.homeFeature.id })
        .returning({ id: schema.homeFeature.id })

      if (!inserted[0]) return CONFLICT
    } else {
      const updated = await db
        .update(schema.homeFeature)
        .set({ rocketId, modelId, updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.homeFeature.id, 'singleton'),
            versionMatches(schema.homeFeature.updatedAt, rawVersion)
          )
        )
        .returning({ id: schema.homeFeature.id })

      if (!updated[0]) return CONFLICT
    }
  } catch (err) {
    return describeWriteError(err)
  }

  revalidateScene()
  redirect(sceneHref({ saved: 'home' }))
}
