import type { Metadata, Viewport } from 'next'
import { body, display, mono } from '@/lib/fonts'
import { getSeo, getSiteContentSafe } from '@/lib/content'
import './globals.css'

/**
 * 사이트 제목·설명·OG 이미지를 CMS 에서 읽는다 (F10).
 *
 * `getSiteContentSafe` 를 쓰는 이유: 이 레이아웃은 `/admin` 로그인까지 포함한 **전 라우트**를
 * 감싼다. 여기서 던지면 DB 장애가 곧 전면 500 이 되어 고치러 들어갈 문까지 닫힌다.
 * 조회가 실패하면 `SEO_FALLBACK` 으로 기존 동작을 그대로 유지한다.
 *
 * `openGraph.description` 은 CMS 키를 두지 않았다 — 지금도 페이지 설명과 다른 별도 문구이고,
 * 키를 새로 만들면 문구가 바뀌기 때문이다. 필요해지면 `og.description` 을 같은 방식으로 추가한다.
 */
export async function generateMetadata(): Promise<Metadata> {
  const seo = getSeo(await getSiteContentSafe())

  return {
    metadataBase: new URL('https://icaros.kr'),
    title: { default: seo.title, template: `%s · ${seo.title}` },
    description: seo.description,
    openGraph: {
      type: 'website',
      url: 'https://icaros.kr',
      siteName: seo.title,
      title: seo.title,
      description: '학생 주도 항공우주 로켓 연구 프로젝트',
      images: [seo.ogImage],
    },
    icons: { icon: '/favicon.png' },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${body.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
