'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import wordmark from '@/assets/logo_text_white.svg'
import styles from './Header.module.css'

/**
 * 메뉴 4개. 구 사이트의 5번째 항목(외부 시뮬레이터 링크)은 공개 웹에서 전면 제거됐다.
 * 요구사항 §7 · docs/icaros-rebuild/02-requirements-matrix.md A2·A4 참조.
 * 외부 프로젝트와 도메인 자체는 유지된다 — 여기서 링크만 뺀 것이다.
 * 라벨은 Gate 5 에서 CMS(site_settings)로 옮긴다.
 */
const NAV = [
  { href: '/#about', label: 'About Us' },
  { href: '/rocket', label: 'Rockets' },
  { href: '/posts', label: 'Posts' },
  { href: '/member', label: 'Members' },
] as const

export default function Header() {
  const pathname = usePathname()
  // 메뉴는 "열었던 그 경로"에서만 열려 있다. 라우트가 바뀌면 파생적으로 닫히므로
  // 이펙트에서 setState 를 호출할 필요가 없다 (react-hooks/set-state-in-effect).
  // 뒤로가기/앞으로가기에도 그대로 동작한다.
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const open = openedAt === pathname

  const panelRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpenedAt(null), [])

  // 열려 있는 동안: Esc 로 닫기, 배경 스크롤 잠금, 포커스를 패널 안에 가둔다
  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenedAt(null)
        toggleRef.current?.focus()
        return
      }
      if (e.key !== 'Tab') return

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])'
      )
      if (!focusables?.length) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <header className={styles.nav} data-theme="dark">
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} onClick={close} aria-label="ICAROS 홈">
          <Image src={wordmark} alt="ICAROS" className={styles.wordmark} priority />
        </Link>

        <button
          ref={toggleRef}
          type="button"
          className={styles.toggle}
          aria-label={open ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={open}
          aria-controls="nav-menu"
          onClick={() => setOpenedAt((v) => (v === pathname ? null : pathname))}
        >
          <span className={styles.bar} aria-hidden="true" />
          <span className={styles.bar} aria-hidden="true" />
          <span className={styles.bar} aria-hidden="true" />
        </button>

        <div
          ref={panelRef}
          id="nav-menu"
          className={`${styles.menu} ${open ? styles.menuOpen : ''}`}
        >
          <ul className={styles.list}>
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={styles.link} onClick={close}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </header>
  )
}
