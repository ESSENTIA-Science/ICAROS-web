import { Fragment } from 'react'
import styles from './Initials.module.css'

const ACRONYM = 'ICAROS'

/**
 * 태그라인에서 I·C·A·R·O·S 를 이루는 각 단어의 첫 글자만 강조한다.
 *
 * 레거시는 강조 위치를 JSX 에 손으로 박아 뒀다 — 그러면 CMS 에서 태그라인을 고칠 수 없다.
 * 여기서는 단어를 훑으며 다음에 와야 할 이니셜과 맞을 때만 소비하므로,
 * 사이에 낀 `&` 나 `of` 같은 단어는 저절로 건너뛴다.
 */
function markedTokens(text: string): { tokens: string[]; marked: ReadonlySet<number> } {
  // 공백을 캡처해 두어야 원본 간격이 그대로 보존된다
  const tokens = text.split(/(\s+)/)
  const marked = new Set<number>()
  let cursor = 0

  for (let i = 0; i < tokens.length && cursor < ACRONYM.length; i += 1) {
    const first = tokens[i]?.charAt(0) ?? ''
    if (first !== '' && first.toUpperCase() === ACRONYM.charAt(cursor)) {
      marked.add(i)
      cursor += 1
    }
  }
  return { tokens, marked }
}

export default function Initials({ text }: { text: string }) {
  const { tokens, marked } = markedTokens(text)

  return (
    <>
      {tokens.map((token, i) =>
        marked.has(i) ? (
          <Fragment key={i}>
            <b className={styles.mark}>{token.charAt(0)}</b>
            {token.slice(1)}
          </Fragment>
        ) : (
          <Fragment key={i}>{token}</Fragment>
        )
      )}
    </>
  )
}
