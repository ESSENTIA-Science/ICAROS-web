import type { Metadata, Viewport } from 'next'
import { Archivo, IBM_Plex_Mono } from 'next/font/google'
import { getSeo } from '@/lib/content'
import { getSnapshot } from '@/lib/content/snapshot'
import Loader from '@/components/landing/Loader'
import './globals.css'

const display = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-display', display: 'swap' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-mono', display: 'swap' })
export function generateMetadata(): Metadata {
  const seo = getSeo(getSnapshot().site)
  return {
    metadataBase: new URL('https://icaros.kr'),
    title: { default: seo.title, template: `%s · ${seo.title}` },
    description: seo.description,
    openGraph: { type: 'website', url: 'https://icaros.kr', siteName: seo.title, title: seo.title, description: seo.description, images: [seo.ogImage] },
    icons: { icon: '/favicon.png' },
  }
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko" className={`${display.variable} ${mono.variable}`}><body><Loader />{children}</body></html>
}
