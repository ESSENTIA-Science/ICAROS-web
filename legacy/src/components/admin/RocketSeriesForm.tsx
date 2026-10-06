'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import {
  createRocketSeriesAction,
  updateRocketSeriesAction,
} from '@/app/admin/_actions/rocket-series'
import type { FormState } from '@/app/admin/_actions/result'
import type { VehicleTypeOption } from '@/components/rocket/series'
import { SelectField, TextField } from './Fields'
import MarkdownField from './MarkdownField'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

export type RocketSeriesFormValues = {
  id: string
  label: string
  /** 상위 분류 id. NOT NULL 이라 빈 값이 올 수 없다 — 패널이 분류가 0개면 폼을 띄우지 않는다. */
  typeId: string
  /** 시리즈 설명(마크다운). 없으면 빈 문자열. */
  descriptionMd: string
  sortOrder: number
}

const NO_ERRORS: Readonly<Record<string, string>> = {}

/**
 * 기체 시리즈 생성·수정 폼.
 *
 * **수정에서 식별자를 잠그는 이유**: `id` 가 공개 URL(`/vehicles?series=B`)에 그대로 나간다.
 * 바꾸면 그 주소를 가리키던 링크·북마크·검색 결과가 전부 죽는다. 화면에 보이는 것은
 * 어차피 `label` 이라 실무상 아쉬울 일도 없다 — 표시 이름만 고치면 된다.
 */
export default function RocketSeriesForm({
  mode,
  values,
  version,
  cancelHref,
  typeOptions,
  typesHref,
}: {
  mode: 'create' | 'edit'
  values: RocketSeriesFormValues
  /** 수정일 때만 존재하는 낙관적 잠금 토큰 (F12). */
  version?: string
  cancelHref: string
  /**
   * 분류 목록. **서버가 그 요청에서 읽어 넘긴다** — `RocketForm` 의 `seriesOptions` 와 같은
   * 이유다. 여기서 import 해 두면 분류를 늘리는 데 배포가 필요해진다.
   * 비어 있는 경우는 오지 않는다: 패널이 그때는 이 폼 대신 안내를 그린다.
   */
  typeOptions: readonly VehicleTypeOption[]
  /** 분류 관리 화면 주소. select 밑에 링크로 붙는다. */
  typesHref: string
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
              : '공개 주소 /vehicles?series=<식별자> 에 그대로 쓰입니다. 영문·숫자·하이픈, 1~32자.'
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
        <div className={ui.field}>
          <SelectField
            name="typeId"
            label="분류"
            defaultValue={values.typeId}
            options={typeOptions.map((t) => ({ value: t.id, label: `${t.id} — ${t.label}` }))}
            required
            error={fieldErrors['typeId']}
          />
          {/*
            분류 추가·수정·삭제는 별도 화면이다 — 이유는 시리즈 관리를 기체 폼 밖에 둔 것과
            같다(HTML 폼은 중첩할 수 없다). 떠나면 입력이 날아가므로 그 사실을 링크 옆에 적는다.
          */}
          <p className={ui.hint}>
            <Link href={typesHref}>분류 관리</Link> — 추가·이름 수정·삭제. 이동하면 지금 입력한
            내용은 저장되지 않습니다.
          </p>
        </div>
        <TextField
          name="sortOrder"
          label="정렬순서"
          defaultValue={String(values.sortOrder)}
          hint="같은 분류 안에서 작은 값이 먼저 나옵니다. 맨 앞 시리즈가 그 분류의 기본 화면이 됩니다."
          inputMode="numeric"
          maxLength={4}
          required
          error={fieldErrors['sortOrder']}
        />
      </div>

      {/*
        시리즈 설명. 로켓 설명과 같은 컬럼 성격(`description_md`)이라 같은 편집기를 쓴다 —
        미리보기 파이프라인이 공개 페이지와 같아야 "어드민에서는 되는데" 가 생기지 않는다.
      */}
      <MarkdownField
        name="descriptionMd"
        label="시리즈 설명 (Markdown)"
        defaultValue={values.descriptionMd}
        hint="공개 목록에서 이 시리즈를 골랐을 때 기체 격자 위에 나옵니다. 비워 두면 아무것도 그리지 않습니다."
        rows={8}
        maxLength={20000}
        error={fieldErrors['descriptionMd']}
      />

      <div className={ui.actions}>
        <SubmitButton>{mode === 'create' ? '시리즈 추가' : '변경사항 저장'}</SubmitButton>
        <Link className={ui.btn} href={cancelHref}>
          취소
        </Link>
      </div>
    </form>
  )
}
