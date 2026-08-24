import { Box3, MathUtils, PerspectiveCamera, Vector3 } from 'three'

import type { StageConfig } from './config'

/**
 * 고정 캔버스 ↔ 타깃 박스를 잇는 카메라 수학. **이 파일이 P7-27 의 전부다.**
 *
 * React 도 R3F 도 들어 있지 않다 — 순수 함수라 `scripts/model/verify-runtime-load.ts` 가
 * 브라우저 없이 그대로 불러 검증할 수 있다. 렌더 루프에서만 쓰이는 코드가 테스트되지 않은 채
 * 남는 것을 막으려고 일부러 이렇게 갈랐다.
 *
 * ⚠ `three` 를 import 하므로 **`HeroStage.tsx` 에서 이 파일을 부르면 안 된다.**
 * 초기 번들에 three 가 딸려 들어간다. 부르는 곳은 `Scene.tsx`(지연 청크)뿐이다.
 */

export interface StageRect {
  left: number
  top: number
  width: number
  height: number
}

export interface CanvasSize {
  width: number
  height: number
}

/** 궤도각(도) → 중심에서 카메라로 향하는 단위 벡터. Y-up. */
/**
 * 롤이 적용된 up 벡터. `forward` 축을 중심으로 월드 up 을 회전시킨다.
 * `fitDistance` 와 `applyStageCamera` 가 **같은 함수**를 써야 fit 과 렌더가 어긋나지 않는다.
 */
export function rollUp(rollDeg: number, forward: Vector3): Vector3 {
  const up = new Vector3(0, 1, 0)
  if (rollDeg === 0) return up
  return up.applyAxisAngle(forward.clone().normalize(), MathUtils.degToRad(rollDeg))
}

export function orbitDirection(yawDeg: number, pitchDeg: number): Vector3 {
  const yaw = MathUtils.degToRad(yawDeg)
  const pitch = MathUtils.degToRad(pitchDeg)
  return new Vector3(
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw)
  )
}

/**
 * 타깃 박스 안에 모델을 담는 카메라 거리.
 *
 * 바운딩 **구**로 잡으면 안 된다. 이 기체는 0.46 × 1.66 × 0.46 m 로 극단적으로 길쭉해서
 * 구 반경(0.89)이 세로 높이에 지배되는데, 좁은 가로 화각으로 그 구를 담으려다 카메라가
 * 필요한 거리의 두 배까지 물러난다(첫 포스터 렌더에서 실제로 그랬다).
 * AABB 8꼭짓점을 카메라 축으로 투영해 가로·세로 구속을 따로 푼다.
 *
 * `scripts/model/render-poster.ts` 가 **같은 식**을 쓴다. 두 곳이 어긋나면 폴백 사다리
 * 2→1 승격에서 그림이 튄다 — 고칠 때 반드시 같이 고쳐야 한다.
 */
export function fitDistance(
  box: Box3,
  center: Vector3,
  dir: Vector3,
  rectW: number,
  rectH: number,
  fovDeg: number,
  fit: number,
  /**
   * 화면 롤(도). 카메라의 up 을 돌린다 — 모델은 그대로 두고 **화면에서만** 눕힌다.
   *
   * 이게 필요한 이유: 이 기체는 0.46 × 1.66 × 0.46 으로 길쭉한데 히어로 타깃 박스는
   * 1360 × 239(5.7:1)로 넓고 납작하다. 세로가 구속조건이 되어 가로를 7.8% 만 채웠다
   * (실측: 1440×900 에서 기체가 약 200 × 60 px).
   * 90도 눕히면 긴 축이 박스의 긴 축과 맞아 같은 거리에서 훨씬 크게 잡힌다.
   *
   * 모델 자체를 돌리지 않는 이유: `Box3.setFromObject` 가 회전 전 박스를 주므로
   * fit 계산과 실제 렌더가 어긋난다. 기저를 돌리면 두 곳이 자동으로 일치한다.
   */
  rollDeg: number
): number {
  const fovY = MathUtils.degToRad(fovDeg)
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * (rectW / rectH))
  const tanX = Math.tan(fovX / 2) * fit
  const tanY = Math.tan(fovY / 2) * fit

  const forward = dir.clone().negate()
  const worldUp = rollUp(rollDeg, forward)
  const right = new Vector3().crossVectors(forward, worldUp).normalize()
  const up = new Vector3().crossVectors(right, forward)

  const corner = new Vector3()
  const d = new Vector3()
  let distance = 0
  for (let i = 0; i < 8; i += 1) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    )
    d.subVectors(corner, center)
    const u = Math.abs(d.dot(right))
    const v = Math.abs(d.dot(up))
    // 전방 성분만큼 카메라가 더 물러나야 한다
    const w = d.dot(forward)
    distance = Math.max(distance, u / tanX + w, v / tanY + w)
  }
  return distance
}

