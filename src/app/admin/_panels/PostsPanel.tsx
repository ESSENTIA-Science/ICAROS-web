import Notice from '@/components/admin/Notice'
import ui from '@/components/admin/ui.module.css'

/**
 * Posts 탭 — **의도적으로 CRUD 가 없다.**
 *
 * 게시글의 단일 원본은 ESSENTIA Community 의 ICAROS 게시판이다 (DECISIONS D1).
 * 여기에 작성 화면을 붙이면 쓰기 경로가 둘이 되어 어느 쪽이 진짜인지 알 수 없게 된다.
 * 공개 `/posts` 는 그 게시판을 그대로 읽어 보여준다 — 복제하지 않으므로 갈라질 수도 없다.
 */
export default function PostsPanel() {
  return (
    <>
      <div className={ui.panelHead}>
        <div>
          <h2 className={ui.panelTitle} lang="en">
            Posts
          </h2>
          <p className={ui.panelLede}>
            게시글은 ESSENTIA 커뮤니티에서만 작성합니다.
          </p>
        </div>
      </div>

      <Notice tone="info" title="여기서는 글을 쓰지 않습니다">
        ICAROS 게시판은 ESSENTIA 커뮤니티에 있고, 그것이 유일한 원본입니다. 이 사이트의{' '}
        <code>/posts</code> 는 그 게시판을 그대로 읽어 보여줍니다 — 따로 저장하지 않으므로 양쪽
        내용이 어긋날 일이 없습니다.
        {' '}
        <a
          className={ui.link}
          href="https://www.essentia-sci.org/community"
          target="_blank"
          rel="noreferrer"
        >
          ESSENTIA 커뮤니티에서 작성하기
        </a>
      </Notice>
    </>
  )
}
