import LandingCopyForm from '@/components/admin/LandingCopyForm'
import Notice from '@/components/admin/Notice'
import SectionsForm from '@/components/admin/SectionsForm'
import ui from '@/components/admin/ui.module.css'
import { LANDING_GROUPS, LANDING_KEYS, loadLandingCopy, loadLandingSections } from '../_data/landing'

/**
 * 랜딩 편집 (F8·F10·B11).
 *
 * **카피 조회에 실패하면 카피 폼을 렌더하지 않는다.** 레거시는 fetch 실패 시 모든 필드를 `""` 로
 * 초기화하고 에러도 표시하지 않아서, 그대로 저장을 누르면 랜딩 카피 전체가 공백으로 덮어써졌다
 * (01 §8 결함 #1). 여기서는 실패 시 저장 버튼 자체가 DOM 에 존재하지 않는다 — 비활성화가 아니라 부재다.
 *
 * 그 차단은 **카피에만** 건다. 예전에는 두 조회를 한 결과로 묶어 `ok` 하나로 둘 다 가렸는데,
 * 카피 행 하나가 사라지면 섹션 순서·노출을 되돌릴 화면까지 함께 사라졌다. 두 저장 경로는
 * 서로 다른 테이블·다른 액션·다른 버전 토큰을 쓰므로 실패도 따로 낸다.
 */
export default async function LandingPanel({ saved }: { saved: string | undefined }) {
  // 서로 독립적인 두 조회다 — 직렬로 기다릴 이유가 없다.
  const [copy, sections] = await Promise.all([loadLandingCopy(), loadLandingSections()])

  return (
    <>
      <div className={ui.panelHead}>
        <div>
          <h2 className={ui.panelTitle} lang="en">
            Landing
          </h2>
          <p className={ui.panelLede}>
            사이트 카피 {LANDING_KEYS.length}개와 섹션 노출·순서를 편집합니다. 메뉴명·저작권 표기·SEO
            항목은 모든 공개 페이지에 함께 반영됩니다.
          </p>
        </div>
      </div>

      {saved === 'copy' ? <Notice tone="ok">랜딩 카피를 저장했습니다.</Notice> : null}
      {saved === 'sections' ? <Notice tone="ok">섹션 설정을 저장했습니다.</Notice> : null}

      <div className={ui.stack}>
        <div className={ui.card}>
          <h3 className={ui.cardTitle}>섹션 노출과 순서</h3>
          {sections.ok ? (
            <>
              <p className={ui.hint}>
                끈 섹션은 홈 화면에서 사라집니다. 번호가 작은 섹션이 위에 옵니다.
              </p>
              <SectionsForm sections={sections.sections} version={sections.version} />
            </>
          ) : (
            <Notice tone="error" title="섹션 설정을 열 수 없습니다">
              <p>{sections.error}</p>
            </Notice>
          )}
        </div>

        <div className={ui.card}>
          <h3 className={ui.cardTitle}>카피</h3>
          {copy.ok ? (
            <LandingCopyForm groups={LANDING_GROUPS} values={copy.values} version={copy.version} />
          ) : (
            <Notice tone="error" title="카피 편집을 시작할 수 없습니다">
              <p>{copy.error}</p>
              <p>
                현재 값을 확인하지 못한 상태에서 저장하면 기존 카피가 빈 값으로 덮어써지기 때문에
                폼을 열지 않습니다. 섹션 노출·순서는 위에서 그대로 편집할 수 있습니다.
              </p>
            </Notice>
          )}
        </div>
      </div>
    </>
  )
}
