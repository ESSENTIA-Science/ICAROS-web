import { getNavItems, getSiteContentSafe } from '@/lib/content'
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
 *
 * **던지지 않는 `getSiteContentSafe` 를 쓴다** (W4, 2026-09-06). 이 껍데기는 `(public)/layout.tsx`
 * 에 있어 `/`·`/member` 의 프리렌더에 같이 들어간다. 두 라우트가 `revalidate = 60` 으로 넘어가면서
 * 빌드가 반드시 한 번 프리렌더하는데, 던지는 버전이면 **빌드 컨테이너가 RDS 에 닿지 못하는 날
 * 배포 전체가 죽는다**(D27). 실측: `Error occurred prerendering page "/"` · exit 1.
 * 잃는 것은 없다 — 라벨은 `getNavItems` 가 코드 기본값으로 채운다. 내비게이션은 비어도 되는
 * 자리가 아니라는 그 함수의 전제가 여기서 그대로 작동한다.
 */
export default async function Header() {
  const content = await getSiteContentSafe()
  return <HeaderNav items={getNavItems(content)} />
}
