import Link from 'next/link'
import DeleteConfirm from '@/components/admin/DeleteConfirm'
import Notice from '@/components/admin/Notice'
import RocketSeriesForm from '@/components/admin/RocketSeriesForm'
import ui from '@/components/admin/ui.module.css'
import { deleteRocketSeriesAction } from '../_actions/rocket-series'
import { listRocketSeriesForAdmin, nextRocketSeriesSortOrder } from '../_data/rockets'
import { adminHref } from '../_tabs'

const LIST_HREF = adminHref({ tab: 'rockets', sub: 'series' })
const ROCKETS_HREF = adminHref({ tab: 'rockets' })

/**
 * 로켓 카테고리(시리즈) 관리 — Rockets 탭의 하위 화면(`?tab=rockets&sub=series`).
 *
 * 로켓 폼 안에 인라인으로 넣지 않았다. HTML 폼은 중첩할 수 없어서 로켓 폼 안에 카테고리 폼을
 * 두려면 클라이언트 JS 로 제출을 가로채야 하는데, 그러면 이 콘솔에서 유일하게 JS 없이는
 * 동작하지 않는 화면이 된다. 대신 로켓 폼에서 링크로 건너오고, 저장하면 다시 돌아간다.
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
    const sortOrder = await nextRocketSeriesSortOrder()
    return (
      <>
        <div className={ui.panelHead}>
          <h2 className={ui.panelTitle}>새 카테고리</h2>
        </div>
        <div className={ui.card}>
          <RocketSeriesForm
            mode="create"
            cancelHref={LIST_HREF}
            values={{ id: '', label: '', sortOrder }}
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
            해당 카테고리를 찾을 수 없습니다. 다른 곳에서 이미 삭제되었을 수 있습니다.
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
              <span className={ui.mono}>?series={row.id}</span> · 기체 {row.rocketCount}대
            </p>
          </div>
        </div>
        <div className={ui.card}>
          <RocketSeriesForm
            mode="edit"
            cancelHref={LIST_HREF}
            version={row.version}
            values={{ id: row.id, label: row.label, sortOrder: row.sortOrder }}
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
            로켓을 묶는 카테고리입니다. 공개 목록의 탭이 그대로 이 순서를 따르고, 맨 앞
            카테고리가 <span className={ui.mono}>/rocket</span> 의 기본 화면이 됩니다.
          </p>
        </div>
        <Link
          className={`${ui.btn} ${ui.btnPrimary}`}
          href={adminHref({ tab: 'rockets', sub: 'series', create: true })}
        >
          새 카테고리
        </Link>
      </div>

      {saved === 'deleted' ? <Notice tone="ok">카테고리를 삭제했습니다.</Notice> : null}
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
              ? `이 카테고리에 기체 ${target.rocketCount}대가 있어 삭제할 수 없습니다. 먼저 기체를 다른 카테고리로 옮겨 주세요.`
              : '등록된 기체가 없어 바로 삭제됩니다.'
          }
          cancelHref={LIST_HREF}
        />
      ) : null}

      {deleteId !== undefined && !target ? (
        <Notice tone="error">삭제하려는 카테고리를 찾을 수 없습니다.</Notice>
      ) : null}

      <div className={ui.list}>
        {series.length === 0 ? (
          <p className={ui.empty}>
            등록된 카테고리가 없습니다. 로켓을 만들려면 카테고리가 최소 하나 있어야 합니다.
          </p>
        ) : (
          series.map((s) => (
            <div className={ui.row} key={s.id}>
              <div className={ui.rowMain}>
                <p className={ui.rowName}>
                  <span lang="en">{s.label}</span>
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
        <Link href={ROCKETS_HREF}>← 기체 목록으로</Link>
      </p>
    </>
  )
}
