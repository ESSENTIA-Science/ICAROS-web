import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Login from './Login'

const effects = vi.hoisted(() => [] as (() => void)[])
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void) => { effects.push(effect) },
}))

afterEach(() => { effects.length = 0; vi.unstubAllGlobals() })

it('automatically replaces the unauthenticated page with the Cognito login flow', () => {
  const replace = vi.fn()
  vi.stubGlobal('location', { replace })
  const html = renderToStaticMarkup(<Login />)
  effects.forEach(effect => effect())
  expect(replace).toHaveBeenCalledExactlyOnceWith('/api/admin/auth/start')
  expect(html).toContain('Cognito 로그인으로 이동 중')
})

it('keeps API errors visible without creating an automatic redirect loop', () => {
  const replace = vi.fn()
  vi.stubGlobal('location', { replace })
  const html = renderToStaticMarkup(<Login error="관리자 API를 사용할 수 없습니다." />)
  effects.forEach(effect => effect())
  expect(replace).not.toHaveBeenCalled()
  expect(html).toContain('관리자 API를 사용할 수 없습니다.')
  expect(html).toContain('href="/api/admin/auth/start"')
})
