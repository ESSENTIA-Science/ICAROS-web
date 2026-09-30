import type { CSSProperties } from 'react'

/**
 * 순차 리빌의 순번을 CSS 로 넘긴다 (`transition-delay: calc(var(--i) * var(--stagger))`).
 *
 * `--i` 는 표준 CSSProperties 키가 아니라서 객체 리터럴이 그대로는 통과하지 않는다.
 * `as` 단언 대신 교차 타입으로 선언한다 — 단언은 오타를 잡아 주지 않는다.
 */
export type IndexedStyle = CSSProperties & { readonly '--i': number }

export const revealIndex = (i: number): IndexedStyle => ({ '--i': i })
