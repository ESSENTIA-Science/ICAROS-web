'use client'

import { useId, useRef, useState } from 'react'
import Image from 'next/image'
import type { MediaEntityType, UploadKind } from '@/lib/image/policy'
import ui from './ui.module.css'
import { describeUploadFailure, formatDimensions, uploadOne, type MediaPreview } from './media-upload'

/**
 * 대표 이미지 한 장 (F4·C7·E6).
 *
 * 폼 안의 **잎 컴포넌트**다. 선택한 이미지의 id 만 hidden 으로 실어 보내고, 저장은 폼이 한다.
 * 그래서 여기서 무슨 일이 일어나도 폼의 다른 입력(이름·스펙·엔진·마크다운)은 건드려지지 않는다 —
 * 업로드가 실패해도 사용자가 친 값이 그대로 남아야 한다.
 *
 * **제거는 즉시 반영하지 않는다.** hidden 값을 비울 뿐이고 실제 정리는 저장 시점의
 * Server Action 이 한다. 취소하고 나가면 아무 일도 일어나지 않은 상태여야 하기 때문이다.
 */
export default function MediaField({
  name,
  label,
  hint,
  kind,
  entityType,
  initial,
  legacyPath,
  storageReady,
  error,
}: {
  /** hidden 필드 이름. 서버는 이 이름으로 media id(또는 빈 문자열)를 받는다. */
  name: string
  label: string
  hint?: string
  kind: UploadKind
  /**
   * **반드시 넘긴다.** `/api/media/{id}` 의 캐시 정책이 이 값으로 갈린다 —
   * 비우면 용도를 모르는 미디어로 취급돼 `private, no-store` 로 서빙되고 캐시가 붙지 않는다.
   */
  entityType: MediaEntityType
  initial: MediaPreview | null
  /** 아직 S3 로 옮기지 않은 레거시 이미지 경로. 새 이미지가 없을 때만 보여 준다. */
  legacyPath?: string | null
  /** `S3_BUCKET` 이 설정돼 있는가. 꺼져 있으면 미리 알려 준다 — 눌러 보고 실패하는 것보다 낫다. */
  storageReady: boolean
  error?: string
}) {
  const fieldId = useId()
  const [current, setCurrent] = useState<MediaPreview | null>(initial)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 연속으로 파일을 고르면 늦게 끝난 앞선 업로드가 뒤엣것을 덮어쓸 수 있다. 마지막 것만 채택한다. */
  const runRef = useRef(0)

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    // 같은 파일을 다시 골라도 change 가 발생하도록 즉시 비운다.
    event.target.value = ''
    if (!file) return

    const run = runRef.current + 1
    runRef.current = run

    setBusy(true)
    setFailure(null)
    setStatus('이미지를 변환하고 있습니다…')

    try {
      const uploaded = await uploadOne(file, { kind, entityType })
      if (runRef.current !== run) return
      setCurrent(uploaded)
      setStatus('업로드했습니다. 아래 저장 버튼을 눌러야 반영됩니다.')
    } catch (err) {
      if (runRef.current !== run) return
      setStatus(null)
      setFailure(describeUploadFailure(err))
    } finally {
      if (runRef.current === run) setBusy(false)
    }
  }

  function handleRemove(): void {
    runRef.current += 1
    setCurrent(null)
    setFailure(null)
    setStatus('이미지를 제거했습니다. 저장해야 반영됩니다.')
    inputRef.current?.focus()
  }

  const meta = current
    ? [formatDimensions(current.width, current.height), current.filename].filter(
        (v): v is string => v !== null && v !== ''
      )
    : []

  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={fieldId}>
        {label}
      </label>
      {hint ? (
        <p className={ui.hint} id={`${fieldId}-hint`}>
          {hint}
        </p>
      ) : null}

      {/* 값은 상태가 갖는다. 빈 문자열이 "이미지 없음"이고, 서버는 그걸 null 로 저장한다. */}
      <input type="hidden" name={name} value={current?.id ?? ''} />

      <div className={ui.media}>
        <div className={ui.mediaThumb}>
          {current ? (
            /* unoptimized: 관리 화면 썸네일 한 장에 최적화기를 거칠 이유가 없고,
               멤버 사진처럼 `private, no-store` 로 서빙되는 이미지의 사본을 이미지 캐시에 남기지 않는다. */
            <Image
              className={ui.mediaImg}
              src={current.url}
              alt=""
              width={160}
              height={160}
              unoptimized
            />
          ) : legacyPath ? (
            <Image className={ui.mediaImg} src={legacyPath} alt="" width={160} height={160} unoptimized />
          ) : (
            <span className={ui.mediaBlank} aria-hidden="true" />
          )}
        </div>

        <div className={ui.mediaBody}>
          <input
            className={ui.fileInput}
            id={fieldId}
            ref={inputRef}
            type="file"
            accept="image/*"
            /* name 을 주지 않는다 — 주면 원본 파일이 Server Action 본문에 통째로 실린다.
               서버로 가는 것은 업로드가 끝난 뒤의 media id 하나뿐이다. */
            onChange={handlePick}
            disabled={busy}
            aria-describedby={hint ? `${fieldId}-hint` : undefined}
          />

          {meta.length > 0 ? <p className={ui.mediaMeta}>{meta.join(' · ')}</p> : null}

          {!current && legacyPath ? (
            <p className={ui.mediaMeta}>
              현재는 저장소로 옮기기 전의 파일 경로를 쓰고 있습니다. 새 이미지를 올리면 대체됩니다.
            </p>
          ) : null}

          {current ? (
            <div className={ui.mediaActions}>
              <button
                type="button"
                className={`${ui.btn} ${ui.btnSmall}`}
                onClick={handleRemove}
                disabled={busy}
              >
                이미지 제거
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {!storageReady ? (
        <p className={ui.mediaWarn}>
          이미지 저장소가 아직 구성되지 않아(S3_BUCKET 미설정) 업로드가 실패합니다. 나머지 항목은
          정상적으로 저장됩니다.
        </p>
      ) : null}

      <p className={ui.mediaStatus} aria-live="polite">
        {busy ? '업로드 중…' : (status ?? '')}
      </p>

      {failure ? (
        <p className={ui.error} role="alert">
          {failure}
        </p>
      ) : null}

      {error ? (
        <p className={ui.error} id={`${fieldId}-error`}>
          {error}
        </p>
      ) : null}

      <noscript>
        <p className={ui.hint}>
          이미지 업로드는 JavaScript 가 필요합니다. 나머지 항목은 그대로 저장할 수 있고, 기존
          이미지도 유지됩니다.
        </p>
      </noscript>
    </div>
  )
}
