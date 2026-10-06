import Header from '@/components/ui/Header'
import Footer from '@/components/ui/Footer'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="skip-link">본문으로 건너뛰기</a>
      <Header />
      <main id="main">{children}</main>
      <Footer />
    </>
  )
}
