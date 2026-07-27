import './home.css'
import { useEffect, useMemo, useState } from 'react'
import { fetchSiteContent } from './lib/content'
import Highlight from './component/Highlight'

const whiteIconUrl = new URL('./assets/logo_white.svg', import.meta.url).href

// DB(site_content)가 로드되기 전/실패 시 폴백. 키는 migration seed 와 동일.
const DEFAULTS = {
  'about.slogan': 'We build what flies, from **UAVs** to rockets.',
  'about.body':
    'ICAROS는 무인기 설계와 비행 제어를 중심으로 항공우주 기술을 탐구하는 학생 연구 프로젝트입니다.\n우리는 비행기, 드론, 로켓 등을 직접 설계하고 제작하며, 실제 비행 데이터와 실험 결과를 바탕으로 더 나은 기체와 시스템을 만들어갑니다.\n현재는 고정익 및 회전익 무인기 개발을 핵심 활동으로 하며 기체 구조 설계, 비행 제어, 센서 데이터 분석, 시험 비행을 통해 실질적인 항공우주 프로젝트를 진행하고 있습니다.\n또한 로켓공학 분야에서는 추진 원리, 구조 설계, 비행 안정성, 회수 시스템 등을 이론 연구와 시뮬레이션, 안전한 범위의 실험을 통해 함께 탐구합니다.',
  'vision.slogan': 'We learn from **COSMOS**, not textbooks.',
  'vision.body':
    'ICAROS는 학생들이 직접 항공우주 시스템을 설계하고 검증하는 경험을 통해,\n미래 항공우주 기술을 이해하고 만들어갈 수 있는 기반을 쌓는 것을 목표로 합니다.\n우리는 단순히 기체를 제작하는 것에 그치지 않고,\n비행 원리, 제어 기술, 구조 설계, 추진 시스템을 종합적으로 탐구하며\n실제 문제를 해결하는 항공우주 프로젝트 팀으로 성장하고자 합니다.',
  'research.uav.title': 'Unmanned Aerial Vehicles',
  'research.uav.body':
    'ICAROS의 핵심 연구 분야는 무인기입니다.\n고정익 및 회전익 무인기를 직접 설계하고 제작하며, 시험 비행을 통해 기체 성능과 안정성을 개선합니다.',
  'research.control.title': 'Flight Control & Data',
  'research.control.body':
    '비행 제어 시스템, 자세 안정화, 센서 데이터 분석을 연구합니다.\n실제 비행 데이터를 바탕으로 기체의 문제점을 파악하고, 더 안정적이고 정밀한 비행을 목표로 개선을 진행합니다.',
  'research.rocketry.title': 'Rocketry & Propulsion',
  'research.rocketry.body':
    '로켓 공학과 추진 시스템은 고체연료 과학 로켓을 직접 개발하고 발사하며 이론 연구, 시뮬레이션, 구조 설계, 안전한 범위의 실험을 중심으로 탐구합니다.\n추진 원리, 비행 안정성, 회수 시스템 등을 연구하며 항공우주 기술에 대한 이해를 확장합니다.',
  'mission.body':
    'ICAROS는 고정익 무인기와 회전익 무인기를 중심으로 직접 설계, 제작, 시험 비행을 진행합니다.\n또한 로켓공학 분야에서는 추진 원리와 구조 설계, 비행 안정성, 회수 시스템 등을 현실적이고 안전한 범위 안에서 탐구합니다.\n우리는 실제 제작과 실험을 통해 항공우주 기술을 경험하고, 실패와 개선 과정을 반복하며 더 나은 시스템을 만들어가는 것을 목표로 합니다.',
  'mission.list':
    '고정익 및 회전익 무인기 설계, 제작, 비행 시험\n비행 제어 시스템과 자세 안정화 기술 연구\n항공 구조, 공력, 추진 시스템에 대한 실험 및 분석\n로켓공학 이론 연구, 시뮬레이션, 구조 설계 탐구\n실제 비행 데이터 기반의 기체 개선 및 프로젝트 확장',
  'donate.intro':
    'ICAROS는 학생들이 직접 항공우주 기술을 실험하고 발전시켜 나가는 프로젝트입니다.\n여러분의 후원은 새로운 기체를 제작하고, 더 안전하고 정밀한 실험 환경을 만드는 데 사용됩니다.',
  'donate.usage_title': '여러분의 후원금은 이렇게 사용됩니다.',
  'donate.usage_list':
    '무인기 제작 부품\n전자 장비 및 비행 제어 장치\n배터리, 센서, 통신 장비\n3D 프린팅 재료 및 구조 제작 비용\n시험 비행 및 안전 장비\n로켓공학 연구 자료와 시뮬레이션 환경 구축',
  'contact.body':
    'ICAROS는 무인기, 항공우주, 로켓공학에 관심 있는 사람들과 함께 성장하고 있습니다.\n프로젝트 참여, 협업, 후원 문의는 언제든지 연락해 주세요.',
  'donation.goal': '2700000',
  'donation.current': '900000',
}

