'use client'

import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ACESFilmicToneMapping,
  Box3,
  Group,
  MathUtils,
  PerspectiveCamera,
  PMREMGenerator,
  type WebGLRenderTarget,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import type { StageConfig } from './config'
import { applyStageCamera } from './framing'

/**
 * 3D 씬 — **이 파일이 무거운 청크다.** `HeroStage` 가 `next/dynamic(..., { ssr: false })` 로만
 * 부르므로 초기 번들에 `three` 가 들어가지 않는다. 여기서 정적 import 를 늘려도 초기 JS 는 그대로다.
 *
 * drei 를 쓰지 않는다. 필요한 것은 `useGLTF` 와 bounds 둘뿐인데, drei 는 three-stdlib ·
 * troika-three-text · @mediapipe/tasks-vision · camera-controls 를 끌고 온다. 두 기능을
 * GLTFLoader + Box3 로 직접 쓰면 그 의존 그래프가 통째로 사라진다. 핫스팟 라벨(G11)이
 * 실제로 필요해지는 날 다시 판단한다 — D19 로 지금은 홈 히어로 하나뿐이다.
 */

export interface SceneProps {
  target: HTMLElement
  config: StageConfig
  reducedMotion: boolean
  onReady: () => void
  onError: () => void
}

// ─────────────────────────────────────────────────────────────
// 카메라 리그 — 수학은 framing.ts 에 있다 (브라우저 없이 검증하려고 갈라 두었다)
// ─────────────────────────────────────────────────────────────

interface RigProps {
  target: HTMLElement
  config: StageConfig
  reducedMotion: boolean
  boxRef: React.RefObject<Box3 | null>
}

/**
 * 매 프레임 타깃 박스를 읽어 카메라를 맞춘다 (Hanwha `getAreaInfo`/`getCameraOffset` 과 같은 계약).
 *
 * 핵심은 `setViewOffset` 이다. 캔버스는 뷰포트 전체인데 모델은 **박스 안에** 있어야 한다.
 * `setViewOffset(rectW, rectH, -rectX, -rectY, canvasW, canvasH)` 는 "가상의 rectW×rectH 이미지"를
 * 기준으로 프러스텀 스케일을 잡고, 실제 캔버스를 그 이미지의 (-rectX, -rectY) 위치에 놓인
 * 더 큰 창으로 취급한다. 결과적으로 모델은 박스 좌표에 정확히 놓이고 화면 비율 왜곡은 없다
 * (최종 프러스텀 종횡비가 canvasW/canvasH 로 떨어진다).
 *
 * `getBoundingClientRect()` 를 프레임마다 부르는 것은 의도적이다 — 스크롤 이벤트를 모아
 * 캐시하는 것보다 정확하고, 이 프레임에서 DOM 을 쓰지 않으므로 레이아웃 스래싱이 없다.
 */
function CameraRig({ target, config, reducedMotion, boxRef }: RigProps) {
  /**
   * `useThree()` 로 카메라를 꺼내 쓰지 않는다. React Compiler 의 `react-hooks/immutability` 는
   * **훅이 돌려준 값을 렌더 이후에 변형하는 것**을 금지하는데, R3F 에서 카메라를 매 프레임
   * 고쳐 쓰는 것은 정확히 그 모양이다. `useFrame` 콜백 인자로 받은 state 는 훅 반환값이 아니라
   * 프레임 인자라 규칙에 걸리지 않고, 의미도 같다 — 오히려 최신 값이 보장된다.
   */
  useFrame((state) => {
    const box = boxRef.current
    if (box === null) return
    const camera = state.camera
    if (!(camera instanceof PerspectiveCamera)) return

    const rect = target.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return

    // 스크롤 진행도. 박스가 위로 빠져나간 만큼 0→1. 모션을 끄면 항상 0 이다.
    const progress = reducedMotion
      ? 0
      : MathUtils.clamp(-rect.top / Math.max(rect.height, 1), 0, 1)

    applyStageCamera(camera, box, rect, state.size, config, progress)
  })

  return null
}

// ─────────────────────────────────────────────────────────────
// 조명 — 텍스처가 0개라 조명이 시각 품질의 전부다 (10-3d-assets.md §8)
// ─────────────────────────────────────────────────────────────

