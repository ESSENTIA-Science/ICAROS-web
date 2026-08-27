'use client'

import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { probe, type BlockReason } from './capabilities'
import { DEFAULT_STAGE, type StageConfig } from './config'
import { trackRect } from './rect'
import styles from './HeroStage.module.css'

/**
 * 홈 고정 캔버스 (P7-27 · D19).
 *
 * 구조는 레퍼런스 두 곳이 **독립적으로 같은 답에 도달한** 패턴을 그대로 따른다
 * (03-reference-research.md §1 Vast `.webgl-home-space-station` / Part 3 Hanwha `.mesh-area`):
 *
 *   - 페이지 위에 `position: fixed; inset: 0; pointer-events: none` 레이어 **하나**를 깐다.
 *   - 섹션은 **빈 타깃 박스**만 선언한다(`data-webgl-target`). 그 박스는 아무것도 그리지 않는다.
 *   - 캔버스가 그 박스의 `getBoundingClientRect()` 를 읽어 카메라 오프셋과 화각을 계산한다.
 *
 * 즉 **HTML/CSS 가 레이아웃을 소유하고 3D 는 읽기만 한다.** 브레이크포인트마다 좌표를
 * 손으로 넣지 않아도 프레이밍이 따라온다.
 *
 * ## 폴백 사다리 (G12 · C12)
 *
 *   ① WebGL2 있고 저사양 아님 → 3D            `Scene` 을 `ssr:false` 로 지연 로드
 *   ② 그 외                    → 포스터 이미지  이 컴포넌트가 직접 그린다
 *   ③ 타깃 박스가 없거나 포스터도 없으면 → 히어로 그대로 (보이는 것 없음)
 *
 * **모바일은 기본 off** (`enabledMobile: false`) — `rocket_models.enabled_mobile` 의
 * 스키마 기본값과 같은 판단이다.
 *
 * ## 초기 JS 를 늘리지 않는 방법
 *
 * `three` · `@react-three/fiber` 를 이 파일에서 **정적으로 import 하지 않는다.** `Scene` 은
 * `next/dynamic(..., { ssr: false })` 뒤에 있고, 프로브를 통과한 뒤에야 렌더돼서 청크 요청이 나간다.
 * 프로브가 막으면 3D 청크는 **네트워크에 나가지도 않는다.**
 *
 * ## 포스터가 서버 HTML 에 들어가는 이유
 *
 * 레이어와 포스터는 조건 없이 렌더한다. 클라이언트 컴포넌트도 SSR 되므로 `<img>` 가 첫 HTML 에
 * 들어가고 브라우저가 일찍 받는다. 위치는 하이드레이션 뒤에야 정해지므로 그 전까지 `opacity: 0` 이다 —
 * 엉뚱한 자리에서 번쩍이는 것보다 늦게 나타나는 편이 낫다.
 */
const Scene = dynamic(() => import('./Scene'), { ssr: false, loading: () => null })

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function readReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION).matches
}

export interface HeroStageProps extends Partial<StageConfig> {
  /** 프레이밍 대상. 히어로의 `data-webgl-target` 값과 같아야 한다. */
  target?: string
}

type Phase =
  /** 아직 프로브 전 (SSR 포함) */
  | { kind: 'pending' }
  /** 승격 실패 — 포스터로 간다 */
  | { kind: 'poster'; reason: BlockReason | 'error' | 'no-target' }
  /** 3D 청크를 받는 중. 포스터는 그대로 보인다 */
  | { kind: 'mounting' }
  /** 첫 프레임이 그려졌다 */
  | { kind: 'live' }

