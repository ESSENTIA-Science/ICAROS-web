/**
 * 3D Scene 설정의 공유 상수.
 *
 * 클라이언트 폼과 서버 액션이 **같은 값**을 봐야 한다 — 상한이 두 벌로 갈라지면
 * "폼은 통과시켰는데 서버가 조용히 거부"가 생긴다. 그래서 zod 도 DB 도 여기 두지 않는다.
 * 순수 상수만 있어야 클라이언트 번들에 서버 코드가 딸려오지 않는다.
 */

/** `rocket_models_env_ck` CHECK 와 같은 목록. 순서까지 맞춰 둔다. */
export const SCENE_ENVIRONMENTS = [
  'studio',
  'city',
  'sunset',
  'dawn',
  'night',
  'warehouse',
  'none',
] as const

export type SceneEnvironment = (typeof SCENE_ENVIRONMENTS)[number]

/** 값 자체는 three.js 프리셋 이름이라 영문 그대로 두고, 뜻만 한국어로 붙인다. */
export const SCENE_ENVIRONMENT_LABELS: Readonly<Record<SceneEnvironment, string>> = {
  studio: 'studio — 스튜디오 조명',
  city: 'city — 도심 주광',
  sunset: 'sunset — 일몰',
  dawn: 'dawn — 새벽',
  night: 'night — 야간',
  warehouse: 'warehouse — 실내 창고',
  none: 'none — 환경광 없음',
}

export const MAX_CAMERA_PRESETS = 12
export const MAX_HOTSPOTS = 24
export const MAX_EXTRAS = 16

/** `rocket_models_fov_ck` 와 같은 경계. 양끝 모두 열린 구간이다. */
export const FOV_MIN_EXCLUSIVE = 0
export const FOV_MAX_EXCLUSIVE = 180

/**
 * jsonb 안 좌표의 상식 범위.
 * 전용 컬럼과 달리 프리셋 좌표에는 numeric(precision) 도 CHECK 도 걸리지 않는다 —
 * 여기가 유일한 방어선이라 상한을 명시한다.
 */
export const COORD_ABS_LIMIT = 100_000

export const EXTRA_VALUE_TYPES = ['string', 'number', 'boolean'] as const
export type ExtraValueType = (typeof EXTRA_VALUE_TYPES)[number]

export const EXTRA_VALUE_TYPE_LABELS: Readonly<Record<ExtraValueType, string>> = {
  string: '문자열',
  number: '숫자',
  boolean: '참/거짓',
}

/** extras 키. 점 표기까지만 허용하고 공백·따옴표·괄호는 막는다. */
export const EXTRA_KEY_SHAPE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/

// ── 길이 상한 (폼 maxLength 와 서버 zod 가 같은 값을 본다) ──────────────────

export const LABEL_MAX = 120
export const ANIMATION_CLIP_MAX = 120
export const HOTSPOT_TITLE_MAX = 120
export const HOTSPOT_BODY_MAX = 4000
export const HIGHLIGHT_NODE_MAX = 120
export const EXTRA_VALUE_MAX = 500
/** 부호·소수점을 포함한 숫자 입력의 시각적 상한. 실제 판정은 numeric precision 이 한다. */
export const NUMBER_INPUT_MAX = 14

/**
 * 홈 대표 지정은 `home_feature` 단일 행이라 "아직 행이 없음" 상태가 존재한다.
 * 그 상태를 낙관적 잠금 토큰 자리에 명시적으로 실어 보낸다 — 빈 문자열로 두면
 * "토큰을 안 보냈다"와 구별되지 않는다.
 */
export const HOME_FEATURE_NEW_TOKEN = 'new'
