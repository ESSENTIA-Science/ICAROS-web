'use client'

import { useActionState, useId, useRef, useState } from 'react'
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
import { describeUploadFailure, formatDimensions, uploadOne } from './media-upload'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

export type PanelFormPanel = {
  id: string
  /** 이 행의 낙관적 잠금 토큰. 목록 집계 토큰과 다르다. */
  version: string
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
 * 사진은 **여기서 바로 올린다.** 예전에는 이미 있는 `media` 행 중에서 고르는 것만 됐고,
 * 새 사진을 넣으려면 개발자가 `npm run seed:panels` 를 돌려야 했다 — 운영자에게는
 * "메인 사진을 추가할 수 없다"와 같은 말이었다. 고르기 목록은 그대로 남겨 둔다:
 * 같은 사진을 두 패널에 쓰는 경로가 실제로 있고, 지우면 그 경로가 사라진다.
 *
 * 초점은 **사진 위에서 직접 찍는다.** 숫자 두 칸으로 두면 운영자가 그 값이 무엇을 하는지
 * 알 방법이 없다. 클릭한 자리가 곧 `object-position` 이고, 옆의 두 미리보기(데스크톱 16:9 ·
 * 모바일 9:16)가 즉시 다시 그려져 **왜 이 값이 필요한지**를 화면이 설명한다.
 */
export default function PanelForm({
  panel,
  choices,
  storageReady,
}: {
  panel: PanelFormPanel | null
  choices: readonly PanelMediaChoice[]
  /** `S3_BUCKET` 이 설정돼 있는가. 꺼져 있으면 미리 알려 준다 — 눌러 보고 실패하는 것보다 낫다. */
  storageReady: boolean
}) {
  const action = panel ? updatePanel : createPanel
  const [state, formAction] = useActionState<FormState, FormData>(action, null)

  /** 이 화면에서 방금 올린 사진들. 서버가 준 `choices` 에는 당연히 없다. */
  const [uploads, setUploads] = useState<readonly PanelMediaChoice[]>([])
  const [mediaId, setMediaId] = useState(panel?.mediaId ?? choices[0]?.id ?? '')
  const [focalX, setFocalX] = useState(panel?.focalX ?? 50)
  const [focalY, setFocalY] = useState(panel?.focalY ?? 50)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const fileId = useId()
  /** 연속으로 파일을 고르면 늦게 끝난 앞선 업로드가 뒤엣것을 덮어쓸 수 있다. 마지막 것만 채택한다. */
  const runRef = useRef(0)

  /* **업로드분을 고르기 목록과 같은 배열에 합친다.** 아래 미리보기가 이 배열에서 사진을 찾기
     때문이다 — 합치지 않으면 방금 올린 사진은 어디에도 없어서 초점 찍기와 두 크롭 미리보기가
     빈 채로 남고, 운영자는 사진이 안 올라갔다고 읽는다. */
  const gallery: readonly PanelMediaChoice[] = [...uploads, ...choices]
  const picked = gallery.find((c) => c.id === mediaId) ?? null
  const pickedMeta = picked
    ? [formatDimensions(picked.width, picked.height), picked.filename].filter(
        (v): v is string => v !== null && v !== ''
      )
    : []
  const err = state && !state.ok ? state.fieldErrors : undefined

  /**
   * 파일 하나를 올려 media 행까지 확정한다(presign → PUT → confirm).
   *
   * `kind: 'hero'` — 전면 배경 사진이라 `media`(긴 변 512px · 1MB)로는 모자란다.
   * `entityType: 'landing'` — **비우면 안 된다.** `/api/media/[id]` 는 용도를 모르는 미디어를
   * `private, no-store` 로 서빙하므로(`lib/s3/media.ts` 의 `CACHEABLE_ENTITY_TYPES` 허용 목록)
   * 랜딩 사진에 CDN 캐시가 아예 붙지 않는다.
   */
  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    // 같은 파일을 다시 골라도 change 가 발생하도록 즉시 비운다.
    event.target.value = ''
    if (!file) return

    const run = runRef.current + 1
    runRef.current = run

    setBusy(true)
    setFailure(null)
    setStatus('사진을 변환하고 있습니다…')

    try {
      const up = await uploadOne(file, { kind: 'hero', entityType: 'landing' })
      if (runRef.current !== run) return
      setUploads((prev) => [
        { id: up.id, filename: up.filename, width: up.width, height: up.height },
        ...prev,
      ])
      // 올린 사진을 곧바로 이 패널의 사진으로 삼는다. 한 번 더 고르게 할 이유가 없다.
      setMediaId(up.id)
      setStatus('사진을 올렸습니다. 초점을 찍고 저장 버튼을 눌러야 반영됩니다.')
    } catch (e) {
      if (runRef.current !== run) return
      setStatus(null)
      setFailure(describeUploadFailure(e))
    } finally {
      if (runRef.current === run) setBusy(false)
    }
  }

  /** 사진 위 클릭 지점을 0~100 으로 옮긴다. 가장자리를 넘지 않게 잘라 둔다. */
  function pick(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
    setFocalX(clamp(((e.clientX - r.left) / r.width) * 100))
    setFocalY(clamp(((e.clientY - r.top) / r.height) * 100))
  }

  return (
    <form action={formAction}>
      <ActionNotice state={state} />

      {/* 개별 저장은 **그 행의** 토큰을 쓴다. 목록 집계 토큰을 쓰면 다른 패널을 한 번이라도
          고친 뒤부터 저장이 전부 충돌로 막힌다. */}
      {panel ? (
        <>
          <input type="hidden" name="id" value={panel.id} />
          <input type="hidden" name="version" value={panel.version} />
        </>
      ) : null}
      <input type="hidden" name="mediaId" value={mediaId} />
      <input type="hidden" name="focalX" value={focalX} />
      <input type="hidden" name="focalY" value={focalY} />

      {/* ── 1. 사진 ─────────────────────────────────── */}
      <fieldset className={ui.fieldset}>
        <legend lang="en">Photo</legend>

        <div className={ui.field}>
          <label className={ui.label} htmlFor={fileId}>
            사진 올리기
          </label>
          <p className={ui.hint} id={`${fileId}-hint`} lang="ko">
            긴 변 1600px · 2MB 이하 WebP 로 자동 변환됩니다. 올린 사진은 아래 목록 맨 앞에 붙고
            바로 이 패널의 사진이 됩니다.
          </p>
          <input
            className={ui.fileInput}
            id={fileId}
            type="file"
            accept="image/*"
            /* name 을 주지 않는다 — 주면 원본 파일이 Server Action 본문에 통째로 실린다.
               서버로 가는 것은 업로드가 끝난 뒤의 media id 하나뿐이다. */
            onChange={handleUpload}
            disabled={busy}
            aria-describedby={`${fileId}-hint`}
          />

          {!storageReady ? (
            <p className={ui.mediaWarn} lang="ko">
              이미지 저장소가 아직 구성되지 않아(S3_BUCKET 미설정) 업로드가 실패합니다. 이미 올라와
              있는 사진은 그대로 고를 수 있습니다.
            </p>
          ) : null}

          <p className={ui.mediaStatus} aria-live="polite">
            {busy ? '업로드 중…' : (status ?? '')}
          </p>

          {failure ? (
            <p className={ui.error} role="alert">
              {failure}
            </p>
          ) : null}
        </div>

        {gallery.length === 0 ? (
          <p className={ui.empty} lang="ko">
            아직 사진이 없습니다. 위에서 한 장 올리면 패널을 만들 수 있습니다 — 패널은 사진이
            있어야 성립합니다.
          </p>
        ) : (
          <>
            <p className={ui.hint} lang="ko">
              이미 올라와 있는 사진에서 고를 수도 있습니다. 같은 사진을 여러 패널이 함께 써도
              됩니다.
            </p>
            <div className={ui.panelPickRow}>
              {gallery.map((c) => (
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
          </>
        )}

        {picked && picked.width !== null && picked.height !== null ? (
          <>
            {pickedMeta.length > 0 ? <p className={ui.mediaMeta}>{pickedMeta.join(' · ')}</p> : null}

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
        {/* 업로드가 끝나기 전에 저장하면 방금 고른 사진 없이 저장된다. 사진이 없으면 어차피
            서버가 거부하므로, 왕복 한 번을 아끼고 여기서 막는다. */}
        <SubmitButton disabled={busy || mediaId === ''}>{panel ? '저장' : '만들기'}</SubmitButton>
        <Link className={ui.btn} href="/admin?tab=panels">
          취소
        </Link>
      </div>
    </form>
  )
}
