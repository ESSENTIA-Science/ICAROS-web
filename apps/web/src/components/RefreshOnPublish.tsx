'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const versionPath = '/public-version/'

export async function checkPublishedVersion(
  currentVersion: string,
  href: string,
  fetchVersion: () => Promise<string>,
  navigate: (href: string) => void,
): Promise<void> {
  const latestVersion = await fetchVersion()
  if (!latestVersion || latestVersion === currentVersion) return
  const url = new URL(href)
  if (url.searchParams.get('__icaros_version') === latestVersion) return
  url.searchParams.set('__icaros_version', latestVersion)
  navigate(url.href)
}

export default function RefreshOnPublish({ currentVersion }: { currentVersion: string }) {
  const pathname = usePathname()

  useEffect(() => {
    let checking = false
    const check = async () => {
      if (document.visibilityState === 'hidden' || checking) return
      checking = true
      try {
        await checkPublishedVersion(currentVersion, location.href, async () => {
          const response = await fetch(versionPath, { cache: 'no-store', credentials: 'same-origin' })
          if (!response.ok) throw new Error('Published version unavailable')
          const result: unknown = await response.json()
          if (!result || typeof result !== 'object' || !('version' in result) || typeof result.version !== 'string') {
            throw new Error('Invalid published version')
          }
          return result.version
        }, href => location.replace(href))
      } catch {
        // Keep the current page on transient network failures; retry on the next visit.
      } finally {
        checking = false
      }
    }

    void check()
    const onShow = () => { void check() }
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('pageshow', onShow)
    window.addEventListener('focus', onShow)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('focus', onShow)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [currentVersion, pathname])

  return null
}
