'use client'

import { Fragment, useActionState, useId, useState } from 'react'
import { saveLandingCopyAction } from '@/app/admin/_actions/landing'
import type { FormState } from '@/app/admin/_actions/result'
import type { LandingField, LandingGroup } from '@/app/admin/_data/landing'
import { TextAreaField, TextField } from './Fields'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

const NO_ERRORS: Readonly<Record<string, string>> = {}

/** `**단어**` 표기를 그대로 보여 준다. 공개 페이지의 Highlight 와 같은 파서다. */
function renderHighlight(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part)
    return m ? <em key={i}>{m[1]}</em> : <Fragment key={i}>{part}</Fragment>
  })
}

/**
 * 슬로건 입력. `**` 를 한쪽만 닫는 실수가 실제로 잦아 입력 아래에 결과를 그대로 비춘다.
 * (서버도 `**` 개수가 짝인지 검증한다 — 여기는 편의고 저 쪽이 방어다.)
 *
 * 미리보기 때문에 값이 필요해서 이 필드만 제어 입력이다. 그래서 TextField 를 쓰지 않고
 * 라벨·설명·오류 배선을 직접 한다.
 */
function SloganField({
  field,
  defaultValue,
  error,
}: {
  field: LandingField
  defaultValue: string
  error: string | undefined
}) {
  const id = useId()
  const [value, setValue] = useState(defaultValue)
  const describedBy = [field.hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter((v): v is string => v !== null)
    .join(' ')

  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={id}>
        {field.label}
        {field.required ? (
          <span className={ui.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {field.hint ? (
        <p className={ui.hint} id={`${id}-hint`}>
          {field.hint}
        </p>
      ) : null}
      <input
        className={`${ui.input}${error ? ` ${ui.inputError}` : ''}`}
        id={id}
        name={field.key}
        value={value}
        maxLength={300}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
      />
      {error ? (
        <p className={ui.error} id={`${id}-error`}>
          {error}
        </p>
      ) : null}
      <p className={ui.sloganPreview}>{renderHighlight(value)}</p>
    </div>
  )
}

function renderField(
  field: LandingField,
  value: string,
  error: string | undefined
): React.ReactNode {
  switch (field.kind) {
    case 'slogan':
      return <SloganField key={field.key} field={field} defaultValue={value} error={error} />
    case 'multiline':
      return (
        <TextAreaField
          key={field.key}
          name={field.key}
          label={field.label}
          hint={field.hint}
          defaultValue={value}
          required={field.required}
          rows={5}
          maxLength={5000}
          error={error}
        />
      )
    case 'list':
      return (
        <TextAreaField
          key={field.key}
          name={field.key}
          label={field.label}
          hint={field.hint}
          defaultValue={value}
          required={field.required}
          rows={6}
          maxLength={5000}
          error={error}
        />
      )
    case 'number':
      return (
        <TextField
          key={field.key}
          name={field.key}
          label={field.label}
          hint={field.hint}
          defaultValue={value}
          required={field.required}
          inputMode="numeric"
          maxLength={15}
          error={error}
        />
      )
    default:
      return (
        <TextField
          key={field.key}
          name={field.key}
          label={field.label}
          hint={field.hint}
          defaultValue={value}
          required={field.required}
          maxLength={500}
          error={error}
        />
      )
  }
}

/**
 * 랜딩 카피 26키 편집 (F8·F10).
 *
 * **이 컴포넌트는 값이 전부 확보됐을 때만 렌더된다.** 조회에 실패했거나 키가 하나라도
 * 비어 있으면 패널이 에러 화면을 대신 그리고 이 폼은 DOM 에 존재하지 않는다 —
 * 저장 버튼이 아예 없으므로 빈 값으로 덮어쓰는 경로가 구조적으로 닫힌다 (01 §8 결함 #1).
 */
export default function LandingCopyForm({
  groups,
  values,
  version,
}: {
  groups: readonly LandingGroup[]
  values: Readonly<Record<string, string>>
  version: string
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveLandingCopyAction, null)
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? NO_ERRORS) : NO_ERRORS

  return (
    <form action={formAction} noValidate>
      <ActionNotice state={state} />

      <input type="hidden" name="version" value={version} />

      {groups.map((group) => (
        <fieldset className={ui.fieldset} key={group.id}>
          <legend className={ui.legend} lang="en">
            {group.title}
          </legend>
          {group.fields.map((field) =>
            renderField(field, values[field.key] ?? '', fieldErrors[field.key])
          )}
        </fieldset>
      ))}

      <div className={ui.actions}>
        <SubmitButton>랜딩 카피 저장</SubmitButton>
      </div>
    </form>
  )
}
