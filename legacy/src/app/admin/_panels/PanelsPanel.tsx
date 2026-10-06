import Image from 'next/image'
import Link from 'next/link'

import ui from '@/components/admin/ui.module.css'
import PanelForm from '@/components/admin/PanelForm'
import PanelRowActions from '@/components/admin/PanelRowActions'
import { isStorageConfigured } from '@/lib/s3/config'
import { getPanel, listPanelMediaChoices, listPanels, panelsVersion } from '../_data/panels'
import { adminHref } from '../_tabs'

/**
 * 랜딩 패널 관리 (F1).
 *
 * **사진이 행의 주인공이다.** 제목이 먼저 오는 표로 만들면 운영자가 "몇 번째 패널"을
 * 사진이 아니라 글로 찾게 되고, 그 순간 이 모델의 요점이 사라진다 — 랜딩은 사진의 배열이지
 * 문서가 아니다. 그래서 썸네일을 크게 두고, 그 썸네일에 그 패널의 초점을 그대로 걸어
 * 목록에서 이미 **실제 크롭**을 보게 한다.
 *
 * 상태는 전부 URL 쿼리다(`?tab=panels&new=1&edit=<id>&delete=<id>`). 다른 탭과 같은 규칙이고,
 * 그래서 이 패널에도 클라이언트 JS 가 폼 잎 밖에는 없다.
 */
export default async function PanelsPanel({
  create,
  editId,
  deleteId,
  saved,
}: {
  create: boolean
  editId?: string
  deleteId?: string
  saved?: string
}) {
  const [panels, version, choices] = await Promise.all([
    listPanels(),
    panelsVersion(),
    listPanelMediaChoices(),
  ])

  const editing = editId ? await getPanel(editId) : null
  const published = panels.filter((p) => p.published).length

  if (create || editing) {
    return (
      <section className={ui.card}>
        <h2 className={ui.cardTitle} lang="en">
          {editing ? 'Edit Panel' : 'New Panel'}
        </h2>
        <PanelForm panel={editing} choices={choices} storageReady={isStorageConfigured()} />
      </section>
    )
  }

  return (
    <section className={ui.card}>
      <div className={ui.panelHead}>
        <h2 className={ui.cardTitle} lang="en">
          Landing Panels
        </h2>
        <Link className={ui.btnPrimary} href={adminHref({ tab: 'panels', create: true })}>
          패널 추가
        </Link>
      </div>

      {saved ? <p className={ui.notice}>{saved}</p> : null}

      <p className={ui.hint} lang="ko">
        랜딩은 이 배열입니다. 위에서 아래 순서로 그려지고, <b>공개된 {published}장</b>만 나갑니다.
        패널에는 사진이 반드시 있어야 합니다 — 글만 있는 패널은 만들 수 없습니다. 사진은 패널을
        만들거나 고칠 때 그 화면에서 바로 올립니다.
      </p>

      {panels.length === 0 ? (
        <p className={ui.empty} lang="ko">
          아직 패널이 없습니다. 패널이 하나도 공개되지 않으면 랜딩은 기존 3D 히어로와 섹션으로
          그려집니다.
        </p>
      ) : (
        <ul className={ui.panelList}>
          {panels.map((p, i) => (
            <li key={p.id} className={ui.panelRow} data-off={p.published ? undefined : ''}>
              <span className={ui.panelNo}>{String(i + 1).padStart(2, '0')}</span>

              {/* 썸네일에 초점을 그대로 걸어 목록에서 실제 크롭을 본다.
                  가운데 크롭으로 그리면 목록에서는 멀쩡한데 랜딩에서만 잘리는 사진이 생긴다. */}
              <span className={ui.panelThumb}>
                {p.mediaWidth !== null && p.mediaHeight !== null ? (
                  <Image
                    src={`/api/media/${p.mediaId}`}
                    width={p.mediaWidth}
                    height={p.mediaHeight}
                    alt=""
                    sizes="320px"
                    style={{ objectPosition: `${p.focalX}% ${p.focalY}%` }}
                  />
                ) : (
                  <span className={ui.panelThumbEmpty} lang="ko">
                    크기 미확정
                  </span>
                )}
              </span>

              <span className={ui.panelBody}>
                {p.eyebrow ? (
                  <span className={ui.panelEyebrow} lang="en">
                    {p.eyebrow}
                  </span>
                ) : null}
                <span className={ui.panelHeadline} lang="en">
                  {p.headline}
                </span>
                <span className={ui.panelMeta}>
                  {p.scrim} · {p.anchor} · {p.height} · focal {p.focalX}/{p.focalY}
                  {p.ctaHref ? <> · {p.ctaHref}</> : null}
                </span>
              </span>

              <PanelRowActions
                id={p.id}
                version={version}
                published={p.published}
                first={i === 0}
                last={i === panels.length - 1}
                confirmDelete={deleteId === p.id}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
