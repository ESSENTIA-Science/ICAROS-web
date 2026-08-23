'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import wordmark from '@/assets/logo_text_white.svg'
import styles from './Loader.module.css'

/**
 * 페이지 로드 커버 (03 §9).
 *
 * 레퍼런스의 형태를 그대로 옮긴다 — 스피너도 퍼센트도 로고 애니메이션도 없다.
 *  - 전면 커버 하나
 *  - **워드마크를 나중에 nav 로고가 앉을 자리에 미리 놓는다.** 커버가 걷힐 때 로고가 움직이지 않는다.
 *    좌표를 손으로 맞추지 않고 nav 와 같은 컨테이너 기하(`--container` · `--page-pad` · `--nav-h`)를
 *    다시 계산해서 얻는다 — 값을 두 벌 적으면 반드시 어긋난다.
 *  - 워드마크 다음부터 오른쪽 여백까지 1px 헤어라인이 시그널 컬러로 `scaleX(0→1)`.
 *
 * **로드 게이트를 만들지 않는다** (03 §Anti-patterns 6). 문서 로드가 끝나는 즉시 걷는다.
 * JS 가 없거나 하이드레이션이 실패해도 CSS 애니메이션이 백스톱으로 커버를 걷어낸다 —
 * 그래서 걷는 동작이 스크립트에 의존하지 않는다.
 *
 * 루트 레이아웃에 한 번 마운트되므로 클라이언트 내비게이션에서 다시 재생되지 않는다.
 */
export default function Loader() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const done = () => el.setAttribute('data-done', '')
    if (document.readyState === 'complete') {
      done()
      return
    }
    window.addEventListener('load', done, { once: true })
    return () => window.removeEventListener('load', done)
  }, [])

  return (
    <div ref={ref} className={styles.loader} data-section-theme="ink" aria-hidden="true">
      <div className={styles.row}>
        <Image src={wordmark} alt="" className={styles.wordmark} priority />
        <span className={styles.line}>
          <span className={styles.fill} />
        </span>
      </div>
    </div>
  )
}
