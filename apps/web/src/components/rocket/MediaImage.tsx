'use client'

import Image from 'next/image'
import { useState } from 'react'

export default function MediaImage({ src, alt, width, height, className, sizes, preload = false }: {
  src: string; alt: string; width?: number; height?: number; className?: string; sizes: string; preload?: boolean
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) return <span role="img" aria-label={`${alt} — 이미지를 불러올 수 없습니다`} className={className} style={{ display: 'grid', placeItems: 'center', minHeight: '10rem', background: 'var(--bg-sunken)', color: 'var(--fg-muted)' }}>이미지를 불러올 수 없습니다</span>
  if (width && height) return <Image src={src} alt={alt} width={width} height={height} sizes={sizes} className={className} preload={preload} onError={() => setFailedSrc(src)} />
  return <Image src={src} alt={alt} fill sizes={sizes} className={className} preload={preload} onError={() => setFailedSrc(src)} />
}
