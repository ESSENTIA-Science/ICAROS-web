'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { createSceneModelAction, updateSceneModelAction } from '@/app/admin/_actions/scene'
import type { FormState } from '@/app/admin/_actions/result'
import { SelectField, TextField, ToggleField } from '../Fields'
import { ActionNotice } from '../Notice'
import SubmitButton from '../SubmitButton'
import ui from '../ui.module.css'
import {
  ANIMATION_CLIP_MAX,
  LABEL_MAX,
  NUMBER_INPUT_MAX,
  SCENE_ENVIRONMENTS,
  SCENE_ENVIRONMENT_LABELS,
} from './constants'
import ExtrasEditor, { type ExtraInit } from './ExtrasEditor'
import HotspotEditor, { type HotspotInit } from './HotspotEditor'
import PresetEditor, { type PresetInit } from './PresetEditor'
import css from './scene.module.css'

export type ModelFormValues = {
  id: string
  label: string
  rocketId: string
  glbMediaId: string
  posterMediaId: string
  scale: string
  positionX: string
  positionY: string
  positionZ: string
  rotationX: string
  rotationY: string
  rotationZ: string
  cameraX: string
  cameraY: string
  cameraZ: string
  targetX: string
  targetY: string
  targetZ: string
  fov: string
  environment: string
  exposure: string
  ambientIntensity: string
  keyIntensity: string
  autoRotate: boolean
  animationClip: string
  enabledDesktop: boolean
  enabledMobile: boolean
  presets: readonly PresetInit[]
  extras: readonly ExtraInit[]
  hotspots: readonly HotspotInit[]
}

export type RocketChoice = { id: string; name: string; series: string }

const NO_ERRORS: Readonly<Record<string, string>> = {}

const ENVIRONMENT_OPTIONS = SCENE_ENVIRONMENTS.map((e) => ({
  value: e,
  label: SCENE_ENVIRONMENT_LABELS[e],
}))

/**
 * 3D Scene 설정 폼 (F9 / G1~G14).
 *
 * **뷰어가 아니라 설정 폼이다** (F13). three/R3F 는 이 레포에 설치돼 있지도 않고,
 * 관리 화면이 WebGL 을 요구하면 GPU 없는 장비에서 CMS 자체를 못 쓴다.
 * 대신 값을 읽을 수 있게 만든다 — 프리셋은 `at` 순 타임라인으로, 범위 위반은 그 자리 경고로.
 *
 * `<form action={…}>` 에 서버 액션을 직접 물린다. 성공하면 액션이 redirect 하므로
 * 이전 오류가 화면에 남을 자리가 없다.
 */
