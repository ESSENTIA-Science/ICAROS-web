'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import {
  createVehicleTypeAction,
  updateVehicleTypeAction,
} from '@/app/admin/_actions/vehicle-types'
import type { FormState } from '@/app/admin/_actions/result'
import { TextField } from './Fields'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

export type VehicleTypeFormValues = {
  id: string
  label: string
  sortOrder: number
}

const NO_ERRORS: Readonly<Record<string, string>> = {}

/**
 * 기체 분류 생성·수정 폼. `RocketSeriesForm` 과 같은 모양이다 — 스키마가 같은 모양이라
 * 다르게 만들 이유가 없고, 다르게 만들면 둘 중 하나만 고쳐지는 날이 온다.
 *
 * **수정에서 식별자를 잠그는 이유**: `id` 가 공개 URL(`/vehicles?type=uavs`)에 그대로 나간다.
 * 바꾸면 그 주소를 가리키던 링크·북마크·검색 결과가 전부 죽는다. 화면에 보이는 것은
 * 어차피 `label` 이라 실무상 아쉬울 일도 없다.
 *
 * 설명 칸이 없는 것은 `vehicle_types` 에 `description_md` 가 없기 때문이다 — 분류 단위 설명은
 * 시리즈 설명으로 충분하다고 보고 컬럼을 두지 않았다. 칸부터 만들지 않는다.
 */
export default function VehicleTypeForm({
  mode,
  values,
  version,
  cancelHref,
}: {
  mode: 'create' | 'edit'
  values: VehicleTypeFormValues
  /** 수정일 때만 존재하는 낙관적 잠금 토큰 (F12). */
  version?: string
  cancelHref: string
}) {
  const action = mode === 'create' ? createVehicleTypeAction : updateVehicleTypeAction
  const [state, formAction] = useActionState<FormState, FormData>(action, null)
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? NO_ERRORS) : NO_ERRORS

  return (
    <form action={formAction} noValidate>
      <ActionNotice state={state} />

      {version ? <input type="hidden" name="version" value={version} /> : null}
      {/*
        `id` 는 아래 readOnly 입력이 그대로 제출한다. hidden 을 하나 더 두지 않는다 —
        같은 name 이 둘이면 `form.get('id')` 는 앞의 것만 집는다 (RocketSeriesForm 과 같은 이유).
      */}

      <div className={ui.grid}>
        <TextField
          name="id"
          label="식별자"
          defaultValue={values.id}
          hint={
            mode === 'edit'
              ? '공개 주소에 쓰이는 값이라 수정할 수 없습니다. 표시 이름만 바꿀 수 있습니다.'
              : '공개 주소 /vehicles?type=<식별자> 에 그대로 쓰입니다. 영문·숫자·하이픈, 1~32자.'
          }
          readOnly={mode === 'edit'}
          mono
          required
          maxLength={32}
          error={fieldErrors['id']}
        />
        <TextField
          name="label"
          label="표시 이름"
          defaultValue={values.label}
          hint="공개 목록의 첫 줄 탭에 그대로 나옵니다. 예: ROCKETS"
          required
          maxLength={80}
          error={fieldErrors['label']}
        />
      </div>

      <div className={ui.grid}>
        <TextField
          name="sortOrder"
          label="정렬순서"
          defaultValue={String(values.sortOrder)}
          hint="작은 값이 먼저 나옵니다. 맨 앞 분류가 /vehicles 의 기본 화면이 됩니다."
          inputMode="numeric"
          maxLength={4}
          required
          error={fieldErrors['sortOrder']}
        />
      </div>

      <div className={ui.actions}>
        <SubmitButton>{mode === 'create' ? '분류 추가' : '변경사항 저장'}</SubmitButton>
        <Link className={ui.btn} href={cancelHref}>
          취소
        </Link>
      </div>
    </form>
  )
}
