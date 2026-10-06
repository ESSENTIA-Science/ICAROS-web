'use client'

import { useId, useRef, useState } from 'react'
import Image from 'next/image'
import type { MediaEntityType, UploadKind } from '@/lib/image/policy'
import ui from './ui.module.css'
import {
  describeUploadFailure,
  formatDimensions,
  uploadOne,
  type MediaPreview,
} from './media-upload'

/**
 * 갤러리 — 대표 이미지 외 여러 장 (C7·F4 다중 업로드).
 *
 * hidden 을 **순서대로** 반복 제출한다. 서버는 그 순서를 그대로 표시 순서로 저장한다.
 * `MediaField` 와 같은 규칙을 따른다: 제거는 목록에서 빼기만 하고, 실제 정리는 저장 때 일어난다.
 *
 * 여러 장을 고르면 **순차로** 올린다. 병렬로 쏘면 관리자별 presign 쿼터(분당 30)를 몇 초 만에
 * 소진하고, 실패한 장이 몇 번째인지도 알려 줄 수 없다.
 */
export default function GalleryField({
  name,
  label,
  hint,
  kind,
  entityType,
  initial,
  storageReady,
  max,
  error,
}: {
  name: string
  label: string
  hint?: string
  kind: UploadKind
  /** `MediaField` 와 같은 이유로 필수다 — 캐시 정책이 이 값으로 갈린다. */
  entityType: MediaEntityType
  initial: readonly MediaPreview[]
  storageReady: boolean
  max: number
  /** 서버가 이 입력을 원인으로 지목한 오류. 대표 이미지 필드에 붙던 것을 여기로 되돌렸다. */
  error?: string
}) {
  const fieldId = useId()
  const [items, setItems] = useState<MediaPreview[]>([...initial])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const full = items.length >= max

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (picked.length === 0) return

    // 상한을 넘는 만큼은 아예 시도하지 않는다 — 올린 뒤 버리면 S3 에 고아만 남는다.
    const room = Math.max(0, max - items.length)
    const files = picked.slice(0, room)
    const skipped = picked.length - files.length

    setBusy(true)
    setFailure(null)

    let done = 0
    let firstError: string | null = null

    for (const [index, file] of files.entries()) {
      setStatus(`${files.length}장 중 ${index + 1}번째를 올리는 중입니다…`)
      try {
        const uploaded = await uploadOne(file, { kind, entityType })
        // 함수형 갱신을 쓴다 — 루프 중에 사용자가 다른 항목을 지울 수 있다.
        setItems((prev) => (prev.some((p) => p.id === uploaded.id) ? prev : [...prev, uploaded]))
        done += 1
      } catch (err) {
        firstError ??= describeUploadFailure(err)
      }
    }

    setBusy(false)
    setStatus(done > 0 ? `${done}장을 올렸습니다. 저장해야 반영됩니다.` : null)

    const notes: string[] = []
    if (firstError) notes.push(`${files.length - done}장을 올리지 못했습니다. ${firstError}`)
    if (skipped > 0) notes.push(`상한(${max}장)을 넘어 ${skipped}장은 제외했습니다.`)
    setFailure(notes.length > 0 ? notes.join(' ') : null)
  }

  function remove(id: string): void {
    setItems((prev) => prev.filter((p) => p.id !== id))
    setFailure(null)
    setStatus('목록에서 제거했습니다. 저장해야 반영됩니다.')
  }

  function move(id: string, delta: -1 | 1): void {
    setItems((prev) => {
      const from = prev.findIndex((p) => p.id === id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      if (!moved) return prev
      next.splice(to, 0, moved)
      return next
    })
  }

  return (
    <fieldset className={ui.fieldset}>
      <legend className={ui.legend} lang="en">
        {label}
      </legend>

      {hint ? <p className={ui.hint}>{hint}</p> : null}

      {items.length === 0 ? (
        <p className={ui.empty}>등록된 갤러리 이미지가 없습니다.</p>
      ) : (
        <ol className={ui.galleryList}>
          {items.map((item, index) => {
            const dims = formatDimensions(item.width, item.height)
            return (
              <li className={ui.galleryItem} key={item.id}>
                {/* 순서가 곧 DOM 순서다. 서버는 같은 이름으로 반복 제출된 값을 순서대로 읽는다. */}
                <input type="hidden" name={name} value={item.id} />

                <div className={ui.mediaThumb}>
                  <Image
                    className={ui.mediaImg}
                    src={item.url}
                    alt=""
                    width={160}
                    height={160}
                    unoptimized
                  />
                </div>

                <div className={ui.mediaBody}>
                  <p className={ui.mediaMeta}>
                    <span className={ui.mono}>{String(index + 1).padStart(2, '0')}</span>
                    {dims ? ` · ${dims}` : ''}
                    {item.filename ? ` · ${item.filename}` : ''}
                  </p>

                  <div className={ui.mediaActions}>
                    <button
                      type="button"
                      className={`${ui.btn} ${ui.btnSmall}`}
                      onClick={() => move(item.id, -1)}
                      disabled={busy || index === 0}
                      aria-label={`${index + 1}번째 이미지를 앞으로`}
                    >
                      앞으로
                    </button>
                    <button
                      type="button"
                      className={`${ui.btn} ${ui.btnSmall}`}
                      onClick={() => move(item.id, 1)}
                      disabled={busy || index === items.length - 1}
                      aria-label={`${index + 1}번째 이미지를 뒤로`}
                    >
                      뒤로
                    </button>
                    <button
                      type="button"
                      className={`${ui.btn} ${ui.btnSmall}`}
                      onClick={() => remove(item.id)}
                      disabled={busy}
                      aria-label={`${index + 1}번째 이미지 제거`}
                    >
                      제거
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <label className={ui.label} htmlFor={fieldId}>
        이미지 추가
      </label>
      <input
        className={ui.fileInput}
        id={fieldId}
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handlePick}
        disabled={busy || full}
      />

      {!storageReady ? (
        <p className={ui.mediaWarn}>
          이미지 저장소가 아직 구성되지 않아(S3_BUCKET 미설정) 업로드가 실패합니다.
        </p>
      ) : null}

      <p className={ui.mediaStatus} aria-live="polite">
        {busy ? '업로드 중…' : (status ?? `${items.length} / ${max}장`)}
      </p>

      {failure ? (
        <p className={ui.error} role="alert">
          {failure}
        </p>
      ) : null}

      {error ? <p className={ui.error}>{error}</p> : null}

      <noscript>
        <p className={ui.hint}>
          JavaScript 가 꺼져 있어 갤러리를 편집할 수 없습니다. 기존 갤러리는 그대로 유지되고, 다른
          항목은 정상적으로 저장됩니다.
        </p>
      </noscript>
    </fieldset>
  )
}