export default function HeroStage(props: HeroStageProps) {
  const targetName = props.target ?? 'home-hero'
  const config: StageConfig = { ...DEFAULT_STAGE, ...props }
  const { enabledDesktop, enabledMobile, poster } = config

  const boxRef = useRef<HTMLDivElement | null>(null)
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'pending' })

  /**
   * 모션 선호는 미디어 쿼리다 — `useSyncExternalStore` 가 정확히 이런 외부 소스를 위한 API 다.
   * `useEffect` + `setState` 로 읽으면 SSR 값과 첫 클라이언트 값이 어긋나 리렌더가 한 번 더 나고,
   * `react-hooks/set-state-in-effect` 에도 걸린다. 서버 스냅샷은 false(모션 허용)로 둔다 —
   * 실제 값은 하이드레이션 즉시 반영되고, 그 전에는 어차피 3D 가 마운트되지 않았다.
   */
  const reduced = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false)

  /**
   * 타깃 박스 찾기 + 승격 판정.
   *
   * `requestAnimationFrame` 으로 한 프레임 미루는 것은 lint 회피가 아니라 **의도한 순서**다.
   * 이펙트 본문에서 곧바로 setState 하면 하이드레이션 직후 렌더가 한 번 더 도는데, 그 시점은
   * 브라우저가 첫 페인트를 그리는 중이다. WebGL 컨텍스트 프로브(`getContext('webgl2')`)는
   * 싸지 않으므로 첫 페인트 뒤로 미룬다.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-webgl-target="${targetName}"]`)
      if (el === null) {
        // 조용히 죽으면 디자인 트랙이 속성 값을 바꿨을 때 아무도 모른다. 개발에서만 알린다.
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[HeroStage] data-webgl-target="${targetName}" 없음 — 3D·포스터를 건너뛴다`)
        }
        setPhase({ kind: 'poster', reason: 'no-target' })
        return
      }
      setElement(el)
      const blocked = probe({ enabledDesktop, enabledMobile })
      setPhase(blocked === null ? { kind: 'mounting' } : { kind: 'poster', reason: blocked })
    })
    return () => cancelAnimationFrame(frame)
  }, [targetName, enabledDesktop, enabledMobile])

  /**
   * 포스터를 타깃 박스에 맞춰 붙인다. rect 를 React state 로 들고 있으면 스크롤마다 리렌더가 나서
   * 히어로 아래 섹션까지 전부 다시 그린다. 그래서 **DOM 에 직접 쓴다.**
   */
  useEffect(() => {
    const box = boxRef.current
    if (element === null || box === null) return
    return trackRect(element, (rect) => {
      box.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`
      box.dataset['placed'] = 'true'
    })
  }, [element])

  const mountScene = element !== null && (phase.kind === 'mounting' || phase.kind === 'live')

  return (
    <div className={styles.layer} aria-hidden="true" data-phase={phase.kind}>
      <div ref={boxRef} className={styles.box}>
        {poster !== null ? (
          <Image
            className={styles.poster}
            src={poster}
            alt=""
            fill
            /*
              `fill` 은 박스 전체 폭을 레이아웃 폭으로 알린다. 그런데 포스터는 `object-fit: contain`
              이라 실제로 그려지는 폭은 **높이에 종속**된다 — 실측(framing 검증)으로 데스크톱
              히어로 박스 1312px 안에서 기체가 차지하는 폭이 129px 였다. 박스 폭을 그대로 알리면
              쓸데없이 큰 후보를 받는다. 높이 기준으로 알린다.
            */
            sizes="(max-width: 767px) 50vw, 30vh"
            // 히어로 안에 있어 거의 항상 첫 화면이다. lazy 로 두면 하이드레이션 뒤에야 요청이 나간다.
            loading="eager"
            draggable={false}
            data-hidden={phase.kind === 'live' ? 'true' : undefined}
          />
        ) : null}
      </div>

      {mountScene ? (
        <Scene
          target={element}
          config={config}
          reducedMotion={reduced}
          onReady={() => setPhase({ kind: 'live' })}
          onError={() => setPhase({ kind: 'poster', reason: 'error' })}
        />
      ) : null}
    </div>
  )
}
