'use client'

import { useActionState, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'

import { createPanel, updatePanel } from '@/app/admin/_actions/panels'
import type { FormState } from '@/app/admin/_actions/result'
import {
  PANEL_ANCHORS,
  PANEL_CTA_HREFS,
  PANEL_HEIGHTS,
  PANEL_SCRIMS,
} from '@/lib/db/schema/panels'
import { SelectField, TextAreaField, TextField } from './Fields'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

export type PanelFormPanel = {
  id: string
  mediaId: string
  mediaWidth: number | null
  mediaHeight: number | null
  focalX: number
  focalY: number
  scrim: string
  anchor: string
  height: string
  eyebrow: string | null
  headline: string
  body: string | null
  ctaLabel: string | null
  ctaHref: string | null
}

export type PanelMediaChoice = {
  id: string
  filename: string | null
  width: number | null
  height: number | null
}

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }))

/**
 * 패널 편집 폼.
 *
 * **사진을 먼저 고른다.** `media_id` 가 NOT NULL 이라 사진 없이는 패널이 성립하지 않고,
 * 폼도 그 순서를 강제한다 — 글부터 쓰게 두면 다 쓰고 나서 저장이 막힌다.
 *
 * 초점은 **사진 위에서 직접 찍는다.** 숫자 두 칸으로 두면 운영자가 그 값이 무엇을 하는지
 * 알 방법이 없다. 클릭한 자리가 곧 `object-position` 이고, 옆의 두 미리보기(데스크톱 16:9 ·
 * 모바일 9:16)가 즉시 다시 그려져 **왜 이 값이 필요한지**를 화면이 설명한다.
 */
