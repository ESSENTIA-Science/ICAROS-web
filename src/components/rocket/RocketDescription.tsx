import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './RocketDescription.module.css'

/**
 * 서버에서 렌더한다 — react-markdown 번들이 클라이언트로 넘어가지 않는다.
 * 코드 하이라이트는 붙이지 않았다: 로켓 설명에 코드 블록이 들어올 이유가 없고,
 * highlight.js 를 끌어오면 이 페이지 하나 때문에 서버 번들이 커진다.
 *
 * TODO(통합): Posts 쪽 공용 마크다운 렌더러가 생기면 prose 스타일을 그쪽으로 합친다.
 */
export default function RocketDescription({ markdown }: { markdown: string }) {
  return (
    <div className={`${styles.prose} measure`}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml>
        {markdown}
      </Markdown>
    </div>
  )
}
