import { useCallback, useState } from 'react'
import { Routes, Route, Link, useNavigate, Outlet } from 'react-router-dom'
const logoTextWhiteUrl = new URL('./assets/logo_text_white.svg', import.meta.url).href

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const navigate = useNavigate();
  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
  }, [])
  return (
    <header className="navbar" id="navbar">
      <div className="nav-content">
        <a href="#hero" className="nav-brand" onClick={() => { navigate("/"); closeMenu(); }}>
          <img src={logoTextWhiteUrl} alt="ICAROS logo" className="logo" />
        </a>


        <a
          className="nav-simulate nav-simulate-mobile"
          href="https://sim.icaros.kr/"
        >
          Simulate
        </a>
        <button
          type="button"
          className="nav-toggle"
          aria-label={isMenuOpen ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={isMenuOpen}
          aria-controls="nav-menu"
          onClick={() => setIsMenuOpen((prev) => !prev)}
        >
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </button>

        <ul id="nav-menu" className={`nav-menu${isMenuOpen ? ' open' : ''}`}>
          <li><a href="#about" onClick={() => { navigate("/"); closeMenu(); }}>About Us</a></li>
          <li><a onClick={() => { navigate("/rocket"); closeMenu(); }}>Rockets</a></li>
          <li><a onClick={() => { navigate("/posts"); closeMenu(); }}>Posts</a></li>
          <li><a onClick={() => { navigate("/member"); closeMenu(); }}>Members</a></li>
          <li><a href="https://sim.icaros.kr/" className="nav-simulate">Simulate</a></li>
        </ul>
      </div>
    </header>
  )
}


const Footer = () => {
  return(
    <>
      <footer>
        <p>© 2026 ICAROS. All Rights Reserved.</p>
      </footer>
    </>
  )
}

export { Header, Footer }
