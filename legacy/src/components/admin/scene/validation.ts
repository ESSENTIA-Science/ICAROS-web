import { z } from 'zod'
import { COORD_ABS_LIMIT, EXTRA_KEY_SHAPE, EXTRA_VALUE_MAX, FOV_MAX_EXCLUSIVE, FOV_MIN_EXCLUSIVE, MAX_CAMERA_PRESETS, MAX_EXTRAS } from './constants'

/**
 * jsonb 두 칸(`camera_presets`·`extras`)의 **유일한** 검증 지점 (G13).
 *
 * DB CHECK 는 `jsonb_typeof(...)` 밖에 보지 않는다 — 배열이기만 하면 무엇이든 통과한다.
 * 그래서 실제 형태 보증은 전부 여기 있고, CHECK 는 최후 방어선으로만 남는다.
 * 읽기(`_data/scene.ts`)와 쓰기(`_actions/scene.ts`)가 **같은 스키마**를 통과한다:
 * 손으로 넣은 행이나 예전 형식이 폼에 조용히 실려 들어와 그대로 되저장되는 경로를 막는다.
 *
 * `server-only` 를 붙이지 않은 것은 의도다 — 이 규칙은 서버 자원에 손대지 않고,
 * 스크립트에서 그대로 불러 검증할 수 있어야 한다.
 */

/**
 * zod 4 의 `z.number()` 는 NaN·Infinity 를 모두 거부한다(실측). 그래도 `.refine` 을 남긴 것은
 * 이 값이 jsonb 로 나갈 때 `JSON.stringify(Infinity) === 'null'` 이라 **조용히 사라지는** 종류의
 * 사고이기 때문이다 — zod 동작이 바뀌어도 이 성질은 여기서 다시 막힌다.
 */
const finiteNumber = z
  .number('숫자여야 합니다.')
  .refine((n) => Number.isFinite(n), '유한한 숫자여야 합니다.')

const coord = finiteNumber.refine(
  (n) => Math.abs(n) <= COORD_ABS_LIMIT,
  `좌표는 ±${COORD_ABS_LIMIT.toLocaleString('en-US')} 범위 안이어야 합니다.`
)

/** `strictObject` — 알 수 없는 키는 버리지 않고 **거부**한다. 조용히 버리면 오타를 발견할 길이 없다. */
const vec3Schema = z.strictObject(
  { x: coord, y: coord, z: coord },
  'x·y·z 를 가진 객체여야 합니다.'
)

export const cameraPresetSchema = z.strictObject({
  /** 스크롤 진행도 0~1. 구간이 아니라 지점이고, 사이는 뷰어가 보간한다. */
  at: finiteNumber.min(0, 'at 은 0 이상이어야 합니다.').max(1, 'at 은 1 이하여야 합니다.'),
  camera: vec3Schema,
  target: vec3Schema,
  fov: finiteNumber
    .gt(FOV_MIN_EXCLUSIVE, `fov 는 ${FOV_MIN_EXCLUSIVE}보다 커야 합니다.`)
    .lt(FOV_MAX_EXCLUSIVE, `fov 는 ${FOV_MAX_EXCLUSIVE}보다 작아야 합니다.`)
    .optional(),
})

export type CameraPreset = z.infer<typeof cameraPresetSchema>

export const cameraPresetsSchema = z
  .array(cameraPresetSchema, '프리셋은 배열이어야 합니다.')
  .max(MAX_CAMERA_PRESETS, `프리셋은 최대 ${MAX_CAMERA_PRESETS}개까지 저장할 수 있습니다.`)
  .superRefine((presets, ctx) => {
    // 같은 지점에 프리셋이 둘이면 어느 쪽을 쓸지가 정의되지 않는다. 뷰어에 맡기지 않고 여기서 막는다.
    const seen = new Map<number, number>()
    presets.forEach((preset, index) => {
      const first = seen.get(preset.at)
      if (first === undefined) {
        seen.set(preset.at, index)
        return
      }
      ctx.addIssue({
        code: 'custom',
        path: [index, 'at'],
        message: `at 값이 ${first + 1}번 프리셋과 중복됩니다.`,
      })
    })
  })

const extraValueSchema = z.union(
  [z.string().max(EXTRA_VALUE_MAX, `값은 ${EXTRA_VALUE_MAX}자 이내로 입력해 주세요.`), finiteNumber, z.boolean()],
  '문자열·숫자·참거짓만 저장할 수 있습니다.'
)

/**
 * 확장 값. **객체 하나·한 겹뿐**이다 — 중첩을 허용하면 결국 임의 구조가 들어오고,
 * 그건 "검증된 JSON schema 만" 이라는 G13 을 이름만 남기고 무력화한다.
 */
export const extrasSchema = z
  .record(
    z.string().regex(EXTRA_KEY_SHAPE, '키는 영문으로 시작하고 영숫자·`_`·`.`·`-` 만 쓸 수 있습니다. (40자 이내)'),
    extraValueSchema,
    {
      /**
       * 문자열 하나로 덮으면 **키 오류까지 "객체여야 합니다"로 뭉개진다**(실측).
       * 타입 위반일 때만 우리 문구를 쓰고, 나머지는 안쪽 이슈 메시지를 살린다.
       */
      error: (issue) => (issue.code === 'invalid_type' ? '확장 값은 객체여야 합니다.' : undefined),
    }
  )
  .refine(
    (value) => Object.keys(value).length <= MAX_EXTRAS,
    `확장 값은 최대 ${MAX_EXTRAS}개까지 저장할 수 있습니다.`
  )

export type SceneExtras = z.infer<typeof extrasSchema>

/** 첫 이슈를 사람이 읽을 문장으로. 경로가 있으면 몇 번째 프리셋인지 붙인다. */
export function describeSceneIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return '값을 확인해 주세요.'

  // record 의 키 위반은 실제 사유가 한 겹 안쪽에 있다. 바깥 메시지만 쓰면 영문 기본 문구가 나간다.
  if (issue.code === 'invalid_key') {
    const inner = issue.issues[0]?.message ?? '형식이 올바르지 않습니다.'
    return `키 "${String(issue.path[0] ?? '')}": ${inner}`
  }

  const index = issue.path[0]
  const prefix = typeof index === 'number' ? `${index + 1}번 항목: ` : ''
  return `${prefix}${issue.message}`
}

export type SceneJsonLoad<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly raw: string }

/** 저장된 값이 깨져 있을 때 화면에 원본을 보여 주기 위한 안전한 직렬화. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return '(직렬화할 수 없는 값)'
  }
}

/**
 * DB 에서 읽은 jsonb 를 폼에 싣기 전에 통과시키는 관문.
 *
 * 실패를 예외로 던지지 않는 이유: 손으로 넣은 행 하나 때문에 관리 화면 전체가 500 이 되면
 * **그 행을 고칠 수단까지 함께 사라진다.** 대신 원본을 들고 돌아와 화면이 경고를 띄운다.
 */
export function loadCameraPresets(raw: unknown): SceneJsonLoad<CameraPreset[]> {
  const parsed = cameraPresetsSchema.safeParse(raw)
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: describeSceneIssue(parsed.error), raw: safeStringify(raw) }
}

export function loadSceneExtras(raw: unknown): SceneJsonLoad<SceneExtras> {
  const parsed = extrasSchema.safeParse(raw)
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: describeSceneIssue(parsed.error), raw: safeStringify(raw) }
}
