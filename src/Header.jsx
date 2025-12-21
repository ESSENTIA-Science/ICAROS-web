import { useCallback, useState } from 'react'
import { Routes, Route, Link, useNavigate, Outlet } from 'react-router-dom'
const logoTextWhiteUrl = new URL('./assets/logo_text_white.png', import.meta.url).href

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
          onClick={() => { alert("준비 중 입니다");}}
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
          <li><a onClick={() => { navigate("/gallery"); closeMenu(); }}>Gallery</a></li>
          <li><a onClick={() => { navigate("/member"); closeMenu(); }}>Members</a></li>
          <li><a className="nav-simulate" onClick={() => {alert("준비 중 입니다");}}>Simulate</a></li>
        </ul>
      </div>
    </header>
  )
}

const Footer = () => {
  return(
    <>
      <footer>
        <p>© 2025 ICAROS | All Rights Reserved</p>
        <p>
          Made by{' '}
          <a href="https://aidengoldkr.netlify.app/" target="_blank" rel="noreferrer">
            @aidengoldkr
          </a>
        </p>
      </footer>
    </>
  )
}

export { Header, Footer }
