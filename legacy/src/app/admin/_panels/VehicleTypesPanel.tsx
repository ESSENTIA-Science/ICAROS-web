import Link from 'next/link'
import DeleteConfirm from '@/components/admin/DeleteConfirm'
import Notice from '@/components/admin/Notice'
import VehicleTypeForm from '@/components/admin/VehicleTypeForm'
import ui from '@/components/admin/ui.module.css'
import { deleteVehicleTypeAction } from '../_actions/vehicle-types'
import { listVehicleTypesForAdmin, nextVehicleTypeSortOrder } from '../_data/rockets'
import { adminHref } from '../_tabs'

const LIST_HREF = adminHref({ tab: 'rockets', sub: 'types' })
const SERIES_HREF = adminHref({ tab: 'rockets', sub: 'series' })
const VEHICLES_HREF = adminHref({ tab: 'rockets' })

/**
 * 기체 분류 관리 — Vehicles 탭의 하위 화면(`?tab=rockets&sub=types`).
 *
 * 시리즈 관리(`?sub=series`)와 **같은 층위·같은 모양**이다. 최상위 탭으로 올리지 않은 이유는
 * `_tabs.ts` 의 `ADMIN_SUBVIEWS` 주석에 있다 — 분류는 시리즈보다도 드물게 바뀐다.
 *
 * 택소노미는 분류 → 시리즈 → 기체 세 층이고 화면도 그 순서로 이어진다:
 * 이 화면 ↔ 시리즈 ↔ 기체 목록. 각 화면이 위아래 링크를 하나씩 들고 있다.
 */
export default async function VehicleTypesPanel({
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
    const sortOrder = await nextVehicleTypeSortOrder()
    return (
      <>
        <div className={ui.panelHead}>
          <h2 className={ui.panelTitle}>새 분류</h2>
        </div>
        <div className={ui.card}>
          <VehicleTypeForm
            mode="create"
            cancelHref={LIST_HREF}
            values={{ id: '', label: '', sortOrder }}
          />
        </div>
      </>
    )
  }

  const types = await listVehicleTypesForAdmin()

  if (editId !== undefined) {
    const row = types.find((t) => t.id === editId)
    if (!row) {
      return (
        <>
          <Notice tone="error">
            해당 분류를 찾을 수 없습니다. 다른 곳에서 이미 삭제되었을 수 있습니다.
          </Notice>
          <Link className={ui.btn} href={LIST_HREF}>
            목록으로
          </Link>
        </>
      )
    }

    return (
      <>
        <div className={ui.panelHead}>
          <div>
            <h2 className={ui.panelTitle}>{row.label}</h2>
            <p className={ui.panelLede}>
              <span className={ui.mono}>?type={row.id}</span> · 시리즈 {row.seriesCount}개
            </p>
          </div>
        </div>
        <div className={ui.card}>
          <VehicleTypeForm
            mode="edit"
            cancelHref={LIST_HREF}
            version={row.version}
            values={{ id: row.id, label: row.label, sortOrder: row.sortOrder }}
          />
        </div>
      </>
    )
  }

  const target = deleteId !== undefined ? types.find((t) => t.id === deleteId) : undefined
  // 마지막 하나는 액션도 거부하지만, 확인 화면을 띄우지 않는 편이 낫다 — 눌러 보고 거부당하는
  // 것과 애초에 못 누르는 것은 다르다. 판단 기준을 액션과 화면 두 곳에 같은 값으로 둔다.
  const isLast = types.length <= 1

  return (
    <>
      <div className={ui.panelHead}>
        <div>
          <h2 className={ui.panelTitle} lang="en">
            Vehicle types
          </h2>
          <p className={ui.panelLede}>
            시리즈를 묶는 상위 분류입니다. <span className={ui.mono}>/vehicles</span> 의 첫 줄
            탭이 그대로 이 순서를 따르고, 맨 앞 분류가 기본 화면이 됩니다.
          </p>
        </div>
        <Link
          className={`${ui.btn} ${ui.btnPrimary}`}
          href={adminHref({ tab: 'rockets', sub: 'types', create: true })}
        >
          새 분류
        </Link>
      </div>

      {saved === 'deleted' ? <Notice tone="ok">분류를 삭제했습니다.</Notice> : null}
      {saved !== undefined && saved !== 'deleted' ? (
        <Notice tone="ok">저장했습니다. 공개 페이지에 반영되었습니다.</Notice>
      ) : null}

      {target ? (
        <DeleteConfirm
          action={deleteVehicleTypeAction}
          id={target.id}
          title={target.label}
          description={
            target.seriesCount > 0
              ? `이 분류에 시리즈 ${target.seriesCount}개가 있어 삭제할 수 없습니다. 먼저 시리즈를 다른 분류로 옮겨 주세요.`
              : '속한 시리즈가 없어 바로 삭제됩니다.'
          }
          cancelHref={LIST_HREF}
        />
      ) : null}

      {deleteId !== undefined && !target ? (
        <Notice tone="error">삭제하려는 분류를 찾을 수 없습니다.</Notice>
      ) : null}

      <div className={ui.list}>
        {types.length === 0 ? (
          <p className={ui.empty}>
            등록된 분류가 없습니다. 시리즈를 만들려면 분류가 최소 하나 있어야 합니다.
          </p>
        ) : (
          types.map((t) => (
            <div className={ui.row} key={t.id}>
              <div className={ui.rowMain}>
                <p className={ui.rowName}>
                  <span lang="en">{t.label}</span>
                  {t.seriesCount === 0 ? (
                    <span className={`${ui.badge} ${ui.badgeOff}`}>시리즈 없음</span>
                  ) : null}
                </p>
                <p className={ui.rowMeta}>
                  <span className={ui.mono}>{t.id}</span> · 순서 {t.sortOrder} · 시리즈{' '}
                  {t.seriesCount}개
                </p>
              </div>
              <div className={ui.rowActions}>
                <Link
                  className={`${ui.btn} ${ui.btnSmall}`}
                  href={adminHref({ tab: 'rockets', sub: 'types', edit: t.id })}
                >
                  편집
                </Link>
                {/* 지울 수 없는 항목은 링크를 아예 내린다. 회색 버튼을 눌러 보게 만들지 않는다. */}
                {t.seriesCount === 0 && !isLast ? (
                  <Link
                    className={`${ui.btn} ${ui.btnSmall}`}
                    href={adminHref({ tab: 'rockets', sub: 'types', remove: t.id })}
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
        <Link href={SERIES_HREF}>시리즈 관리</Link> · <Link href={VEHICLES_HREF}>← 기체 목록으로</Link>
      </p>
    </>
  )
}
