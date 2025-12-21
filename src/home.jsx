import './home.css'
import { useMemo, useState } from 'react'

const whiteIconUrl = new URL('./assets/white_icon.png', import.meta.url).href

const DONATION_GOAL_AMOUNT = 1800000
const DONATION_CURRENT_AMOUNT = 200000

function Home() {
  const [currentDonationAmount] = useState(DONATION_CURRENT_AMOUNT)
  const numberFormatter = useMemo(() => new Intl.NumberFormat('ko-KR'), [])
  const donationPercent = useMemo(() => {
    if (!DONATION_GOAL_AMOUNT) return 0
    const percent = (currentDonationAmount / DONATION_GOAL_AMOUNT) * 100
    return Math.max(0, Math.min(100, percent))
  }, [currentDonationAmount])

  return (
    <>
      {/* ================= HERO ================= */}
      <section id="hero">
        <img
          src={whiteIconUrl}
          alt="ICAROS Logo"
          className="hero-logo"
        />

        <p className="icaros_each">
          <span className="highlight">I</span>ntelligent{' '}
          <span className="highlight">C</span>reative{' '}
          <span className="highlight">A</span>stronautics &{' '}
          <span className="highlight">R</span>ocketry{' '}
          <span className="highlight">O</span>rganization of{' '}
          <span className="highlight">S</span>tudents
        </p>

        <a
          href="#about"
          className="scroll-down"
          aria-label="Scroll down to About section"
        >
          <span className="scroll-down__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 5v10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M8 11l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </a>
      </section>

      {/* ================= ABOUT ================= */}
      <section id="about">
        <h1>About us</h1>
        <div className="container">
          <div className="about-content">
            <h2 className="desktop-slogan">
              We learn from <span className="g-highlight">COSMOS</span>, not textbooks
            </h2>
            <h2 className="mobile-slogan">
              We learn from<br />
              <span className="g-highlight">COSMOS</span> not textbooks
            </h2>
            <p className="kr-text">
              실제 개발과 연구, 발사를 통해 발사체 기술을 이해하고 탐구하고자 합니다.<br />
              철저히 학생 주도로 진행되며 팀원들끼리 서로 배우고 협력하는 학생 중심 연구 조직입니다.<br />
              이 프로젝트는 창의적이고 혁신적인 사고를 추구하며, <br />
              항공우주 기술 개발을 위해 연구하고자 합니다.
            </p>
          </div>
        </div>
      </section>

      {/* ================= VISION ================= */}
      <section id="vision">
        <h1>Vision</h1>
        <div className="container">
          <div className="vision-content">
            <p className="kr-text">
              ICAROS는 공학적 탐구를 기반으로 항공우주 기술을 개발하여,<br />
              핵심 기술을 이해하고 현실에 적용하고자 합니다.<br />
              우리는 다음 세 가지 핵심 가치를 기반으로 합니다.
            </p>

            <div className="vision-blocks">
              <div className="vision-item">
                <h2><span className="g-highlight">I</span> - Icaros</h2>
                <p className="kr-text">
                  우리의 도전정신과 기술적 탐구심을 상징합니다.<br />
                  ICAROS의 전설처럼 한계에 도전하며,<br />
                  체계적 연구를 바탕으로 진보합니다.
                </p>
              </div>

              <div className="vision-item">
                <h2><span className="g-highlight">C</span> - Cosmos</h2>
                <p className="kr-text">
                  우주는 탐구의 장입니다.<br />
                  우리는 우주로 나아가며,<br />
                  지식과 영감을 얻고자 합니다.
                </p>
              </div>

              <div className="vision-item">
                <h2><span className="g-highlight">X</span> - eXplorer</h2>
                <p className="kr-text">
                  기술을 개발하고 활용하려는 우리의 탐구정신입니다.<br />
                  ICAROS의 모든 연구는 탐구와 탐험입니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= MISSION ================= */}
      <section id="mission">
        <h1>Mission</h1>
        <div className="container">
          <div className="mission-content">
            <p className="kr-text">
              ICAROS는 고체추진 로켓을 제작하며 기술 개발과 발사 적용을 목표로 합니다.<br />
              모델로켓, 캔위성 등 심도 있는 실험과 시스템 개발을 집중적으로 수행합니다.
            </p>

            <p
              className="kr-text"
              style={{ lineHeight: 2.5 }}
            >
              <span className="highlight">
                모델로켓, 캔위성 등 실제 우주탐사 시스템 개발 및 검증<br />
                물리·전자·프로그래밍 설계에 통합된 학문 간 융합 수업<br />
                로켓 발사 및 자체 제어, 위성 정보 수집 등 미션 수행
              </span>
              <br />
              <span className="g-highlight">
                국내 최초 고체연료 기반 모델로켓 착륙 개발
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* ================= DONATE ================= */}
      <section id="donate">
        <h1>Donate</h1>
        <div className="donate-container">
          <div className="donate-text">
            <p className="kr-text">
              ICAROS는 학생이 주도하여 모델 로켓과 캔위성 및 로켓 제어와<br />
              착륙 시스템 등 항공우주 시스템을 연구·개발하는 단체입니다.<br />
              하지만 이러한 연구에는 많은 비용이 요구됩니다.
            </p>

            <h2 className="donate-usage-title">
              여러분의 후원금은 이렇게 사용됩니다
            </h2>

            <ul className="donate-usage-list kr-text">
              <li>자재비 : 1,500,000 ₩</li>
              <li>시험장 대여비 : 150,000 ₩</li>
              <li>이동비 및 잡화비 : 100,000 ₩</li>
              <li>Web 개발비 : 50,000 ₩</li>
            </ul>
          </div>

          <div className="donate-bar">
            <h3>“Every donation fuels innovation.”</h3>

            <div className="donation-container">
              <div className="donation-amount" id="current-amount">
                {numberFormatter.format(currentDonationAmount)}
              </div>
              <span className="goal" id="goal-amount">
                / {numberFormatter.format(DONATION_GOAL_AMOUNT)}
              </span>
              <div className="progress-bar">
                <div className="progress" id="progress" style={{ width: `${donationPercent}%` }} />
              </div>
              <div className="percent-text" id="percent-text">
                {Math.round(donationPercent)}%
              </div>
              <a href="#contact" className="donate-btn" onClick={() => { alert("후원 페이지 준비 중 입니다");}}>후원 문의하기</a>

            </div>

            <p className="kr-text">
              여러분의 후원은 학생들이 주도하는 항공우주 연구를 한 단계 더 발전시킵니다.<br />
              모든 후원금은 투명하게 관리되며 연구·교육 목적 외에는 사용되지 않습니다.
            </p>
          </div>
        </div>
      </section>

      <section className='contact' id="contact">
        <h1>Contact</h1>
        <div className="contact-content">
          <p className="kr-text">
            언제든 연락 주세요. 이메일과 인스타그램 DM 모두 열려 있습니다.
          </p>
          <div className="contact-grid">
            <a className="contact-card" href="mailto:air091226@naver.com">
              <span className="contact-label">Email</span>
              <span className="contact-value">air091226@naver.com</span>
            </a>
            <a
              className="contact-card"
              href="https://www.instagram.com/icaros_icx"
              target="_blank"
              rel="noreferrer"
            >
              <span className="contact-label">Instagram</span>
              <span className="contact-value">@icaros_icx</span>
            </a>
          </div>
        </div>
      </section>

    </>
  )
}

export default Home
