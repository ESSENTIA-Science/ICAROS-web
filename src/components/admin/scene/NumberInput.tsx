'use client'

import ui from '../ui.module.css'

/**
 * 제어형 숫자 입력.
 *
 * 공용 `Fields.tsx` 의 `TextField` 는 **비제어**다(값은 DOM 이 갖는다). 프리셋 편집은
 * 타이핑하는 즉시 범위 경고와 `at` 정렬 미리보기를 갱신해야 해서 값이 React 쪽에 있어야 한다.
 * 그래서 같은 마크업·같은 aria 배선을 유지한 제어형 사본을 둔다 — 공용 컴포넌트를 고치면
 * 다른 패널의 "검증 오류 후에도 입력값 보존" 동작이 함께 바뀌기 때문이다.
 */
export default function NumberInput({
  id,
  name,
  label,
  value,
  onValueChange,
  error,
  hint,
  maxLength,
}: {
  id: string
  name: string
  label: string
  value: string
  onValueChange: (next: string) => void
  error?: string
  hint?: string
  maxLength?: number
}) {
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
      <input
        className={`${ui.input} ${ui.mono}${error ? ` ${ui.inputError}` : ''}`}
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        value={value}
        maxLength={maxLength}
        onChange={(e) => onValueChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
      />
      {error ? (
        <p className={ui.error} id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
