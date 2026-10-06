import { Fragment } from 'react'
import { revealIndex } from './reveal-style'
import styles from './Words.module.css'

/**
 * 슬로건을 단어 단위로 쪼개 순차 리빌 대상으로 만든다. `**단어**` 강조 표기도 같이 처리한다.
 *
 * `ui/Highlight` 와 분리한 이유: 강조 파싱만으로는 단어 경계를 알 수 없어 `--i` 를 붙일 수 없다.
 * 레퍼런스의 `highlight-text` 섹션(03 §3 · Part2 "Highlight / two-layer reveal")이 하는 일이
 * 정확히 이것이고, Vast 도 라이브러리 없이 `data-split-text="words"` 로 처리한다.
 *
 * 시작 불투명도가 0 이 아니라 0.28 이고 이동이 없는 것은 의도다 (globals.css `[data-word]`).
 * 읽으려는 글자 위에서 무엇도 움직이지 않아야 하고, 관찰이 실패해도 문장은 읽혀야 한다.
 */
type Chunk = { readonly text: string; readonly mark: boolean }

function toChunks(text: string): readonly Chunk[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((part) => part !== '')
    .map((part) => {
      const m = /^\*\*([^*]+)\*\*$/.exec(part)
      return m ? { text: m[1] ?? part, mark: true } : { text: part, mark: false }
    })
}

export default function Words({ text }: { text: string }) {
  const nodes: React.ReactNode[] = []
  let order = 0

  toChunks(text).forEach((chunk, ci) => {
    // 공백을 캡처해 두어야 원본 간격이 그대로 보존된다
    chunk.text.split(/(\s+)/).forEach((token, ti) => {
      if (token === '') return
      const key = `${ci}-${ti}`
      if (/^\s+$/.test(token)) {
        nodes.push(<Fragment key={key}>{token}</Fragment>)
        return
      }
      const style = revealIndex(order)
      order += 1
      nodes.push(
        <span
          key={key}
          data-word=""
          style={style}
          className={chunk.mark ? styles.mark : undefined}
        >
          {token}
        </span>
      )
    })
  })

  return <>{nodes}</>
}
