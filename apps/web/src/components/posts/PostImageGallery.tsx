'use client'
/* eslint-disable @next/next/no-img-element -- 정적 스냅샷은 이미지 URL만 제공한다. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import styles from './PostImageGallery.module.css'

export type GalleryImage = { src: string; alt: string; caption?: string; width?: number; height?: number }

function captionFor(value: string): string | null {
  const title = value.trim()
  return title && !/^(?:IMG[_-]?\d+|DSC[_-]?\d+|PXL[_-]?\d+)(?:\.[a-z0-9]+)?$/i.test(title) &&
    !/^[^/\\]+\.(?:avif|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(title) ? title : null
}

function initialRatio(image: GalleryImage): number {
  return image.width && image.height ? image.width / image.height : 4 / 3
}

export default function PostImageGallery({ images, columns = 2, align = 'center' }: { images: GalleryImage[]; columns?: 1 | 2 | 3; align?: 'left' | 'center' | 'right' }) {
  const galleryRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [gap, setGap] = useState(0)
  const [ratios, setRatios] = useState<Record<number, number>>({})

  useEffect(() => {
    const gallery = galleryRef.current
    if (!gallery) return
    const measure = () => {
      setWidth(gallery.clientWidth)
      setGap(Number.parseFloat(getComputedStyle(gallery).columnGap) || 0)
      const loaded = [...gallery.querySelectorAll('img')].reduce<Record<number, number>>((next, image, index) => {
        if (image.naturalWidth && image.naturalHeight) next[index] = image.naturalWidth / image.naturalHeight
        return next
      }, {})
      if (Object.keys(loaded).length) setRatios(previous => ({ ...previous, ...loaded }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(gallery)
    return () => observer.disconnect()
  }, [])

  const rowColumns = width && width < 700 ? 1 : columns
  const rows = Array.from({ length: Math.ceil(images.length / rowColumns) }, (_, row) => images.slice(row * rowColumns, (row + 1) * rowColumns))

  return <div ref={galleryRef} className={styles.gallery} data-gallery-columns={columns} data-gallery-align={align} role="group" aria-label="사진 모음">
    {rows.map((row, rowIndex) => {
      const firstIndex = rowIndex * rowColumns
      const rowRatios = row.map((image, offset) => ratios[firstIndex + offset] ?? initialRatio(image))
      const available = Math.max(0, width - gap * (row.length - 1) - row.length * 2)
      const slotWidth = available / row.length
      const tallestHeight = Math.max(...rowRatios.map(ratio => slotWidth / ratio))
      const rowHeight = Math.min(tallestHeight, available / rowRatios.reduce((sum, ratio) => sum + ratio, 0))
      return <div className={styles.row} key={firstIndex}>
        {row.map((image, offset) => {
          const index = firstIndex + offset
          const caption = captionFor(image.caption?.trim() || image.alt)
          const measuredStyle: CSSProperties | undefined = width ? { width: rowHeight * rowRatios[offset]! + 2, flex: 'none' } : undefined
          return <figure className={styles.item} style={measuredStyle} key={`${image.src}-${index}`}>
            <div className={styles.frame}>
              <img src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" style={width ? { height: rowHeight } : undefined}
                onLoad={event => {
                  const element = event.currentTarget
                  const ratio = element.naturalWidth / element.naturalHeight
                  if (Number.isFinite(ratio) && ratio > 0) setRatios(previous => previous[index] === ratio ? previous : { ...previous, [index]: ratio })
                }} />
            </div>
            {caption && <figcaption>{caption}</figcaption>}
          </figure>
        })}
      </div>
    })}
  </div>
}
