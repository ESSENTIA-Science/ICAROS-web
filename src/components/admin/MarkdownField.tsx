'use client'

import { useId, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ui from './ui.module.css'

/**
 * 마크다운 편집기 — 툴바 + 실시간 미리보기 (F3).
 *
 * 미리보기는 공개 페이지와 같은 파이프라인(react-markdown + remark-gfm, `skipHtml`)을 쓴다.
 * 렌더러가 다르면 "어드민에서는 되는데 공개 페이지에서는 안 되는" 문법이 생긴다.
 *
 * JS 가 없으면 툴바와 미리보기만 사라지고 textarea 는 그대로 제출된다.
 */
export default function MarkdownField({
  name,
  label,
  defaultValue,
  hint,
  error,
  rows = 14,
  maxLength,
}: {
  name: string
  label: string
  defaultValue: string
  hint?: string
  error?: string
  rows?: number
  maxLength?: number
}) {
  const id = useId()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(defaultValue)
  const [showPreview, setShowPreview] = useState(true)

  /** 선택 영역을 감싼다. 선택이 없으면 자리표시자를 넣고 그 부분을 선택 상태로 남긴다. */
  function wrap(before: string, after: string, placeholder: string): void {
    const el = areaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end) || placeholder
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
    setValue(next)
    queueMicrotask(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  /** 선택된 줄들의 앞에 접두사를 붙인다. 목록·인용·제목처럼 줄 단위인 문법용. */
  function prefixLines(prefix: string): void {
    const el = areaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end)
    const block = value.slice(lineStart, lineEnd)
    const patched = block
      .split('\n')
      .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : `${prefix}${line}`))
      .join('\n')
    const next = `${value.slice(0, lineStart)}${patched}${value.slice(lineEnd)}`
    setValue(next)
    queueMicrotask(() => {
      el.focus()
      el.setSelectionRange(lineStart, lineStart + patched.length)
    })
  }

  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter((v): v is string => v !== null)
    .join(' ')

  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <p className={ui.hint} id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}

      <div className={ui.mdBar} role="toolbar" aria-label={`${label} 서식`} aria-controls={id}>
        <button type="button" className={ui.mdBtn} onClick={() => wrap('**', '**', '굵게')}>
          굵게
        </button>
        <button type="button" className={ui.mdBtn} onClick={() => wrap('*', '*', '기울임')}>
          기울임
        </button>
        <button type="button" className={ui.mdBtn} onClick={() => prefixLines('## ')}>
          제목
        </button>
        <button type="button" className={ui.mdBtn} onClick={() => prefixLines('- ')}>
          목록
        </button>
        <button type="button" className={ui.mdBtn} onClick={() => prefixLines('> ')}>
          인용
        </button>
        <button type="button" className={ui.mdBtn} onClick={() => wrap('`', '`', 'code')}>
          코드
        </button>
        <button type="button" className={ui.mdBtn} onClick={() => wrap('[', '](https://)', '링크')}>
          링크
        </button>
        <span className={ui.spacer} />
        <button
          type="button"
          className={ui.mdBtn}
          aria-pressed={showPreview}
          onClick={() => setShowPreview((v) => !v)}
        >
          미리보기
        </button>
      </div>

      <textarea
        ref={areaRef}
        className={`${ui.textarea} ${ui.mdArea}${error ? ` ${ui.inputError}` : ''}`}
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
      />

      {error ? (
        <p className={ui.error} id={`${id}-error`}>
          {error}
        </p>
      ) : null}

      {showPreview ? (
        <>
          <p className={`${ui.hint} ${ui.mdPreviewLabel}`} id={`${id}-preview-label`}>
            미리보기
          </p>
          <div className={ui.mdPreview} aria-labelledby={`${id}-preview-label`}>
            {value.trim() === '' ? (
              <p className={ui.mdEmpty}>내용을 입력하면 여기에 표시됩니다.</p>
            ) : (
              <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                {value}
              </Markdown>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
