import { getSiteContent } from '@/lib/content'
import styles from './Footer.module.css'

export default async function Footer() {
  const c = await getSiteContent()
  return (
    <footer className={styles.footer} data-theme="dark">
      <div className="container">
        <p className={styles.copy}>{c['footer.copyright']}</p>
      </div>
    </footer>
  )
}
