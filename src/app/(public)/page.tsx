/**
 * Landing — P5 에서 site_settings(DB) 기반으로 채운다.
 * 현행 home.jsx 의 DEFAULTS 하드코딩 폴백은 이전하지 않는다 (요구사항 B10):
 * 이미 라이브 DB 와 어긋나 있었고, 두 벌의 카피를 유지하는 구조 자체가 결함이었다.
 */
export default function HomePage() {
  return (
    <>
      <section id="hero" data-theme="dark" style={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
        <div className="container" style={{ textAlign: 'center' }}>
          <p className="eyebrow" lang="en">Intelligent Creative Astronautics &amp; Rocketry Organization of Students</p>
          <h1 style={{ marginTop: 'var(--sp-5)' }}>ICAROS</h1>
        </div>
      </section>

      <section id="about" style={{ paddingBlock: 'var(--section-pad-xl)' }}>
        <div className="container">
          <p className="eyebrow" lang="en">About us</p>
          <p className="measure" style={{ marginTop: 'var(--sp-5)', color: 'var(--fg-muted)' }}>
            P5 에서 CMS 연동. 현재는 스캐폴드 상태입니다.
          </p>
        </div>
      </section>
    </>
  )
}
