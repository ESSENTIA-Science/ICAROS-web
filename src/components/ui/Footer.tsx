import styles from './Footer.module.css'

/** 저작권 문구는 Gate 5 에서 CMS(site_settings)로 옮긴다. */
export default function Footer() {
  return (
    <footer className={styles.footer} data-theme="dark">
      <div className="container">
        <p className={styles.copy}>© 2026 ICAROS. All Rights Reserved.</p>
      </div>
    </footer>
  )
}