function Home() {
  const [content, setContent] = useState(DEFAULTS)

  useEffect(() => {
    (async () => {
      const map = await fetchSiteContent()
      const overrides = Object.fromEntries(
        Object.entries(map).filter(([, v]) => v != null && v !== '')
      )
      setContent((prev) => ({ ...prev, ...overrides }))
    })()
  }, [])

  const c = content
  const numberFormatter = useMemo(() => new Intl.NumberFormat('ko-KR'), [])
  const goal = Number(c['donation.goal']) || 0
  const current = Number(c['donation.current']) || 0
  const donationPercent = goal ? Math.max(0, Math.min(100, (current / goal) * 100)) : 0
  const usageItems = (c['donate.usage_list'] || '').split('\n').filter(Boolean)

  return (
    <>
      {/* ================= HERO ================= */}
      <section id="hero">
        <img src={whiteIconUrl} alt="ICAROS Logo" className="hero-logo" />
        <p className="icaros_each">
          <span className="highlight">I</span>nnovation{' '}
          <span className="highlight">C</span>reative{' '}
          <span className="highlight">A</span>stronautics &{' '}
          <span className="highlight">R</span>ocketry{' '}
          <span className="highlight">O</span>rganization of{' '}
          <span className="highlight">S</span>tudents
        </p>
        <a href="#about" className="scroll-down" aria-label="Scroll down to About section">
          <span className="scroll-down__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M8 11l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </a>
      </section>

      {/* ================= ABOUT ================= */}
      <section id="about">
        <h1>About us</h1>
        <div className="container">
          <div className="about-content">
            <h2 className="desktop-slogan"><Highlight text={c['about.slogan']} /></h2>
            <h2 className="mobile-slogan"><Highlight text={c['about.slogan']} /></h2>
            <p className="kr-text" style={{ whiteSpace: 'pre-line' }}>{c['about.body']}</p>
          </div>
        </div>
      </section>

      {/* ================= VISION ================= */}
      <section id="vision">
        <h1>Vision</h1>
        <div className="container">
          <div className="vision-content">
            <h2 className="desktop-slogan" style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <Highlight text={c['vision.slogan']} />
            </h2>
            <h2 className="mobile-slogan" style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <Highlight text={c['vision.slogan']} />
            </h2>
            <p className="kr-text" style={{ whiteSpace: 'pre-line' }}>{c['vision.body']}</p>
          </div>
        </div>
      </section>

      {/* ================= RESEARCH AREAS ================= */}
      <section id="research">
        <h1>Research Areas</h1>
        <div className="container">
          <div className="vision-blocks">
            <div className="vision-item">
              <h2><span className="g-highlight">{c['research.uav.title']}</span></h2>
              <p className="kr-text" style={{ whiteSpace: 'pre-line' }}>{c['research.uav.body']}</p>
            </div>
            <div className="vision-item">
              <h2><span className="g-highlight">{c['research.control.title']}</span></h2>
              <p className="kr-text" style={{ whiteSpace: 'pre-line' }}>{c['research.control.body']}</p>
            </div>
            <div className="vision-item">
              <h2><span className="g-highlight">{c['research.rocketry.title']}</span></h2>
              <p className="kr-text" style={{ whiteSpace: 'pre-line' }}>{c['research.rocketry.body']}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= MISSION ================= */}
      <section id="mission">
        <h1>Mission</h1>
        <div className="container">
          <div className="mission-content">
            <p className="kr-text" style={{ whiteSpace: 'pre-line' }}>
              {c['mission.body']}
              {'\n\n'}주요 활동은 다음과 같습니다.
            </p>
            <p className="kr-text" style={{ lineHeight: 2.5 }}>
              <span className="highlight" style={{ whiteSpace: 'pre-line' }}>{c['mission.list']}</span>
            </p>
          </div>
        </div>
      </section>

      {/* ================= DONATE ================= */}
      <section id="donate">
        <h1>Donate</h1>
        <div className="donate-container">
          <div className="donate-text">
            <p className="kr-text" style={{ whiteSpace: 'pre-line' }}>{c['donate.intro']}</p>
            <h2 className="donate-usage-title">{c['donate.usage_title']}</h2>
            <ul className="donate-usage-list kr-text">
              {usageItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="donate-bar">
            <h3>“Every donation brings the next flight closer.”</h3>
            <div className="donation-container">
              <div className="donation-amount" id="current-amount">
                {numberFormatter.format(current)}
              </div>
              <span className="goal" id="goal-amount">
                / {numberFormatter.format(goal)}
              </span>
              <div className="progress-bar">
                <div className="progress" id="progress" style={{ width: `${donationPercent}%` }} />
              </div>
              <div className="percent-text" id="percent-text">
                {Math.round(donationPercent)}%
              </div>
              <a href="#contact" className="donate-btn" onClick={() => { alert("후원 페이지 준비 중 입니다"); }}>후원 문의하기</a>
            </div>
            <p className="kr-text">
              작은 지원이 새로운 기체의 이륙과 더 깊은 항공우주 탐구로 이어집니다.
            </p>
          </div>
        </div>
      </section>

      <section className='contact' id="contact">
        <h1>Contact</h1>
        <div className="contact-content">
          <p className="kr-text" style={{ whiteSpace: 'pre-line' }}>{c['contact.body']}</p>
          <div className="contact-grid">
            <a className="contact-card" href="mailto:air091226@naver.com">
              <span className="contact-label">Email</span>
              <span className="contact-value">air091226@naver.com</span>
            </a>
            <a
              className="contact-card"
              href="https://www.instagram.com/icaros_aerospace/"
              target="_blank"
              rel="noreferrer"
            >
              <span className="contact-label">Instagram</span>
              <span className="contact-value">@icaros_aerospace</span>
            </a>
          </div>
        </div>
      </section>
    </>
  )
}

export default Home
