/**
 * JS 가 없으면 리빌은 영원히 켜지지 않는다 — 초기 상태(opacity 0)에 본문이 갇힌다.
 * globals.css 의 리빌은 전부 데이터 속성으로 표현돼 있으므로 여기서 그 속성을 지목해 푼다.
 *
 * 라우트마다 한 번씩 렌더한다. 서버 컴포넌트라 클라이언트 번들에 아무것도 싣지 않는다.
 */
export default function RevealNoScript() {
  return (
    <noscript>
      <style
        dangerouslySetInnerHTML={{
          __html:
            '[data-reveal="block"],[data-reveal-item]{opacity:1!important;transform:none!important}',
        }}
      />
    </noscript>
  )
}
