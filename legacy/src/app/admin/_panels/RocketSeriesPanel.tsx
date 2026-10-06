import Link from 'next/link'
import DeleteConfirm from '@/components/admin/DeleteConfirm'
import Notice from '@/components/admin/Notice'
import RocketSeriesForm from '@/components/admin/RocketSeriesForm'
import ui from '@/components/admin/ui.module.css'
import { deleteRocketSeriesAction } from '../_actions/rocket-series'
import {
  listRocketSeriesForAdmin,
  listVehicleTypeOptions,
  nextRocketSeriesSortOrder,
} from '../_data/rockets'
import { adminHref } from '../_tabs'

const LIST_HREF = adminHref({ tab: 'rockets', sub: 'series' })
const TYPES_HREF = adminHref({ tab: 'rockets', sub: 'types' })
const VEHICLES_HREF = adminHref({ tab: 'rockets' })

/**
 * 시리즈(카테고리) 관리 — Vehicles 탭의 하위 화면(`?tab=rockets&sub=series`).
 *
 * 기체 폼 안에 인라인으로 넣지 않았다. HTML 폼은 중첩할 수 없어서 기체 폼 안에 시리즈 폼을
 * 두려면 클라이언트 JS 로 제출을 가로채야 하는데, 그러면 이 콘솔에서 유일하게 JS 없이는
 * 동작하지 않는 화면이 된다. 대신 기체 폼에서 링크로 건너오고, 저장하면 다시 돌아간다.
 * 상위 분류(`?sub=types`)도 같은 이유로 여기서 다시 링크로 건너간다.
 */
