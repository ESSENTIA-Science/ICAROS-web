/**
 * 타깃 박스의 뷰포트 좌표를 추적한다.
 *
 * 고정 레이어(`position: fixed`)와 문서 흐름 안의 타깃 박스는 좌표계가 다르다. 둘을 잇는 것은
 * `getBoundingClientRect()` 하나뿐이고, 그 값은 **스크롤·리사이즈·레이아웃 변경** 세 가지로 바뀐다.
 * 세 경로를 전부 듣되 콜백은 rAF 한 번으로 합친다 — 스크롤 이벤트는 프레임당 여러 번 올 수 있다.
 *
 * React state 를 쓰지 않는 이유: 스크롤마다 리렌더가 나면 히어로 아래 섹션까지 전부 다시 그린다.
 * 소비자는 DOM 에 직접 쓰거나(포스터) 자기 렌더 루프에서 읽는다(캔버스).
 */
export interface StageRect {
  left: number
  top: number
  width: number
  height: number
}

export function trackRect(el: HTMLElement, onChange: (rect: StageRect) => void): () => void {
  let frame = 0
  let last: StageRect | null = null

  const read = (): void => {
    frame = 0
    const r = el.getBoundingClientRect()
    // 소수점 잡음으로 매 프레임 style 을 쓰지 않도록 0.5px 미만 변화는 무시한다
    if (
      last !== null &&
      Math.abs(last.left - r.left) < 0.5 &&
      Math.abs(last.top - r.top) < 0.5 &&
      Math.abs(last.width - r.width) < 0.5 &&
      Math.abs(last.height - r.height) < 0.5
    ) {
      return
    }
    last = { left: r.left, top: r.top, width: r.width, height: r.height }
    onChange(last)
  }

  const schedule = (): void => {
    if (frame !== 0) return
    frame = requestAnimationFrame(read)
  }

  read()

  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  const ro = new ResizeObserver(schedule)
  ro.observe(el)

  return () => {
    if (frame !== 0) cancelAnimationFrame(frame)
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    ro.disconnect()
  }
}
