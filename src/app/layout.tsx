import type { Metadata, Viewport } from 'next'
import { body, display, mono } from '@/lib/fonts'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://icaros.kr'),
  title: { default: 'ICAROS', template: '%s · ICAROS' },
  description:
    'ICAROS는 학생 주도 항공우주·로켓 연구팀으로 무인기 설계, 비행 제어, 고체연료 로켓 개발과 발사를 수행합니다.',
  openGraph: {
    type: 'website',
    url: 'https://icaros.kr',
    siteName: 'ICAROS',
    title: 'ICAROS',
    description: '학생 주도 항공우주 로켓 연구 프로젝트',
    images: ['/og.png'],
  },
  icons: { icon: '/favicon.png' },
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
