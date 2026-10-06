import { getNavItems, getSiteContentSafe } from '@/lib/content'
import HeaderNav from './HeaderNav'

/** Navigation labels come from the pinned publication snapshot. */
export default async function Header() {
  const content = await getSiteContentSafe()
  return <HeaderNav items={getNavItems(content)} />
}
