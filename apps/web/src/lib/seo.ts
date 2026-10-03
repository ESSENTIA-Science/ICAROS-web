import type { Metadata } from 'next'
import { getSeo } from '@/lib/content'
import { getSnapshot } from '@/lib/content/snapshot'

const origin = 'https://icaros.kr'

export function pageMetadata({ title, description, path, image, type = 'website' }: {
  title: string
  description: string
  path: string
  image?: string | null
  type?: 'website' | 'article'
}): Metadata {
  const seo = getSeo(getSnapshot().site)
  const fullTitle = `${title} · ${seo.title}`
  const imageUrl = new URL(image || seo.ogImage, origin).toString()
  const url = new URL(path, origin).toString()
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type, locale: 'ko_KR', siteName: seo.title, title: fullTitle, description, url, images: [{ url: imageUrl, alt: title }] },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [imageUrl] },
  }
}

export function excerptDescription(value: string, fallback: string): string {
  const clean = value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean ? clean.slice(0, 157) + (clean.length > 157 ? '…' : '') : fallback
}
