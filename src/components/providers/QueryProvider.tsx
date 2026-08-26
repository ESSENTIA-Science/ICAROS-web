'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from '@/lib/query/client'

/**
 * 전역 TanStack Query 프로바이더.
 *
 * ## `children` 은 서버 컴포넌트로 남는다
 *
 * 이 파일이 `'use client'` 라고 해서 안에 들어오는 트리까지 클라이언트가 되지는 않는다 —
 * `children` 은 **prop 으로 전달된 이미 렌더된 엘리먼트**라 서버에서 그대로 렌더된다.
 * 그래서 "기본 서버 컴포넌트" 원칙이 깨지지 않고, 늘어나는 것은 프로바이더 자체의 번들뿐이다.
 *
 * ## `useState` 로 감싸지 않는다
 *
 * 흔한 예제는 `useState(() => new QueryClient())` 를 쓰지만, 그건 이 컴포넌트가 여러 번
 * 마운트될 때 인스턴스를 나누기 위한 것이다. 여기서는 `getQueryClient()` 가 이미
 * 서버=매번 새로 · 브라우저=싱글턴을 보장하므로 상태로 한 겹 더 감싸면 브라우저에서
 * 싱글턴이 깨진다.
 */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>
}
