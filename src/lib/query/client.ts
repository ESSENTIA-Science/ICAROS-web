import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from '@tanstack/react-query'

/**
 * TanStack Query v5 클라이언트.
 *
 * ## 서버에서는 매번 새로 만들고, 브라우저에서는 하나를 재사용한다
 *
 * 서버에서 싱글턴을 쓰면 **요청끼리 캐시를 공유한다.** 이 사이트는 관리자 화면과 공개 화면이
 * 같은 프로세스에서 렌더되므로, 그 공유는 한 사람이 본 데이터가 다른 사람 화면에 나가는
 * 경로가 된다. 서버리스에서 인스턴스가 재사용된다는 사실이 그 위험을 실제로 만든다.
 *
 * 브라우저에서는 반대다 — 렌더마다 새로 만들면 캐시가 매번 버려져 라이브러리를 쓰는 의미가 없다.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * 0 이 아니라 60초다.
         *
         * 이 앱은 데이터를 서버 컴포넌트에서 먼저 그린다. `staleTime: 0` 이면 하이드레이션
         * 직후 클라이언트가 **방금 서버가 가져온 것과 같은 데이터를** 즉시 다시 요청한다.
         * 첫 화면에서 쓸모없는 왕복이 한 번 더 생기는 셈이다.
         */
        staleTime: 60_000,
        /** 창을 다시 볼 때마다 전부 다시 받지 않는다. 이 사이트의 데이터는 그렇게 자주 안 바뀐다. */
        refetchOnWindowFocus: false,
        /** 네트워크가 끊겼다 붙는 흔한 경우에만 한 번. 무한 재시도는 오류를 늦게 보이게 할 뿐이다. */
        retry: 1,
      },
      dehydrate: {
        /**
         * 아직 로딩 중인 쿼리도 직렬화한다. 서버 컴포넌트에서 `prefetchQuery` 만 하고
         * `await` 하지 않은 것까지 클라이언트로 넘겨 스트리밍이 성립한다.
         */
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient()
  browserQueryClient ??= makeQueryClient()
  return browserQueryClient
}
