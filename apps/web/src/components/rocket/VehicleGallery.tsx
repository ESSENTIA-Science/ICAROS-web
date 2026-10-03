'use client'

import { useEffect, useRef, useState } from 'react'
import MediaImage from './MediaImage'
import styles from './VehicleGallery.module.css'

type GalleryImage = { src: string; alt: string; width?: number; height?: number }

export default function VehicleGallery({ images, label }: { images: GalleryImage[]; label: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const image = selected === null ? null : images[selected]

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (image && !dialog.open) dialog.showModal()
    if (!image && dialog.open) dialog.close()
  }, [image])

  const close = () => dialogRef.current?.close()
  const move = (direction: -1 | 1) => {
    setSelected((current) => current === null ? null : (current + direction + images.length) % images.length)
  }

  return (
    <>
      <div className={styles.grid}>
        {images.map((item, index) => (
          <button
            key={`${item.src}-${index}`}
            type="button"
            className={styles.item}
            aria-label={`${item.alt || `${label} 사진 ${index + 1}`} 크게 보기`}
            onClick={(event) => {
              openerRef.current = event.currentTarget
              setSelected(index)
            }}
          >
            <MediaImage src={item.src} alt={item.alt} width={item.width} height={item.height} sizes="(max-width: 599px) 100vw, (max-width: 899px) 50vw, 33vw" className={styles.thumbnail} />
          </button>
        ))}
      </div>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-label={`${label} 사진 크게 보기`}
        onClick={(event) => { if (event.target === event.currentTarget) close() }}
        onKeyDown={(event) => {
          if (images.length < 2) return
          if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
          if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
        }}
        onClose={() => {
          setSelected(null)
          openerRef.current?.focus()
        }}
      >
        {image ? (
          <div className={styles.dialogContent}>
            <button type="button" className={styles.close} onClick={close} aria-label="사진 닫기">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19" /></svg>
            </button>
            <div className={styles.imageFrame}>
              <MediaImage src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(max-width: 599px) 90vw, 80vw" className={styles.largeImage} />
            </div>
            {images.length > 1 ? (
              <>
                <button type="button" className={`${styles.arrow} ${styles.previous}`} onClick={() => move(-1)} aria-label="이전 사진">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 4-8 8 8 8" /></svg>
                </button>
                <button type="button" className={`${styles.arrow} ${styles.next}`} onClick={() => move(1)} aria-label="다음 사진">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 4 8 8-8 8" /></svg>
                </button>
              </>
            ) : null}
            <span className={styles.count}>{selected === null ? 0 : selected + 1} / {images.length}</span>
          </div>
        ) : null}
      </dialog>
    </>
  )
}
