import Image from 'next/image'
import Link from 'next/link'

import Reveal from './Reveal'

import type { LandingPanel } from '@/lib/panels'
import styles from './Panel.module.css'

/**
 * `prefers-reduced-motion: reduce` 면 배경 영상을 자동재생하지 않는다.
 *
 * ## 왜 스크립트인가
 *
 * CSS 로는 autoplay 를 막을 수 없다 — 미디어 재생은 스타일이 아니다. 남는 지렛대는 JS 뿐인데
 * 이 컴포넌트는 Server Component 로 남아야 하고 새 클라이언트 잎도 만들지 않기로 했다.
 * 서버 컴포넌트가 내보내는 인라인 `<script>` 는 **클라이언트 번들에 0바이트**를 싣는다.
 * (React 19 가 인라인 script 를 트리 위치 그대로 출력한다는 것은 `renderToStaticMarkup` 으로 확인했다.)
 *
 * ## 왜 "속성을 켜 두고 스크립트가 끄는" 방향인가
 *
 * 반대(속성 없이 스크립트가 켜기)로 하면 **JS 가 없는 모든 방문자**에게 배경이 멈춘 판때기가 된다.
 * 이 방향의 손해는 "감소된 모션을 켰는데 JS 는 꺼 둔" 교집합뿐이다.
 * 스크립트는 `<video>` 바로 뒤에서 파싱 중에 실행되고, 그 시점에는 `preload` 가
 * `metadata`/`none` 이라 재생을 시작할 만한 미디어 데이터가 아직 오지 않았다.
 *
 * 현재 DOM 에 있는 패널 영상 전부를 대상으로 하므로 **여러 번 실행돼도 결과가 같다.**
 */
const REDUCED_MOTION_GUARD =
  "(function(){try{" +
  "if(!window.matchMedia||!matchMedia('(prefers-reduced-motion: reduce)').matches)return;" +
  "var v=document.querySelectorAll('video[data-panel-video]');" +
  "for(var i=0;i<v.length;i++){v[i].autoplay=false;v[i].removeAttribute('autoplay');" +
  "v[i].preload='metadata';v[i].pause()}" +
  "}catch(e){}})()"

/**
 * 패널 하나 = 사진(또는 영상) 한 장 + 그 위 텍스트.
 *
 * **레코드가 조판을 정한다.** 초점·스크림·정렬·높이가 전부 `PanelRecord` 필드이고,
 * 이 컴포넌트는 그 값을 CSS 커스텀 프로퍼티와 `data-*` 로 옮기기만 한다.
 * 컴포넌트가 패널마다 분기하기 시작하면 CMS 로 고칠 수 있는 범위가 코드에 갇힌다.
 *
 * 사진과 영상의 분기는 그 예외다 — 화면에 나갈 태그 자체가 다르다. 대신 **초점은 하나의 모델로
 * 남는다**: 두 경로 모두 `--focal-x/y` 를 `object-position` 으로 받는다(`Panel.module.css`).
 * 그래서 운영자가 배우는 조작이 사진이든 영상이든 같다.
 *
 * `priority` 는 첫 패널에만 준다 — 나머지는 화면 밖이고, 전부 우선 로드하면
 * LCP 가 되는 첫 장이 나머지 네 장과 대역폭을 나눠 갖는다.
 *
 * `media.placeholder` 는 **화면에 그리지 않는다.** 교체할 사진을 표시하는 것은 우리 쪽 메모이지
 * 방문자에게 할 말이 아니다. 값은 `_panels.ts` 에 남아 있고 그게 교체 목록 역할을 한다.
 */
export default function Panel({ panel, first }: { panel: LandingPanel; first: boolean }) {
  const isVideo = panel.mime.startsWith('video/')

  return (
    <section
      className={styles.panel}
      data-height={panel.heightMode}
      data-scrim={panel.scrim}
      data-anchor={panel.anchor}
      style={
        {
          '--focal-x': `${panel.focalX}%`,
          '--focal-y': `${panel.focalY}%`,
        } as React.CSSProperties
      }
    >
      <div className={styles.media}>
        {/* 바이트는 `/api/media/[id]` 가 S3 에서 그대로 흘려 준다 (D15).
            302 가 아니다 — Next 이미지 최적화기가 `Location` 을 따라가지 않아 0바이트로 끝난다. */}
        {isVideo ? (
          <>
            {/* **`next/image` 를 통과시키지 않는다.** 최적화기는 영상을 다루지 않고, 그럴 필요도 없다 —
                `/api/media/[id]` 가 `Range` 를 S3 로 그대로 넘기고 `Accept-Ranges` 를 내보내므로
                `<video>` 가 직접 붙으면 탐색까지 그대로 된다.
                배경이라 보조기술에 내보내지 않는다 — 이 패널의 뜻은 아래 헤드라인이 진다. */}
            <video
              data-panel-video=""
              src={`/api/media/${panel.mediaId}`}
              width={panel.width}
              height={panel.height}
              autoPlay
              muted
              loop
              playsInline
              /* 첫 패널만 metadata. 화면 밖 영상이 대역폭을 먼저 먹으면 LCP 가 밀린다 (페리지도 `none`). */
              preload={first ? 'metadata' : 'none'}
              aria-hidden="true"
            />
            <script dangerouslySetInnerHTML={{ __html: REDUCED_MOTION_GUARD }} />
          </>
        ) : (
          <Image
            src={`/api/media/${panel.mediaId}`}
            width={panel.width}
            height={panel.height}
            alt={panel.alt}
            sizes="100vw"
            priority={first}
            quality={82}
          />
        )}
      </div>
      <div className={styles.scrim} aria-hidden="true" />

      <div className={styles.inner}>
        <Reveal>
          <div className={styles.text}>
          {/* 첫 패널만 h1. 나머지는 h2 — 사진 다섯 장이 전부 h1 이면 문서에 제목이 다섯 개다. */}
          {first ? (
            <h1 className={styles.headline} lang="en">
              {panel.headline}
            </h1>
          ) : (
            <h2 className={styles.headline} lang="en">
              {panel.headline}
            </h2>
          )}

          {panel.body ? (
            <p className={styles.body} lang="ko">
              {panel.body}
            </p>
          ) : null}

          {panel.ctaLabel && panel.ctaHref ? (
            <Link href={panel.ctaHref} className={styles.cta} lang="ko">
              {panel.ctaLabel}
              <span className={styles.ctaArrow} aria-hidden="true">
                →
              </span>
            </Link>
          ) : null}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
