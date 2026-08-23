import { PRESIGN_TTL_SECONDS } from '@/lib/image/policy'
import { getServableMedia } from '@/lib/s3/media'
import { presignGet } from '@/lib/s3/presign'
import { contentDisposition, toErrorResponse } from '@/lib/s3/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 302 로 presigned GET 에 넘긴다 (D3). 공개 클래스를 만들지 않는다 —
 * 버킷의 모든 객체는 private 이고, 접근 통제 지점은 이 핸들러 하나로 모인다.
 *
 * **이 URL 이 고정이라는 점이 핵심이다.** presigned URL 을 `next/image` 의 `src` 로 직접 쓰면
 * 10분마다 URL 이 바뀌어 최적화 캐시가 매번 miss 나고 서명 쿼리스트링이 캐시 키를 오염시킨다.
 * 프록시를 한 겹 두면 캐시 키가 고정된다.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params

    const item = await getServableMedia(id)
    // 존재하지 않는 id 와 아직 확정되지 않은 업로드를 구분하지 않는다.
    if (!item) return new Response(null, { status: 404 })

    const download = new URL(req.url).searchParams.get('download') === '1'

    const signed = await presignGet(item.key, {
      // 저장된 값 대신 우리 DB 의 mime 을 강제한다. S3 메타데이터는 업로더가 정한 값이다.
      contentType: item.mime,
      contentDisposition: contentDisposition(item.originalFilename, download),
    })

    return new Response(null, {
      status: 302,
      headers: {
        Location: signed,
        // 리다이렉트 캐시는 서명 만료보다 반드시 짧아야 한다. 길면 죽은 URL 을 나눠주게 된다.
        // private 인 이유: 공유 캐시가 서명 URL 로 가는 302 를 들고 있을 이유가 없다.
        'Cache-Control': `private, max-age=${Math.floor(PRESIGN_TTL_SECONDS * 0.4)}`,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
