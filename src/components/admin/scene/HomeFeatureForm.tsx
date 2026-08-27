'use client'

import { useActionState } from 'react'
import { saveHomeFeatureAction } from '@/app/admin/_actions/scene'
import type { FormState } from '@/app/admin/_actions/result'
import { SelectField } from '../Fields'
import { ActionNotice } from '../Notice'
import SubmitButton from '../SubmitButton'
import ui from '../ui.module.css'
import { HOME_FEATURE_NEW_TOKEN } from './constants'

export type FeatureRocketChoice = { id: string; name: string }
export type FeatureModelChoice = { id: string; label: string; rocketId: string | null }

const NO_ERRORS: Readonly<Record<string, string>> = {}

/**
 * 홈 대표 기체·모델 지정 (B12).
 *
 * `site_settings` 의 자유 문자열이 아니라 FK 가 걸린 단일 행이라, 가리키던 대상이 삭제되면
 * 자동으로 비워진다(`on delete set null`) — 홈이 없는 id 를 붙들고 깨지지 않는다.
 */
export default function HomeFeatureForm({
  rockets,
  models,
  rocketId,
  modelId,
  version,
}: {
  rockets: readonly FeatureRocketChoice[]
  models: readonly FeatureModelChoice[]
  rocketId: string
  modelId: string
  /** 행이 아직 없으면 null. 그 상태를 토큰 자리에 명시해 보낸다 (F12). */
  version: string | null
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveHomeFeatureAction, null)
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? NO_ERRORS) : NO_ERRORS

  const rocketOptions = [
    { value: '', label: '지정 안 함' },
    ...rockets.map((r) => ({ value: r.id, label: `${r.name} (${r.id})` })),
  ]
  const modelOptions = [
    { value: '', label: '지정 안 함' },
    ...models.map((m) => ({
      value: m.id,
      label: m.rocketId === null ? `${m.label} (범용)` : `${m.label} → ${m.rocketId}`,
    })),
  ]

  return (
    <form action={formAction} noValidate>
      <ActionNotice state={state} />

      <input type="hidden" name="version" value={version ?? HOME_FEATURE_NEW_TOKEN} />

      <div className={ui.grid}>
        <SelectField
          name="rocketId"
          label="대표 로켓"
          defaultValue={rocketId}
          options={rocketOptions}
          error={fieldErrors['rocketId']}
        />
        <SelectField
          name="modelId"
          label="대표 3D 모델"
          defaultValue={modelId}
          options={modelOptions}
          hint="다른 로켓에 연결된 모델은 대표 로켓과 함께 지정할 수 없습니다."
          error={fieldErrors['modelId']}
        />
      </div>

      <div className={ui.actions}>
        <SubmitButton>대표 지정 저장</SubmitButton>
      </div>
    </form>
  )
}
