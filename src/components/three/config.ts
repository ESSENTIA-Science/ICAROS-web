/**
 * 고정 캔버스 설정. **DB 를 읽지 않는다** — D19 로 `icx2`(ICX-II) 로켓 행이 라이브에서 삭제된 채로
 * 두기로 했고, `rocket_models.rocket_id` 도 null 로 두기 때문이다. 그래서 지금은 정적 자산을 가리킨다.
 *
 * 필드 이름은 `rocket_models` 컬럼과 **일부러 같게** 맞췄다 (`enabled_desktop` · `enabled_mobile` ·
 * `auto_rotate` · `fov`). 나중에 CMS 를 붙일 때 DAL 이 이 모양으로 한 줄 매핑하면 끝나도록.
 */
export interface StageConfig {
  /** GLB URL. 나중에 CMS 를 붙이면 `/api/media/{glb_media_id}` 가 들어온다. */
  src: string
  /** 폴백 포스터 URL. null 이면 사다리 3단(히어로 그대로). */
  poster: string | null
  enabledDesktop: boolean
  /** 스키마 기본값과 같은 false. 모바일에 WebGL 을 강제하지 않는다 (C12). */
  enabledMobile: boolean
  autoRotate: boolean
  /** 궤도 각도(도). 포스터도 같은 값으로 렌더했다 — 승격 순간 그림이 튀지 않게. */
  yaw: number
  pitch: number
  /** 세로 화각(도). 타깃 박스 기준이고, 캔버스로 확장하는 것은 `setViewOffset` 이 한다. */
  fov: number
  /** 타깃 박스를 채우는 비율 0..1. 1 이면 모델이 박스에 딱 붙는다. */
  fit: number
  /**
   * 화면 롤(도). 모델이 아니라 **카메라 up** 을 돌린다.
   * 90 이면 길쭉한 기체가 화면에서 가로로 눕는다 — 넓고 납작한 히어로 박스와 축이 맞는다.
   */
  roll: number
}

/**
 * 기본값. `yaw/pitch/fov/fit` 은 `scripts/model/render-poster.ts` 의 기본값과 **같은 수**여야 한다 —
 * 포스터가 그 값으로 구워졌고, 사다리 2→1 승격에서 프레이밍이 이어져야 하기 때문이다.
 */
export const DEFAULT_STAGE: StageConfig = {
  src: '/assets/models/icx-2.glb',
  poster: '/assets/models/icx-2-poster.png',
  enabledDesktop: true,
  enabledMobile: false,
  autoRotate: true,
  yaw: -28,
  pitch: 8,
  fov: 28,
  fit: 0.86,
  // 히어로 타깃 박스는 1360×239(5.7:1)로 넓고 납작한데 기체는 0.46×1.66×0.46 으로 길쭉하다.
  // 세로 구속 때문에 가로를 7.8% 밖에 못 채웠다. 눕히면 긴 축끼리 맞는다.
  roll: 90,
}