export default async function RocketSeriesPanel({
  create,
  editId,
  deleteId,
  saved,
}: {
  create: boolean
  editId: string | undefined
  deleteId: string | undefined
  saved: string | undefined
}) {
  if (create) {
    const [sortOrder, typeOptions] = await Promise.all([
      nextRocketSeriesSortOrder(),
      listVehicleTypeOptions(),
    ])
    /**
     * 분류가 없으면 시리즈를 만들 수 없다 — `type_id` 가 NOT NULL 이다.
     * 폼을 띄워 놓고 저장에서 막는 것보다 여기서 할 일을 알려 주는 편이 낫다
     * (`RocketsPanel` 이 시리즈가 0개일 때 하는 것과 같은 처리다).
     */
    if (typeOptions.length === 0) {
      return (
        <>
          <Notice tone="error">
            등록된 분류가 없어 시리즈를 만들 수 없습니다. 분류를 먼저 하나 추가해 주세요.
          </Notice>
          <Link className={`${ui.btn} ${ui.btnPrimary}`} href={TYPES_HREF}>
            분류 관리
          </Link>
        </>
      )
    }
    const firstType = typeOptions[0]?.id ?? ''
    return (
      <>
        <div className={ui.panelHead}>
          <h2 className={ui.panelTitle}>새 시리즈</h2>
        </div>
        <div className={ui.card}>
          <RocketSeriesForm
            mode="create"
            cancelHref={LIST_HREF}
            typeOptions={typeOptions}
            typesHref={TYPES_HREF}
            values={{ id: '', label: '', typeId: firstType, descriptionMd: '', sortOrder }}
          />
        </div>
      </>
    )
  }

  const series = await listRocketSeriesForAdmin()

  if (editId !== undefined) {
    const row = series.find((s) => s.id === editId)
    if (!row) {
      return (
        <>
          <Notice tone="error">
            해당 시리즈를 찾을 수 없습니다. 다른 곳에서 이미 삭제되었을 수 있습니다.
          </Notice>
          <Link className={ui.btn} href={LIST_HREF}>
            목록으로
          </Link>
        </>
      )
    }

    const typeOptions = await listVehicleTypeOptions()

    return (
      <>
        <div className={ui.panelHead}>
          <div>
            <h2 className={ui.panelTitle}>{row.label}</h2>
            <p className={ui.panelLede}>
              <span className={ui.mono}>?series={row.id}</span> · {row.typeLabel} · 기체{' '}
              {row.rocketCount}대
            </p>
          </div>
        </div>
        <div className={ui.card}>
          <RocketSeriesForm
            mode="edit"
            cancelHref={LIST_HREF}
            version={row.version}
            typeOptions={typeOptions}
            typesHref={TYPES_HREF}
            values={{
              id: row.id,
              label: row.label,
              typeId: row.typeId,
              descriptionMd: row.descriptionMd,
              sortOrder: row.sortOrder,
            }}
          />
        </div>
      </>
    )
  }

  const target = deleteId !== undefined ? series.find((s) => s.id === deleteId) : undefined
  // 마지막 하나는 액션도 거부하지만, 확인 화면을 띄우지 않는 편이 낫다 — 눌러 보고 거부당하는
  // 것과 애초에 못 누르는 것은 다르다. 판단 기준을 액션과 화면 두 곳에 같은 값으로 둔다.
  const isLast = series.length <= 1

  return (
    <>
      <div className={ui.panelHead}>
        <div>
          <h2 className={ui.panelTitle} lang="en">
            Series
          </h2>
          <p className={ui.panelLede}>
            기체를 묶는 시리즈입니다. <span className={ui.mono}>/vehicles</span> 의 둘째 줄 탭이
            그대로 이 순서를 따르고, 각 분류의 맨 앞 시리즈가 그 분류의 기본 화면이 됩니다.
          </p>
        </div>
        <Link
          className={`${ui.btn} ${ui.btnPrimary}`}
          href={adminHref({ tab: 'rockets', sub: 'series', create: true })}
        >
          새 시리즈
        </Link>
      </div>

      {saved === 'deleted' ? <Notice tone="ok">시리즈를 삭제했습니다.</Notice> : null}
      {saved !== undefined && saved !== 'deleted' ? (
        <Notice tone="ok">저장했습니다. 공개 페이지에 반영되었습니다.</Notice>
      ) : null}

      {target ? (
        <DeleteConfirm
          action={deleteRocketSeriesAction}
          id={target.id}
          title={target.label}
          description={
            target.rocketCount > 0
              ? `이 시리즈에 기체 ${target.rocketCount}대가 있어 삭제할 수 없습니다. 먼저 기체를 다른 시리즈로 옮겨 주세요.`
              : '등록된 기체가 없어 바로 삭제됩니다.'
          }
          cancelHref={LIST_HREF}
        />
      ) : null}

      {deleteId !== undefined && !target ? (
        <Notice tone="error">삭제하려는 시리즈를 찾을 수 없습니다.</Notice>
      ) : null}

      <div className={ui.list}>
        {series.length === 0 ? (
          <p className={ui.empty}>
            등록된 시리즈가 없습니다. 기체를 만들려면 시리즈가 최소 하나 있어야 합니다.
          </p>
        ) : (
          series.map((s) => (
            <div className={ui.row} key={s.id}>
              <div className={ui.rowMain}>
                <p className={ui.rowName}>
                  <span lang="en">{s.label}</span>
                  <span className={`${ui.badge} ${ui.badgeSeries}`} lang="en">
                    {s.typeLabel}
                  </span>
                  {s.rocketCount === 0 ? (
                    <span className={`${ui.badge} ${ui.badgeOff}`}>기체 없음</span>
                  ) : null}
                </p>
                <p className={ui.rowMeta}>
                  <span className={ui.mono}>{s.id}</span> · 순서 {s.sortOrder} · 기체{' '}
                  {s.rocketCount}대
                </p>
              </div>
              <div className={ui.rowActions}>
                <Link
                  className={`${ui.btn} ${ui.btnSmall}`}
                  href={adminHref({ tab: 'rockets', sub: 'series', edit: s.id })}
                >
                  편집
                </Link>
                {/* 지울 수 없는 항목은 링크를 아예 내린다. 회색 버튼을 눌러 보게 만들지 않는다. */}
                {s.rocketCount === 0 && !isLast ? (
                  <Link
                    className={`${ui.btn} ${ui.btnSmall}`}
                    href={adminHref({ tab: 'rockets', sub: 'series', remove: s.id })}
                  >
                    삭제
                  </Link>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <p className={ui.panelLede}>
        <Link href={TYPES_HREF}>분류 관리</Link> ·{' '}
        <Link href={VEHICLES_HREF}>← 기체 목록으로</Link>
      </p>
    </>
  )
}
