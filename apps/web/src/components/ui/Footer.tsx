import { getSiteContentSafe } from '@/lib/content'
import styles from './Footer.module.css'

/** Footer copy comes from the pinned publication snapshot. */
export default async function Footer() {
  const c = await getSiteContentSafe()
  return (
    <footer className={styles.footer} data-theme="dark">
      <div className="container">
        <p className={styles.copy}>{c['footer.copyright']}</p>
      </div>
    </footer>
  )
}
