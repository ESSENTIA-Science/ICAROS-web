'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { createRocketAction, updateRocketAction } from '@/app/admin/_actions/rockets'
import type { FormState } from '@/app/admin/_actions/result'
import { SERIES } from '@/components/rocket/series'
import EngineEditor, { type EngineInit } from './EngineEditor'
import { SelectField, TextField, ToggleField } from './Fields'
import MarkdownField from './MarkdownField'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

export type RocketFormValues = {
  id: string
  name: string
  series: string
  sortOrder: number
  published: boolean
  descriptionMd: string
  maxAltitudeM: string
  sizeM: string
  payloadKg: string
  engines: readonly EngineInit[]
}

const SERIES_OPTIONS = SERIES.map((s) => ({ value: s.id, label: `${s.id} — ${s.label}` }))

const NO_ERRORS: Readonly<Record<string, string>> = {}

/**
 * 로켓 생성·수정 폼.
 *
 * `<form action={…}>` 에 서버 액션을 직접 물린다 — JS 가 없어도 제출이 되고,
 * JS 가 있으면 `useActionState` 가 결과를 같은 자리에 그린다. 성공하면 액션이 redirect 하므로
 * 상태가 갱신되지 않고 목록으로 넘어간다: 저장 성공 후 이전 오류가 남을 자리가 없다 (결함 #7).
 *
 * 3D 뷰어는 넣지 않는다 (F13) — 관리 화면은 생산성·안정성이 먼저다.
 */
export default function RocketForm({
  mode,
  values,
  version,
  cancelHref,
}: {
  mode: 'create' | 'edit'
  values: RocketFormValues
  /** 수정일 때만 존재하는 낙관적 잠금 토큰 (F12). */
  version?: string
  cancelHref: string
}) {
  const action = mode === 'create' ? createRocketAction : updateRocketAction
  const [state, formAction] = useActionState<FormState, FormData>(action, null)
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? NO_ERRORS) : NO_ERRORS

  return (
    <form action={formAction} noValidate>
      <ActionNotice state={state} />

      {version ? <input type="hidden" name="version" value={version} /> : null}

      <div className={ui.grid}>
        <TextField
          name="id"
          label="식별자 (URL slug)"
          defaultValue={values.id}
          hint={
            mode === 'edit'
              ? '주소가 되는 값이라 수정할 수 없습니다. 바꾸려면 새로 만들고 기존 항목을 삭제해 주세요.'
              : '공개 주소 /rocket/<식별자> 에 그대로 쓰입니다. 영소문자·숫자·하이픈, 2~48자.'
          }
          readOnly={mode === 'edit'}
          mono
          required
          maxLength={48}
          error={fieldErrors['id']}
        />
        <TextField
          name="name"
          label="이름"
          defaultValue={values.name}
          required
          maxLength={120}
          error={fieldErrors['name']}
        />
      </div>

      <div className={ui.grid}>
        <SelectField
          name="series"
          label="시리즈"
          defaultValue={values.series}
          options={SERIES_OPTIONS}
          required
          error={fieldErrors['series']}
        />
        <TextField
          name="sortOrder"
          label="정렬순서"
          defaultValue={String(values.sortOrder)}
          hint="같은 시리즈 안에서 중복될 수 없습니다. 작은 값이 먼저 나옵니다."
          inputMode="numeric"
          maxLength={4}
          required
          error={fieldErrors['sortOrder']}
        />
      </div>

      <div className={ui.grid}>
        <TextField
          name="maxAltitudeM"
          label="최대 고도 (m)"
          defaultValue={values.maxAltitudeM}
          inputMode="decimal"
          maxLength={13}
          error={fieldErrors['maxAltitudeM']}
        />
        <TextField
          name="sizeM"
          label="전장 (m)"
          defaultValue={values.sizeM}
          inputMode="decimal"
          maxLength={13}
          error={fieldErrors['sizeM']}
        />
        <TextField
          name="payloadKg"
          label="페이로드 (kg)"
          defaultValue={values.payloadKg}
          inputMode="decimal"
          maxLength={13}
          error={fieldErrors['payloadKg']}
        />
      </div>

      <ToggleField
        name="published"
        label="공개"
        defaultChecked={values.published}
        hint="끄면 목록과 직접 URL 양쪽에서 보이지 않습니다."
      />

      <MarkdownField
        name="descriptionMd"
        label="설명 (Markdown)"
        defaultValue={values.descriptionMd}
        maxLength={20000}
        error={fieldErrors['descriptionMd']}
      />

      <EngineEditor initial={values.engines} fieldErrors={fieldErrors} />

      <div className={ui.actions}>
        <SubmitButton>{mode === 'create' ? '로켓 추가' : '변경사항 저장'}</SubmitButton>
        <Link className={ui.btn} href={cancelHref}>
          취소
        </Link>
      </div>
    </form>
  )
}
