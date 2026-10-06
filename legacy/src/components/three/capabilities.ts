/**
 * 3D 승격 판정 (G12 · C12). 브라우저에서만 의미가 있는 모듈이지만 `'use client'` 는 붙이지 않는다 —
 * 이 파일은 컴포넌트가 아니라 함수 모음이고, 부르는 쪽이 이미 클라이언트다.
 *
 * 설계 원칙 하나: **모르면 통과시킨다.** `deviceMemory` 는 Safari 가 구현하지 않고
 * `navigator.connection` 은 표준이 아니다. 없는 값을 "저사양"으로 읽으면 멀쩡한 기기를
 * 포스터에 가둔다. 그래서 차단은 **적극적으로 나쁘다고 말한 신호**에만 건다.
 * (10-3d-assets.md §5.2 의 경고를 그대로 코드로 옮긴 것이다.)
 */

/** 승격을 막는 이유. 디버깅과 보고를 위해 문자열로 남긴다. */
export type BlockReason =
  | 'no-webgl2'
  | 'mobile-disabled'
  | 'save-data'
  | 'low-memory'
  | 'disabled'

export interface ProbeOptions {
  /** `rocket_models.enabled_desktop` 에 대응 */
  enabledDesktop: boolean
  /** `rocket_models.enabled_mobile` 에 대응. 스키마 기본값이 false 인 이유가 이 판정이다 */
  enabledMobile: boolean
}

/**
 * WebGL2 는 "지원 여부"를 가정하지 않고 **컨텍스트를 실제로 만들어** 확인한다.
 * `'WebGL2RenderingContext' in window` 는 드라이버 블랙리스트·GPU 프로세스 실패에서
 * 거짓 양성을 낸다. 확인 후 컨텍스트는 즉시 반납한다 — 브라우저의 동시 컨텍스트 수는 유한하다.
 */
export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (gl === null) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    // 일부 브라우저는 컨텍스트 생성 실패를 예외로 던진다
    return false
  }
}

/** CSS 의 모바일 브레이크포인트와 같은 값을 쓴다 (Hero.module.css 의 `max-width: 767px`). */
export function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 767px)').matches
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * `navigator.connection` 은 표준이 아니라 타입 선언이 없다. 캐스팅 대신 `in` 좁히기로 읽는다 —
 * 있으면 존중하고, 없으면 통과다.
 */
export function prefersSaveData(): boolean {
  if (!('connection' in navigator)) return false
  const conn: unknown = navigator.connection
  if (typeof conn !== 'object' || conn === null) return false
  if (!('saveData' in conn)) return false
  return conn.saveData === true
}

/**
 * `deviceMemory` 는 Chromium 계열에만 있다. **없으면 통과**가 핵심이다.
 * 4 GB 미만만 거른다 — 이 자산은 draw call 31 · 삼각형 511k 라 그 이상이면 여유가 있다.
 */
export function isLowMemory(): boolean {
  if (!('deviceMemory' in navigator)) return false
  const mem: unknown = navigator.deviceMemory
  return typeof mem === 'number' && mem > 0 && mem < 4
}

/** 승격 가능하면 null, 막히면 이유를 돌려준다. */
export function probe(options: ProbeOptions): BlockReason | null {
  const mobile = isMobileViewport()
  if (mobile ? !options.enabledMobile : !options.enabledDesktop) {
    return mobile ? 'mobile-disabled' : 'disabled'
  }
  if (!hasWebGL2()) return 'no-webgl2'
  if (prefersSaveData()) return 'save-data'
  if (isLowMemory()) return 'low-memory'
  return null
}