export default function PanelForm({
  panel,
  version,
  choices,
}: {
  panel: PanelFormPanel | null
  version: string
  choices: readonly PanelMediaChoice[]
}) {
  const action = panel ? updatePanel : createPanel
  const [state, formAction] = useActionState<FormState, FormData>(action, null)

  const [mediaId, setMediaId] = useState(panel?.mediaId ?? choices[0]?.id ?? '')
  const [focalX, setFocalX] = useState(panel?.focalX ?? 50)
  const [focalY, setFocalY] = useState(panel?.focalY ?? 50)

  const picked = choices.find((c) => c.id === mediaId) ?? null
  const err = state && !state.ok ? state.fieldErrors : undefined

  /** 사진 위 클릭 지점을 0~100 으로 옮긴다. 가장자리를 넘지 않게 잘라 둔다. */
  function pick(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
    setFocalX(clamp(((e.clientX - r.left) / r.width) * 100))
    setFocalY(clamp(((e.clientY - r.top) / r.height) * 100))
  }

  if (choices.length === 0) {
    return (
      <div>
        <p className={ui.empty} lang="ko">
          붙일 수 있는 사진이 없습니다. 패널은 사진이 있어야 만들 수 있습니다 — 먼저 Rockets 나
          Members 탭에서 사진을 올려 확정한 뒤 다시 오세요.
        </p>
        <Link className={ui.btn} href="/admin?tab=panels">
          목록으로
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className={ui.form}>
      <ActionNotice state={state} />

      {panel ? <input type="hidden" name="id" value={panel.id} /> : null}
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="mediaId" value={mediaId} />
      <input type="hidden" name="focalX" value={focalX} />
      <input type="hidden" name="focalY" value={focalY} />

      {/* ── 1. 사진 ─────────────────────────────────── */}
      <fieldset className={ui.fieldset}>
        <legend lang="en">Photo</legend>

        <div className={ui.panelPickRow}>
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className={ui.panelPick}
              aria-pressed={c.id === mediaId}
              onClick={() => setMediaId(c.id)}
              title={c.filename ?? c.id}
            >
              {c.width !== null && c.height !== null ? (
                <Image src={`/api/media/${c.id}`} width={c.width} height={c.height} alt="" sizes="120px" />
              ) : (
                <span lang="ko">크기 미확정</span>
              )}
            </button>
          ))}
        </div>

        {picked && picked.width !== null && picked.height !== null ? (
          <>
            <p className={ui.hint} lang="ko">
              사진을 눌러 <b>초점</b>을 찍으세요. 지금 값은 {focalX} / {focalY} 입니다. 같은 사진이
              데스크톱에서는 가로로, 모바일에서는 세로로 잘립니다 — 무엇이 주인공인지는 사람만 압니다.
            </p>

            <button type="button" className={ui.panelFocal} onClick={pick} aria-label="초점 위치 고르기">
              <Image
                src={`/api/media/${picked.id}`}
                width={picked.width}
                height={picked.height}
                alt=""
                sizes="640px"
              />
              <span className={ui.panelCross} style={{ left: `${focalX}%`, top: `${focalY}%` }} aria-hidden="true" />
            </button>

            <div className={ui.panelCrops}>
              <span className={ui.panelCrop} data-ratio="wide">
                <Image
                  src={`/api/media/${picked.id}`}
                  width={picked.width}
                  height={picked.height}
                  alt=""
                  sizes="320px"
                  style={{ objectPosition: `${focalX}% ${focalY}%` }}
                />
                <em lang="en">16 : 9</em>
              </span>
              <span className={ui.panelCrop} data-ratio="tall">
                <Image
                  src={`/api/media/${picked.id}`}
                  width={picked.width}
                  height={picked.height}
                  alt=""
                  sizes="200px"
                  style={{ objectPosition: `${focalX}% ${focalY}%` }}
                />
                <em lang="en">9 : 16</em>
              </span>
            </div>
          </>
        ) : null}
      </fieldset>

      {/* ── 2. 글 ───────────────────────────────────── */}
      <fieldset className={ui.fieldset}>
        <legend lang="en">Text</legend>

        <TextField
          name="eyebrow"
          label="윗줄"
          hint="작게 넓은 자간으로 나갑니다. 비워도 됩니다."
          defaultValue={panel?.eyebrow ?? ''}
          maxLength={200}
          error={err?.['eyebrow']}
        />
        <TextAreaField
          name="headline"
          label="헤드라인"
          required
          rows={2}
          hint="대문자로 크게 나갑니다. 줄바꿈을 넣으면 그 자리에서 끊깁니다 — 어디서 끊을지는 사람이 정합니다."
          defaultValue={panel?.headline ?? ''}
          maxLength={200}
          error={err?.['headline']}
        />
        <TextAreaField
          name="body"
          label="본문"
          rows={3}
          hint="한 호흡에 읽히는 길이를 넘으면 사진을 가리는 판때기가 됩니다. 긴 설명은 하위 페이지에 두세요."
          defaultValue={panel?.body ?? ''}
          maxLength={600}
          error={err?.['body']}
        />
      </fieldset>

      {/* ── 3. 조판 ─────────────────────────────────── */}
      <fieldset className={ui.fieldset}>
        <legend lang="en">Layout</legend>

        <SelectField
          name="scrim"
          label="그늘"
          hint="흰 글자를 사진 위에 얹으므로 사진 밝기마다 필요한 그늘이 다릅니다."
          defaultValue={panel?.scrim ?? 'bottom'}
          options={opts(PANEL_SCRIMS)}
          error={err?.['scrim']}
        />
        <SelectField
          name="anchor"
          label="글 위치"
          hint="사진마다 비어 있는 자리가 다릅니다. 인물이 아래쪽에 있으면 글을 위로 올리세요."
          defaultValue={panel?.anchor ?? 'bottom-left'}
          options={opts(PANEL_ANCHORS)}
          error={err?.['anchor']}
        />
        <SelectField
          name="height"
          label="높이"
          defaultValue={panel?.height ?? 'full'}
          options={opts(PANEL_HEIGHTS)}
          error={err?.['height']}
        />
      </fieldset>

      {/* ── 4. CTA ──────────────────────────────────── */}
      <fieldset className={ui.fieldset}>
        <legend lang="en">Call to action</legend>
        <p className={ui.hint} lang="ko">
          라벨과 링크는 <b>함께 채우거나 함께 비웁니다.</b> 한쪽만 있으면 화면에 죽은 버튼이 뜹니다.
          링크는 목록에 있는 경로만 고를 수 있습니다 — 라우트 없는 링크를 만들 수 없게 하기 위해서입니다.
        </p>
        <TextField
          name="ctaLabel"
          label="버튼 라벨"
          defaultValue={panel?.ctaLabel ?? ''}
          maxLength={60}
          error={err?.['ctaLabel']}
        />
        <SelectField
          name="ctaHref"
          label="링크"
          defaultValue={panel?.ctaHref ?? ''}
          options={[{ value: '', label: '— 없음 —' }, ...opts(PANEL_CTA_HREFS)]}
          error={err?.['ctaHref']}
        />
      </fieldset>

      <div className={ui.actions}>
        <SubmitButton>{panel ? '저장' : '만들기'}</SubmitButton>
        <Link className={ui.btn} href="/admin?tab=panels">
          취소
        </Link>
      </div>
    </form>
  )
}
