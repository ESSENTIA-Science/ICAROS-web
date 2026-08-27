import Link from 'next/link'
import DeleteConfirm from '@/components/admin/DeleteConfirm'
import Notice from '@/components/admin/Notice'
import RocketForm from '@/components/admin/RocketForm'
import ui from '@/components/admin/ui.module.css'
import { isStorageConfigured } from '@/lib/s3/config'
import { deleteRocketAction } from '../_actions/rockets'
import { getMediaRef, listRocketGallery } from '../_data/media'
import {
  getRocketForAdmin,
  listRocketSeriesOptions,
  listRocketsForAdmin,
  type AdminRocketListItem,
} from '../_data/rockets'
import { adminHref, type AdminSubview } from '../_tabs'
import RocketSeriesPanel from './RocketSeriesPanel'

const LIST_HREF = adminHref({ tab: 'rockets' })
const SERIES_HREF = adminHref({ tab: 'rockets', sub: 'series' })

/** 목록 한 줄에 붙는 요약. 값이 없는 항목은 아예 넣지 않는다 — `— m` 같은 빈 단위를 보여 주지 않는다. */
function specSummary(r: AdminRocketListItem): string {
  const parts: string[] = []
  if (r.maxAltitudeM) parts.push(`고도 ${trim(r.maxAltitudeM)}m`)
  if (r.sizeM) parts.push(`전장 ${trim(r.sizeM)}m`)
  if (r.payloadKg) parts.push(`페이로드 ${trim(r.payloadKg)}kg`)
  parts.push(`엔진 ${r.engineCount}`)
  return parts.join(' · ')
}

function trim(v: string): string {
  return v.includes('.') ? v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : v
}

