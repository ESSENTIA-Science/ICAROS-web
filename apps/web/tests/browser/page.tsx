import { useEffect, useState } from 'react'
import { hydrateRoot } from 'react-dom/client'
import HeaderNav from '../../src/components/ui/HeaderNav'
import VehicleGallery from '../../src/components/rocket/VehicleGallery'
import Panel from '../../src/components/panel/Panel'
import Donate from '../../src/components/landing/Donate'
import PostMarkdown from '../../src/components/posts/PostMarkdown'
import TabNav from '../../src/components/rocket/TabNav'
import footer from '../../src/components/ui/Footer.module.css'
import contact from '../../src/components/landing/Contact.module.css'
import mission from '../../src/components/landing/Mission.module.css'
import hero from '../../src/components/landing/Hero.module.css'
import post from '../../src/components/posts/PostCard.module.css'
import '../../src/app/tokens.css'
import type { LandingPanel } from '../../src/lib/panels'

const panel: LandingPanel = { id: 'video', mediaSrc: '/test-assets/video.mp4', posterSrc: '/assets/poster.svg', mime: 'video/mp4', width: 1920, height: 1080,
  alt: '', focalX: 50, focalY: 50, scrim: 'none', anchor: 'center', heightMode: 'half', headline: 'Fixture', body: null, ctaHref: '#support', ctaLabel: '후원' }
const images = [{ src: '/test-assets/missing.png', alt: 'A 실패', width: 512, height: 1024 }, { src: '/assets/portrait.svg', alt: 'B 정상', width: 512, height: 1024 }]

export function App() {
  const [support, setSupport] = useState(true)
  useEffect(() => { document.documentElement.dataset.testHydrated = 'true' }, [])
  return <>
    <HeaderNav items={[{ href: '/vehicles', label: 'Vehicles' }, { href: '/member', label: 'Member' }, { href: '/posts', label: 'Posts' }]} />
    <main data-palette="mono">
      <Panel panel={panel} first supportAvailable={support} />
      <button id="support-toggle" onClick={() => setSupport(value => !value)}>후원 섹션 전환</button>
      <TabNav items={[{ id: 'a', label: 'ROCKETS', href: '/vehicles' }, { id: 'b', label: 'UAVS', href: '/vehicles/uavs' }]} active="a" label="종류" level="secondary" />
      <div><span id="contact-label" className={contact.label}>CONTACT</span> <span id="mission-number" className={mission.no}>01</span> <a id="hero-scroll" className={hero.scroll} href="#after-gallery">SCROLL</a> <span id="post-meta" className={post.meta}>2026-10-13</span></div>
      <div id="vehicle-gallery"><VehicleGallery images={images} label="Fixture" /></div>
      <div id="portrait-gallery" style={{ width: '90%', margin: '80px auto' }}>
        <PostMarkdown content="" attachments={[{ kind: 'image', src: '/assets/portrait.svg', title: '세로 이미지', width: 512, height: 1024 }, { kind: 'image', src: '/assets/landscape.svg', title: '가로 이미지', width: 960, height: 540 }]} />
        <p id="after-gallery">이미지 아래 본문</p>
      </div>
      {support ? <Donate id="donate" label="Support" index={1} intro="후원 안내" usageTitle={undefined} usageItems={[]} quote={undefined} outro={undefined} current={0} goal={0} roundLabel={undefined} ctaLabel={undefined} ctaHref={undefined} /> : null}
    </main>
    <footer className={footer.footer} data-theme="dark"><p id="footer-copy" className={footer.copy}>Fixture copyright</p><a id="after-nav" href="#after-gallery">본문 링크</a></footer>
  </>
}
if (typeof document !== 'undefined') {
  const hydrate = () => hydrateRoot(document.getElementById('root')!, <App />)
  const delay = Number(new URLSearchParams(location.search).get('hydrateDelay'))
  if (delay > 0) setTimeout(hydrate, delay)
  else hydrate()
}