/**
 * 카메라를 타깃 박스에 맞춘다 (Hanwha `getAreaInfo`/`getCameraOffset` 과 같은 계약).
 *
 * 핵심은 `setViewOffset` 이다. 캔버스는 뷰포트 전체인데 모델은 **박스 안에** 있어야 한다.
 * `setViewOffset(rectW, rectH, -rectX, -rectY, canvasW, canvasH)` 는 "가상의 rectW×rectH 이미지"
 * 기준으로 프러스텀 스케일을 잡고, 실제 캔버스를 그 이미지의 (-rectX, -rectY) 위치에 놓인
 * 더 큰 창으로 취급한다. 결과적으로 모델은 박스 좌표에 정확히 놓이고 종횡비 왜곡은 없다 —
 * 최종 프러스텀 종횡비가 `canvasW/canvasH` 로 떨어지기 때문이다.
 *
 * @param progress 0..1 스크롤 진행도. 모션을 끄면 호출부가 0 을 준다.
 */
export function applyStageCamera(
  camera: PerspectiveCamera,
  box: Box3,
  rect: StageRect,
  canvas: CanvasSize,
  config: StageConfig,
  progress: number,
  /**
   * 커서 위치 −1..1 (뷰포트 중심 기준). 궤도각에 얹어 시차를 만든다.
   * 모델을 움직이지 않고 **카메라만** 도는 이유: 모델을 돌리면 프레이밍 계산(AABB)과
   * 실제 렌더가 어긋난다. 궤도각은 `fitDistance` 가 이미 쓰는 축이라 자동으로 일치한다.
   */
  pointer: { x: number; y: number } = { x: 0, y: 0 }
): void {
  const center = box.getCenter(new Vector3())
  const dir = orbitDirection(
    config.yaw + progress * 18 + pointer.x * config.pointerYaw,
    config.pitch + progress * 4 + pointer.y * config.pointerPitch
  )
  const distance = fitDistance(box, center, dir, rect.width, rect.height, config.fov, config.fit, config.roll)
  const span = box.getSize(new Vector3()).length()

  camera.position.copy(center).addScaledVector(dir, distance)
  // fitDistance 와 **같은 up** 을 써야 계산과 렌더가 일치한다.
  camera.up.copy(rollUp(config.roll, dir.clone().negate()))
  camera.lookAt(center)

  camera.fov = config.fov
  camera.aspect = rect.width / rect.height
  // 근평면을 모델 바로 앞까지 당겨야 깊이 정밀도가 확보된다. 511k 삼각형이 겹쳐 있어 z-fighting 이 눈에 띈다.
  camera.near = Math.max(0.01, distance - span)
  camera.far = distance + span * 2
  camera.setViewOffset(rect.width, rect.height, -rect.left, -rect.top, canvas.width, canvas.height)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
}

/**
 * 월드 좌표 → 캔버스 픽셀. 검증용이자, 나중에 핫스팟 라벨(G11)을 붙일 때 그대로 쓸 수 있는 변환이다.
 * 캔버스가 뷰포트를 덮으므로 결과는 곧 뷰포트 좌표다.
 */
export function projectToCanvas(
  camera: PerspectiveCamera,
  point: Vector3,
  canvas: CanvasSize
): { x: number; y: number } {
  const ndc = point.clone().project(camera)
  return {
    x: (ndc.x * 0.5 + 0.5) * canvas.width,
    y: (0.5 - ndc.y * 0.5) * canvas.height,
  }
}
