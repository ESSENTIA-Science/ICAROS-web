'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { createMemberAction, updateMemberAction } from '@/app/admin/_actions/members'
import type { FormState } from '@/app/admin/_actions/result'
import { TextField, ToggleField } from './Fields'
import MediaField from './MediaField'
import type { MediaPreview } from './media-upload'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

export type MemberFormValues = {
  id: string | null
  name: string
  role: string
  squad: string
  school: string
  sortOrder: number
  published: boolean
  /** 프로필 사진. 없으면 legacyImagePath, 그것도 없으면 공개 페이지가 플레이스홀더를 쓴다 (E6). */
  image: MediaPreview | null
  legacyImagePath: string | null
}

const NO_ERRORS: Readonly<Record<string, string>> = {}
const SQUAD_LIST_ID = 'admin-squad-options'

export default function MemberForm({
  mode,
  values,
  version,
  squads,
  storageReady,
  cancelHref,
}: {
  mode: 'create' | 'edit'
  values: MemberFormValues
  version?: string
  /** 이미 쓰이는 부서 이름. 자유 입력이지만 표기 흔들림을 줄인다 (E4). */
  squads: readonly string[]
  /** `S3_BUCKET` 설정 여부. 업로드 필드가 미리 안내하는 데만 쓴다. */
  storageReady: boolean
  cancelHref: string
}) {
  const action = mode === 'create' ? createMemberAction : updateMemberAction
  const [state, formAction] = useActionState<FormState, FormData>(action, null)
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? NO_ERRORS) : NO_ERRORS

  return (
    <form action={formAction} noValidate>
      <ActionNotice state={state} />

      {mode === 'edit' && values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {version ? <input type="hidden" name="version" value={version} /> : null}

      <div className={ui.grid}>
        <TextField
          name="name"
          label="이름"
          defaultValue={values.name}
          required
          maxLength={80}
          error={fieldErrors['name']}
        />
        <TextField
          name="role"
          label="역할"
          defaultValue={values.role}
          placeholder="예: 팀장, 추진 담당"
          maxLength={80}
          error={fieldErrors['role']}
        />
      </div>

      <div className={ui.grid}>
        <TextField
          name="squad"
          label="부서"
          defaultValue={values.squad}
          hint="같은 부서끼리 묶여 표시됩니다. 비우면 '기타' 그룹으로 들어갑니다."
          list={SQUAD_LIST_ID}
          maxLength={80}
          error={fieldErrors['squad']}
        />
        <TextField
          name="school"
          label="학교"
          defaultValue={values.school}
          maxLength={120}
          error={fieldErrors['school']}
        />
      </div>

      <datalist id={SQUAD_LIST_ID}>
        {squads.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className={ui.grid}>
        <TextField
          name="sortOrder"
          label="정렬순서"
          defaultValue={String(values.sortOrder)}
          hint="작은 값이 먼저 나옵니다. 값이 같으면 등록 순서로 정렬됩니다."
          inputMode="numeric"
          maxLength={4}
          required
          error={fieldErrors['sortOrder']}
        />
      </div>

      <MediaField
        name="imageMediaId"
        label="프로필 사진"
        hint="긴 변 512px · 1MB 이하 WebP 로 자동 변환됩니다. 비워 두면 기본 이미지가 표시됩니다."
        kind="media"
        entityType="member"
        initial={values.image}
        legacyPath={values.legacyImagePath}
        storageReady={storageReady}
        error={fieldErrors['imageMediaId']}
      />

      <ToggleField
        name="published"
        label="공개"
        defaultChecked={values.published}
        hint="끄면 공개 명단에서 빠집니다."
      />

      <div className={ui.actions}>
        <SubmitButton>{mode === 'create' ? '부원 추가' : '변경사항 저장'}</SubmitButton>
        <Link className={ui.btn} href={cancelHref}>
          취소
        </Link>
      </div>
    </form>
  )
}
