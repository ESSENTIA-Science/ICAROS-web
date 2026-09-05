import type { Metadata, Viewport } from 'next'
import { display, mono } from '@/lib/fonts'
import { getSeo, getSiteContentSafe } from '@/lib/content'
import Loader from '@/components/landing/Loader'
import QueryProvider from '@/components/providers/QueryProvider'
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
    /**
     * 정식 도메인은 **`www`** 다. apex(`icaros.kr`)는 프로덕션에서 307 로 www 에 넘긴다
     * (2026-09-06 실측 0.25s). `metadataBase` 가 apex 를 가리키면 이 값으로 조립되는
     * **모든 canonical 과 상대 OG 이미지 URL 이 리다이렉트되는 주소**가 되어, 크롤러가
     * 페이지마다 한 번씩 더 튕긴다.
     *
     * 반대 선택지도 유효하다 — Vercel 대시보드에서 apex 를 primary 로 돌리면 코드가 옳아진다.
     * **둘 중 하나만 고르면 되고, 고르지 않는 것이 가장 나쁘다.** 지금은 관측된 사실(www 가
     * 서비스 주소다)에 코드를 맞춘다.
     */
    metadataBase: new URL('https://www.icaros.kr'),
    title: { default: seo.title, template: `%s · ${seo.title}` },
    description: seo.description,
    openGraph: {
      type: 'website',
      url: 'https://www.icaros.kr',
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
    <html lang="ko" className={`${display.variable} ${mono.variable}`}>
      <body>
        {/*
          루트에 두는 이유: 여기서만 "문서당 한 번"이 보장된다. 페이지나 (public) 레이아웃에
          두면 클라이언트 내비게이션마다 다시 마운트돼 커버가 재생된다.
          커버는 pointer-events: none 이고 CSS 백스톱으로 스크립트 없이도 걷힌다.
        */}
        <Loader />
        {/*
          TanStack Query 프로바이더는 루트에 한 번만 둔다. `children` 은 prop 으로 전달된
          이미 렌더된 엘리먼트라 **서버 컴포넌트로 남는다** — 클라이언트 경계가 아래로 번지지 않는다.
        */}
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
