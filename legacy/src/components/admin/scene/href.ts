/**
 * `?tab=scene` 쿼리스트링을 만드는 유일한 지점.
 *
 * `_tabs.ts` 의 `adminHref` 를 쓰지 않는 이유: 그쪽 `AdminTab` 유니온에 scene 을 넣으려면
 * 다른 트랙이 소유한 파일을 고쳐야 한다. 파라미터 이름(`new`·`edit`·`delete`·`saved`)은
 * 일부러 완전히 동일하게 맞춰, 나중에 탭을 정식 등록할 때 이 파일만 지우면 되게 해 둔다.
 */
export const SCENE_TAB = 'scene'

export type SceneHref = {
  /** 새 모델 폼 열기 */
  create?: boolean
  /** 편집할 모델 id */
  edit?: string
  /** 삭제 확인 UI 를 띄울 모델 id */
  remove?: string
  /** 저장 직후 상태 배너 키 */
  saved?: string
}

export function sceneHref(h: SceneHref = {}): string {
  const p = new URLSearchParams({ tab: SCENE_TAB })
  if (h.create) p.set('new', '1')
  if (h.edit) p.set('edit', h.edit)
  if (h.remove) p.set('delete', h.remove)
  if (h.saved) p.set('saved', h.saved)
  return `/admin?${p.toString()}`
}