export default function ModelForm({
  mode,
  values,
  rockets,
  version,
  cancelHref,
}: {
  mode: 'create' | 'edit'
  values: ModelFormValues
  rockets: readonly RocketChoice[]
  /** 수정일 때만 존재하는 낙관적 잠금 토큰 (F12). */
  version?: string
  cancelHref: string
}) {
  const action = mode === 'create' ? createSceneModelAction : updateSceneModelAction
  const [state, formAction] = useActionState<FormState, FormData>(action, null)
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? NO_ERRORS) : NO_ERRORS

  const rocketOptions = [
    { value: '', label: '연결 안 함' },
    ...rockets.map((r) => ({ value: r.id, label: `${r.name} (${r.id} · ${r.series})` })),
  ]

  return (
    <form action={formAction} noValidate>
      <ActionNotice state={state} />

      {mode === 'edit' ? <input type="hidden" name="id" value={values.id} /> : null}
      {version ? <input type="hidden" name="version" value={version} /> : null}

      <div className={ui.grid}>
        <TextField
          name="label"
          label="모델 이름"
          defaultValue={values.label}
          hint="관리용 이름입니다. 공개 화면에는 로켓 이름이 쓰입니다."
          required
          maxLength={LABEL_MAX}
          error={fieldErrors['label']}
        />
        <SelectField
          name="rocketId"
          label="연결 로켓"
          defaultValue={values.rocketId}
          options={rocketOptions}
          hint="연결하면 해당 로켓 상세에서 이 모델을 씁니다. 범용 모델이면 비워 둡니다."
          error={fieldErrors['rocketId']}
        />
      </div>

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend} lang="en">
          Assets
        </legend>
        <p className={ui.hint}>
          업로드 위젯이 붙기 전까지는 업로드 후 발급된 <span className={ui.mono}>media id</span> 를 직접
          입력합니다. 저장할 때 서버가 실제 파일인지, 형식과 상태가 맞는지 확인합니다.
        </p>
        <div className={ui.grid}>
          <TextField
            name="glbMediaId"
            label="GLB media id"
            defaultValue={values.glbMediaId}
            hint="비우면 3D 없이 포스터만 씁니다. 교체하면 카메라·스케일 값이 새 모델에 맞는지 다시 봐야 합니다."
            mono
            maxLength={36}
            error={fieldErrors['glbMediaId']}
          />
          <TextField
            name="posterMediaId"
            label="포스터 media id"
            defaultValue={values.posterMediaId}
            hint="WebGL 을 못 쓰거나 3D 를 끈 화면에서 대신 보이는 정지 이미지입니다."
            mono
            maxLength={36}
            error={fieldErrors['posterMediaId']}
          />
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend} lang="en">
          Transform
        </legend>
        <div className={ui.grid}>
          <TextField
            name="scale"
            label="scale"
            defaultValue={values.scale}
            hint="0 보다 커야 합니다."
            inputMode="decimal"
            maxLength={NUMBER_INPUT_MAX}
            mono
            required
            error={fieldErrors['scale']}
          />
        </div>

        <div className={css.vecBlock}>
          <p className={css.vecLegend} lang="en">
            Position
          </p>
          <div className={css.vecGrid}>
            <TextField name="positionX" label="x" defaultValue={values.positionX} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['positionX']} />
            <TextField name="positionY" label="y" defaultValue={values.positionY} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['positionY']} />
            <TextField name="positionZ" label="z" defaultValue={values.positionZ} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['positionZ']} />
          </div>
        </div>

        <div className={css.vecBlock}>
          <p className={css.vecLegend} lang="en">
            Rotation (rad)
          </p>
          <div className={css.vecGrid}>
            <TextField name="rotationX" label="x" defaultValue={values.rotationX} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['rotationX']} />
            <TextField name="rotationY" label="y" defaultValue={values.rotationY} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['rotationY']} />
            <TextField name="rotationZ" label="z" defaultValue={values.rotationZ} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['rotationZ']} />
          </div>
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend} lang="en">
          Camera
        </legend>
        <p className={ui.hint}>
          프리셋이 하나도 없을 때 쓰이는 기본 시점입니다. 프리셋이 있으면 스크롤에 따라 이 값에서
          출발해 프리셋을 따라갑니다.
        </p>

        <div className={css.vecBlock}>
          <p className={css.vecLegend} lang="en">
            Position
          </p>
          <div className={css.vecGrid}>
            <TextField name="cameraX" label="x" defaultValue={values.cameraX} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['cameraX']} />
            <TextField name="cameraY" label="y" defaultValue={values.cameraY} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['cameraY']} />
            <TextField name="cameraZ" label="z" defaultValue={values.cameraZ} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['cameraZ']} />
          </div>
        </div>

        <div className={css.vecBlock}>
          <p className={css.vecLegend} lang="en">
            Look-at target
          </p>
          <div className={css.vecGrid}>
            <TextField name="targetX" label="x" defaultValue={values.targetX} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['targetX']} />
            <TextField name="targetY" label="y" defaultValue={values.targetY} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['targetY']} />
            <TextField name="targetZ" label="z" defaultValue={values.targetZ} inputMode="decimal" maxLength={NUMBER_INPUT_MAX} mono error={fieldErrors['targetZ']} />
          </div>
        </div>

        <div className={ui.grid}>
          <TextField
            name="fov"
            label="fov (도)"
            defaultValue={values.fov}
            hint="0 초과 180 미만."
            inputMode="decimal"
            maxLength={NUMBER_INPUT_MAX}
            mono
            required
            error={fieldErrors['fov']}
          />
        </div>
      </fieldset>

      <PresetEditor initial={values.presets} fieldErrors={fieldErrors} />

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend} lang="en">
          Lighting
        </legend>
        <div className={ui.grid}>
          <SelectField
            name="environment"
            label="환경 프리셋"
            defaultValue={values.environment}
            options={ENVIRONMENT_OPTIONS}
            required
            error={fieldErrors['environment']}
          />
          <TextField
            name="exposure"
            label="노출 (exposure)"
            defaultValue={values.exposure}
            inputMode="decimal"
            maxLength={NUMBER_INPUT_MAX}
            mono
            required
            error={fieldErrors['exposure']}
          />
        </div>
        <div className={ui.grid}>
          <TextField
            name="ambientIntensity"
            label="환경광 세기"
            defaultValue={values.ambientIntensity}
            inputMode="decimal"
            maxLength={NUMBER_INPUT_MAX}
            mono
            required
            error={fieldErrors['ambientIntensity']}
          />
          <TextField
            name="keyIntensity"
            label="키라이트 세기"
            defaultValue={values.keyIntensity}
            inputMode="decimal"
            maxLength={NUMBER_INPUT_MAX}
            mono
            required
            error={fieldErrors['keyIntensity']}
          />
        </div>
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend} lang="en">
          Playback
        </legend>
        <ToggleField
          name="autoRotate"
          label="자동 회전"
          defaultChecked={values.autoRotate}
          hint="켜면 사용자가 조작하지 않을 때 모델이 천천히 돕니다."
        />
        <TextField
          name="animationClip"
          label="애니메이션 클립 이름 (선택)"
          defaultValue={values.animationClip}
          hint="GLB 안에 들어 있는 클립 이름을 그대로 적습니다. 비우면 재생하지 않습니다."
          mono
          maxLength={ANIMATION_CLIP_MAX}
          error={fieldErrors['animationClip']}
        />
      </fieldset>

      <fieldset className={ui.fieldset}>
        <legend className={ui.legend} lang="en">
          Viewport
        </legend>
        <ToggleField
          name="enabledDesktop"
          label="데스크톱에서 3D 사용"
          defaultChecked={values.enabledDesktop}
          hint="끄면 데스크톱에서도 포스터 이미지만 보여 줍니다."
        />
        <ToggleField
          name="enabledMobile"
          label="모바일에서 3D 사용"
          defaultChecked={values.enabledMobile}
          hint="기본값은 꺼짐입니다. 모바일에 WebGL 을 강제하면 발열·배터리 소모·저사양 단말 크래시로 이어지고, 실패했을 때 사용자에게 보이는 것은 빈 화면뿐입니다. 켜려면 포스터 이미지를 먼저 지정해 대체 화면을 확보해 주세요."
        />
      </fieldset>

      <HotspotEditor initial={values.hotspots} fieldErrors={fieldErrors} />

      <ExtrasEditor initial={values.extras} fieldErrors={fieldErrors} />

      <div className={ui.actions}>
        <SubmitButton>{mode === 'create' ? '모델 추가' : '변경사항 저장'}</SubmitButton>
        <Link className={ui.btn} href={cancelHref}>
          취소
        </Link>
      </div>
    </form>
  )
}
