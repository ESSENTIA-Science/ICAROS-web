'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import {
  createRocketSeriesAction,
  updateRocketSeriesAction,
} from '@/app/admin/_actions/rocket-series'
import type { FormState } from '@/app/admin/_actions/result'
import { TextField } from './Fields'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

export type RocketSeriesFormValues = {
  id: string
  label: string
  sortOrder: number
}

const NO_ERRORS: Readonly<Record<string, string>> = {}

/**
 * 로켓 카테고리 생성·수정 폼.
 *
 * **수정에서 식별자를 잠그는 이유**: `id` 가 공개 URL(`/rocket?series=B`)에 그대로 나간다.
 * 바꾸면 그 주소를 가리키던 링크·북마크·검색 결과가 전부 죽는다. 화면에 보이는 것은
 * 어차피 `label` 이라 실무상 아쉬울 일도 없다 — 표시 이름만 고치면 된다.
 */
export default function RocketSeriesForm({
  mode,
  values,
  version,
  cancelHref,
}: {
  mode: 'create' | 'edit'
  values: RocketSeriesFormValues
  /** 수정일 때만 존재하는 낙관적 잠금 토큰 (F12). */
  version?: string
  cancelHref: string
}) {
  const action = mode === 'create' ? createRocketSeriesAction : updateRocketSeriesAction
  const [state, formAction] = useActionState<FormState, FormData>(action, null)
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? NO_ERRORS) : NO_ERRORS

  return (
    <form action={formAction} noValidate>
      <ActionNotice state={state} />

      {version ? <input type="hidden" name="version" value={version} /> : null}
      {/*
        `id` 는 아래 readOnly 입력이 그대로 제출한다. hidden 을 하나 더 두지 않는다 —
        같은 name 이 둘이면 `form.get('id')` 는 앞의 것만 집고 뒤엣것은 조용히 무시된다.
        지금은 두 값이 같아 증상이 없지만, 한쪽만 고치는 날 원인을 찾기 어렵다.
        readOnly 든 hidden 이든 어차피 클라이언트가 보내는 값이라 신뢰도에 차이도 없다.
      */}

      <div className={ui.grid}>
        <TextField
          name="id"
          label="식별자"
          defaultValue={values.id}
          hint={
            mode === 'edit'
              ? '공개 주소에 쓰이는 값이라 수정할 수 없습니다. 표시 이름만 바꿀 수 있습니다.'
              : '공개 주소 /rocket?series=<식별자> 에 그대로 쓰입니다. 영문·숫자·하이픈, 1~32자.'
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
          hint="탭과 기체 상세에 그대로 나옵니다. 예: ICX 1/2 Series"
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
          hint="작은 값이 먼저 나옵니다. 맨 앞 카테고리가 /rocket 의 기본 화면이 됩니다."
          inputMode="numeric"
          maxLength={4}
          required
          error={fieldErrors['sortOrder']}
        />
      </div>

      <div className={ui.actions}>
        <SubmitButton>{mode === 'create' ? '카테고리 추가' : '변경사항 저장'}</SubmitButton>
        <Link className={ui.btn} href={cancelHref}>
          취소
        </Link>
      </div>
    </form>
  )
}
