import LandingCopyForm from '@/components/admin/LandingCopyForm'
import Notice from '@/components/admin/Notice'
import SectionsForm from '@/components/admin/SectionsForm'
import ui from '@/components/admin/ui.module.css'
import { LANDING_GROUPS, LANDING_KEYS, loadLanding } from '../_data/landing'

/**
 * 랜딩 편집 (F8·F10·B11).
 *
 * **조회에 실패하면 폼을 렌더하지 않는다.** 레거시는 fetch 실패 시 모든 필드를 `""` 로 초기화하고
 * 에러도 표시하지 않아서, 그대로 저장을 누르면 랜딩 카피 전체가 공백으로 덮어써졌다 (01 §8 결함 #1).
 * 여기서는 실패 시 저장 버튼 자체가 DOM 에 존재하지 않는다 — 비활성화가 아니라 부재다.
 */
export default async function LandingPanel({ saved }: { saved: string | undefined }) {
  const load = await loadLanding()

  return (
    <>
      <div className={ui.panelHead}>
        <div>
          <h2 className={ui.panelTitle} lang="en">
            Landing
          </h2>
          <p className={ui.panelLede}>
            홈 화면 카피 {LANDING_KEYS.length}개와 섹션 노출·순서를 편집합니다. 저작권 표기는 모든
            공개 페이지 하단에 함께 반영됩니다.
          </p>
        </div>
      </div>

      {saved === 'copy' ? <Notice tone="ok">랜딩 카피를 저장했습니다.</Notice> : null}
      {saved === 'sections' ? <Notice tone="ok">섹션 설정을 저장했습니다.</Notice> : null}

      {!load.ok ? (
        <Notice tone="error" title="편집을 시작할 수 없습니다">
          <p>{load.error}</p>
          <p>
            현재 값을 확인하지 못한 상태에서 저장하면 기존 카피가 빈 값으로 덮어써지기 때문에 폼을
            열지 않습니다.
          </p>
        </Notice>
      ) : (
        <div className={ui.stack}>
          <div className={ui.card}>
            <h3 className={ui.cardTitle}>섹션 노출과 순서</h3>
            <p className={ui.hint}>
              끈 섹션은 홈 화면에서 사라집니다. 번호가 작은 섹션이 위에 옵니다.
            </p>
            <SectionsForm
              sections={load.data.sections.map((s) => ({
                id: s.id,
                label: s.label,
                enabled: s.enabled,
                sortOrder: s.sortOrder,
              }))}
              version={load.data.sectionsVersion}
            />
          </div>

          <div className={ui.card}>
            <h3 className={ui.cardTitle}>카피</h3>
            <LandingCopyForm
              groups={LANDING_GROUPS}
              values={load.data.values}
              version={load.data.version}
            />
          </div>
        </div>
      )}
    </>
  )
}
