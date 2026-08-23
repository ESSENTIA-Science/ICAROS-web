import { getNavItems, getSiteContent } from '@/lib/content'
import HeaderNav from './HeaderNav'

/**
 * 메뉴 4개. 구 사이트의 5번째 항목(외부 시뮬레이터 링크)은 공개 웹에서 전면 제거됐다.
 * 요구사항 §7 · docs/icaros-rebuild/02-requirements-matrix.md A2·A4 참조.
 * 외부 프로젝트와 도메인 자체는 유지된다 — 여기서 링크만 뺀 것이다.
 *
 * **라벨은 CMS(`site_settings` 의 `nav.*`)가 정한다** (A2 · F10). 헤더 자체는 상호작용이
 * 필요해 클라이언트여야 하는데, 클라이언트에서 DB 를 읽을 수는 없다. 그래서 이 파일이
 * 서버 껍데기로 남아 라벨만 읽어 넘기고, 상호작용은 `HeaderNav` 가 맡는다.
 *
 * 쿼리 비용은 0 이다 — `getSiteContent` 는 `cache()` 라 같은 요청 안에서 Footer 와
 * 결과를 공유한다.
 */
export default async function Header() {
  const content = await getSiteContent()
  return <HeaderNav items={getNavItems(content)} />
}