function Lighting() {
  return (
    <>
      {/* 키 라이트. 포스터 래스터라이저의 KEY 벡터(-0.45, 0.8, 0.7)와 같은 방향이다 */}
      <directionalLight position={[-4.5, 8, 7]} intensity={2.2} />
      {/* 림. 실루엣의 반대쪽 모서리만 살린다 */}
      <directionalLight position={[6, -1.5, -7.5]} intensity={0.9} />
      <ambientLight intensity={0.35} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// 모델
// ─────────────────────────────────────────────────────────────

interface ModelProps {
  src: string
  autoRotate: boolean
  reducedMotion: boolean
  boxRef: React.RefObject<Box3 | null>
  onReady: () => void
}

function Model({ src, autoRotate, reducedMotion, boxRef, onReady }: ModelProps) {
  const gltf = useLoader(GLTFLoader, src, (loader) => {
    // EXT_meshopt_compression 디코더. three 에 동봉돼 있어 배포 파일이 늘지 않는다 —
    // Draco 대신 meshopt 를 고른 이유가 정확히 이것이다 (10-3d-assets.md §3.3).
    loader.setMeshoptDecoder(MeshoptDecoder)
  })

  const group = useRef<Group | null>(null)
  const frames = useRef(0)

  /**
   * 바운딩 박스는 **한 번만** 잰다. 자동 회전 중에 매 프레임 재면 AABB 가 커졌다 작아졌다 하면서
   * 카메라 거리가 숨쉬듯 흔들린다. 회전축이 Y 이고 기체가 거의 축대칭이라 한 번 잰 값으로 충분하다.
   */
  const box = useMemo(() => new Box3().setFromObject(gltf.scene), [gltf.scene])
  useEffect(() => {
    boxRef.current = box
    return () => {
      boxRef.current = null
    }
  }, [box, boxRef])

  useFrame((_, delta) => {
    if (frames.current < 2) {
      frames.current += 1
      // 로드 직후가 아니라 **실제로 두 프레임 그린 뒤** 포스터를 뗀다. 빈 캔버스가 노출되지 않는다.
      if (frames.current === 2) onReady()
      return
    }
    if (!autoRotate || reducedMotion) return
    const g = group.current
    if (g !== null) g.rotation.y += delta * 0.12
  })

  return (
    <group ref={group}>
      <primitive object={gltf.scene} />
    </group>
  )
}

// ─────────────────────────────────────────────────────────────
// 에러 경계 — GLB 가 404 이거나 디코더가 실패하면 포스터로 되돌린다
// ─────────────────────────────────────────────────────────────

interface BoundaryProps {
  onError: () => void
  children: ReactNode
}

/**
 * R3F 트리 **안쪽**에 둔다. Canvas 는 별도 reconciler 루트라 밖의 경계가 항상 잡아 주지 않는다.
 * fallback 은 null 이다 — 3D 가 실패하면 `HeroStage` 가 포스터를 다시 켠다.
 */
class SceneBoundary extends Component<BoundaryProps, { failed: boolean }> {
  constructor(props: BoundaryProps) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    if (process.env.NODE_ENV !== 'production') console.error('[HeroStage] 3D 실패', error)
    this.props.onError()
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

export default function Scene({ target, config, reducedMotion, onReady, onError }: SceneProps) {
  const boxRef = useRef<Box3 | null>(null)
  const envRef = useRef<WebGLRenderTarget | null>(null)
  const [visible, setVisible] = useState(true)

  // PMREM 렌더 타깃은 R3F 의 자동 dispose 대상이 아니다. 언마운트에서 직접 반납한다.
  useEffect(
    () => () => {
      envRef.current?.dispose()
      envRef.current = null
    },
    []
  )

  /**
   * 히어로가 화면 밖으로 나가면 렌더 루프를 **완전히 멈춘다**. 랜딩은 스크롤이 긴 페이지라
   * 이걸 안 하면 사용자가 후원 섹션을 읽는 동안에도 GPU 가 매 프레임 돈다.
   */
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry !== undefined) setVisible(entry.isIntersecting)
      },
      { rootMargin: '10% 0px' }
    )
    io.observe(target)
    return () => io.disconnect()
  }, [target])

  return (
    <Canvas
      frameloop={visible ? 'always' : 'never'}
      dpr={[1, 2]}
      // 알파를 켜야 섹션 배경(테마별로 다르다)이 그대로 비친다. 캔버스가 배경색을 칠하면
      // 다크/라이트 테마 전환에서 사각형이 드러난다.
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      /**
       * 톤매핑과 환경맵을 여기서 세운다. 자식 컴포넌트의 `useEffect` 안에서 하면
       * `useThree()` 가 돌려준 scene/gl 을 변형하게 되어 `react-hooks/immutability` 에 걸린다.
       * `onCreated` 의 state 는 콜백 인자라 그 제약이 없고, 렌더러가 만들어진 직후 딱 한 번 돈다.
       *
       * 환경맵은 `RoomEnvironment` 로 **런타임 생성**한다 — HDR 파일을 배포하지 않아도 되고
       * (자산 0바이트), 텍스처가 0개인 회색 CAD 머티리얼에 반사 그라디언트를 주는 유일한 수단이다.
       */
      onCreated={(state) => {
        state.gl.toneMapping = ACESFilmicToneMapping
        state.gl.toneMappingExposure = 1.05

        const pmrem = new PMREMGenerator(state.gl)
        const rt = pmrem.fromScene(new RoomEnvironment(), 0.04)
        pmrem.dispose()
        state.scene.environment = rt.texture
        state.scene.environmentIntensity = 0.85
        envRef.current = rt
      }}
      style={{ pointerEvents: 'none' }}
    >
      <CameraRig target={target} config={config} reducedMotion={reducedMotion} boxRef={boxRef} />
      <Lighting />
      <SceneBoundary onError={onError}>
        <Suspense fallback={null}>
          <Model
            src={config.src}
            autoRotate={config.autoRotate}
            reducedMotion={reducedMotion}
            boxRef={boxRef}
            onReady={onReady}
          />
        </Suspense>
      </SceneBoundary>
    </Canvas>
  )
}
