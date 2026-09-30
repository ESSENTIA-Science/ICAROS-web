import { Fragment } from 'react'

/**
 * 슬로건의 `**단어**` 를 강조로 렌더한다.
 * 마크다운이 아니라 레거시가 쓰던 자체 표기다 — 파서를 그대로 이어받는다.
 *
 * 강조 색은 --sig-ink 를 쓴다. --sig 는 밝은 배경에서 2.46:1 로 대비에 실패하므로
 * 텍스트에 쓰지 않는다 (토큰 규칙). --sig-ink 는 dark 섹션에서 --sig 로 자동 치환된다.
 */
export default function Highlight({ text }: { text: string | undefined }) {
  if (!text) return null
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\*\*([^*]+)\*\*$/.exec(part)
        return m ? (
          <em key={i} style={{ color: 'var(--sig-ink)', fontStyle: 'normal' }}>
            {m[1]}
          </em>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      })}
    </>
  )
}