export default async function RocketsPanel({
  sub,
  create,
  editId,
  deleteId,
  saved,
}: {
  sub: AdminSubview | undefined
  create: boolean
  editId: string | undefined
  deleteId: string | undefined
  saved: string | undefined
}) {
  // 카테고리 관리는 같은 탭의 하위 화면이다. 판정을 맨 앞에 두어 아래 분기가 섞이지 않게 한다.
  if (sub === 'series') {
    return (
      <RocketSeriesPanel create={create} editId={editId} deleteId={deleteId} saved={saved} />
    )
  }

  // 설정 여부만 읽는다. 버킷 이름·리전은 화면에 절대 나가지 않는다.
  const storageReady = isStorageConfigured()

  if (create) {
    const seriesOptions = await listRocketSeriesOptions()
    // 카테고리가 없으면 로켓을 만들 수 없다. 폼을 띄워 놓고 저장에서 막는 것보다
    // 여기서 할 일을 알려 주는 편이 낫다 — 저장 실패 문구로는 무엇을 해야 할지 안 보인다.
    if (seriesOptions.length === 0) {
      return (
        <>
          <Notice tone="error">
            등록된 카테고리가 없어 로켓을 만들 수 없습니다. 카테고리를 먼저 하나 추가해 주세요.
          </Notice>
          <Link className={`${ui.btn} ${ui.btnPrimary}`} href={SERIES_HREF}>
            카테고리 관리
          </Link>
        </>
      )
    }
    const firstSeries = seriesOptions[0]?.id ?? ''
    return (
      <>
        <div className={ui.panelHead}>
          <h2 className={ui.panelTitle}>새 로켓</h2>
        </div>
        <div className={ui.card}>
          <RocketForm
            mode="create"
            cancelHref={LIST_HREF}
            storageReady={storageReady}
            seriesOptions={seriesOptions}
            seriesHref={SERIES_HREF}
            values={{
              id: '',
              name: '',
              series: firstSeries,
              sortOrder: 0,
              published: true,
              descriptionMd: '',
              maxAltitudeM: '',
              sizeM: '',
              payloadKg: '',
              cover: null,
              legacyImagePath: null,
              gallery: [],
              engines: [],
            }}
          />
        </div>
      </>
    )
  }

  if (editId !== undefined) {
    const [rocket, seriesOptions] = await Promise.all([
      getRocketForAdmin(editId),
      listRocketSeriesOptions(),
    ])
    if (!rocket) {
      return (
        <>
          <Notice tone="error">
            해당 로켓을 찾을 수 없습니다. 다른 곳에서 이미 삭제되었을 수 있습니다.
          </Notice>
          <Link className={ui.btn} href={LIST_HREF}>
            목록으로
          </Link>
        </>
      )
    }

    // 대표 이미지와 갤러리는 로켓 행을 읽은 뒤에야 조회할 수 있다(둘 다 로켓 id 를 쓴다).
    const [cover, gallery] = await Promise.all([
      getMediaRef(rocket.coverMediaId),
      listRocketGallery(rocket.id, rocket.coverMediaId),
    ])

    return (
      <>
        <div className={ui.panelHead}>
          <div>
            <h2 className={ui.panelTitle}>{rocket.name}</h2>
            <p className={ui.panelLede}>
              <span className={ui.mono}>/rocket/{rocket.id}</span>
            </p>
          </div>
        </div>
        <div className={ui.card}>
          <RocketForm
            mode="edit"
            cancelHref={LIST_HREF}
            version={rocket.version}
            storageReady={storageReady}
            seriesOptions={seriesOptions}
            seriesHref={SERIES_HREF}
            values={{
              id: rocket.id,
              name: rocket.name,
              series: rocket.series,
              sortOrder: rocket.sortOrder,
              published: rocket.published,
              descriptionMd: rocket.descriptionMd,
              maxAltitudeM: rocket.maxAltitudeM,
              sizeM: rocket.sizeM,
              payloadKg: rocket.payloadKg,
              cover,
              legacyImagePath: rocket.legacyImagePath,
              gallery,
              engines: rocket.engines.map((e) => ({
                type: e.type,
                thrustN: e.thrustN,
                burnTimeS: e.burnTimeS,
                count: e.count,
                mode: e.mode,
              })),
            }}
          />
        </div>
      </>
    )
  }

  const rockets = await listRocketsForAdmin()
  const target = deleteId !== undefined ? rockets.find((r) => r.id === deleteId) : undefined

  return (
    <>
      <div className={ui.panelHead}>
        <div>
          <h2 className={ui.panelTitle} lang="en">
            Rockets
          </h2>
          <p className={ui.panelLede}>
            공개 목록은 시리즈별로 나뉘고 정렬순서를 따릅니다. 비공개 로켓은 목록과 직접 URL
            양쪽에서 보이지 않습니다.
          </p>
        </div>
        <div className={ui.rowActions}>
          <Link className={ui.btn} href={SERIES_HREF}>
            카테고리 관리
          </Link>
          <Link
            className={`${ui.btn} ${ui.btnPrimary}`}
            href={adminHref({ tab: 'rockets', create: true })}
          >
            새 로켓
          </Link>
        </div>
      </div>

      {saved === 'deleted' ? <Notice tone="ok">로켓을 삭제했습니다.</Notice> : null}
      {saved !== undefined && saved !== 'deleted' ? (
        <Notice tone="ok">저장했습니다. 공개 페이지에 반영되었습니다.</Notice>
      ) : null}

      {target ? (
        <DeleteConfirm
          action={deleteRocketAction}
          id={target.id}
          title={target.name}
          description="등록된 엔진 정보와 대표 이미지·갤러리도 함께 삭제됩니다."
          cancelHref={LIST_HREF}
        />
      ) : null}

      {deleteId !== undefined && !target ? (
        <Notice tone="error">삭제하려는 로켓을 찾을 수 없습니다.</Notice>
      ) : null}

      <div className={ui.list}>
        {rockets.length === 0 ? (
          <p className={ui.empty}>등록된 로켓이 없습니다.</p>
        ) : (
          rockets.map((r) => (
            <div className={ui.row} key={r.id}>
              <div className={ui.rowMain}>
                <p className={ui.rowName}>
                  {r.name}
                  <span className={`${ui.badge} ${ui.badgeSeries}`} lang="en">
                    {r.seriesLabel}
                  </span>
                  {r.published ? null : (
                    <span className={`${ui.badge} ${ui.badgeOff}`}>비공개</span>
                  )}
                </p>
                <p className={ui.rowMeta}>
                  <span className={ui.mono}>{r.id}</span> · 순서 {r.sortOrder} · {specSummary(r)}
                </p>
              </div>
              <div className={ui.rowActions}>
                <Link
                  className={`${ui.btn} ${ui.btnSmall}`}
                  href={adminHref({ tab: 'rockets', edit: r.id })}
                >
                  편집
                </Link>
                <Link
                  className={`${ui.btn} ${ui.btnSmall}`}
                  href={adminHref({ tab: 'rockets', remove: r.id })}
                >
                  삭제
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
