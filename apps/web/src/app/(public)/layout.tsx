import Header from '@/components/ui/Header'
import Footer from '@/components/ui/Footer'
import styles from './layout.module.css'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">본문으로 건너뛰기</a>
      <Header />
      <main id="main" className={styles.main}>{children}</main>
      <Footer />
    </div>
  )
}
