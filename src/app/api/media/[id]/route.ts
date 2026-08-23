import { contentDisposition, toErrorResponse } from '@/lib/s3/http'
import { getServableMedia } from '@/lib/s3/media'
import { getObjectStream } from '@/lib/s3/objects'
import { etagMatches, quoteEtag } from '@/lib/s3/predicates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * S3 에서 받은 **바이트를 그대로 스트리밍**한다 (DECISIONS D15).
 *
 * 이전 구현은 presigned GET 으로 302 를 줬는데 그건 동작하지 않는다. Next 16.3.2 의 이미지
 * 최적화기는 `src` 가 `/` 로 시작하면 `fetchInternalImage` 경로를 타고, 거기에는 `Location` 을
 * 따라가는 코드가 없다. body 가 0바이트라 `ImageError(400)` 로 끝난다. 리다이렉트를 추적하는
 * `fetchExternalImage` 는 절대 URL 을 요구하는데 `next.config.ts` 의 `remotePatterns: []` 가 그걸 막는다.
 *
 * 스트리밍은 presigned URL 이 클라이언트로 새는 경로도 함께 닫는다 — 서명 URL 은 유효기간 동안
 * 그 자체로 자격증명이고, 한 번 새면 회수할 방법이 없다.
 */

/** 키가 랜덤 UUID 라 같은 URL 의 내용은 절대 바뀌지 않는다. 바뀌면 새 id 가 발급된다. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/** 접근 통제가 필요한 미디어. 중간 캐시·CDN 에 사본을 남기지 않는다. */
const RESTRICTED_CACHE = 'private, no-store'

/**
 * 공유 캐시에 올려도 되는 entity 종류 — **허용 목록**이다.
 *
 * 차단 목록으로 두면 나중에 추가되는 종류가 기본적으로 공개 캐시에 올라간다.
 * `member` 가 여기 없는 이유는 멤버 사진이 미성년자 얼굴이기 때문이고(요구사항 I17),
 * `entity_type` 이 null 인 행은 용도를 모르므로 같은 쪽으로 닫는다.
 */
const CACHEABLE_ENTITY_TYPES: ReadonlySet<string> = new Set(['rocket', 'landing', 'model', 'poster'])

function cacheControlFor(entityType: string | null): string {
  return entityType !== null && CACHEABLE_ENTITY_TYPES.has(entityType) ? IMMUTABLE_CACHE : RESTRICTED_CACHE
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params

    const item = await getServableMedia(id)
    // 존재하지 않는 id, 아직 확정되지 않은 업로드, 삭제된 미디어를 구분하지 않는다.
    if (!item) return new Response(null, { status: 404 })

    const cacheControl = cacheControlFor(item.entityType)

    // ETag 는 `/confirm` 때 DB 에 넣어 뒀다. 조건부 요청은 S3 를 부르기 전에 끝난다.
    if (item.etag && etagMatches(req.headers.get('if-none-match'), item.etag)) {
      return new Response(null, {
        status: 304,
        headers: { ETag: quoteEtag(item.etag), 'Cache-Control': cacheControl },
      })
    }

    // Range 는 해석하지 않고 S3 에 그대로 넘긴다 (GLB 부분 로딩).
    const object = await getObjectStream(item.bucket, item.key, req.headers.get('range'))
    if (!object) return new Response(null, { status: 404 })

    const download = new URL(req.url).searchParams.get('download') === '1'
    const headers = new Headers({
      // **DB 의 mime 을 강제한다.** S3 에 저장된 Content-Type 은 업로더가 서명 요청에 넣은 값이라
      // 신뢰할 근거가 없다. 우리 값은 `/confirm` 이 매직 넘버로 확인한 것이다.
      'Content-Type': item.mime,
      'Content-Disposition': contentDisposition(item.originalFilename, download),
      'Cache-Control': cacheControl,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    })

    const etag = item.etag ?? object.etag
    if (etag) headers.set('ETag', quoteEtag(etag))
    if (object.contentLength !== null) headers.set('Content-Length', String(object.contentLength))
    if (object.contentRange) headers.set('Content-Range', object.contentRange)

    return new Response(object.body, { status: object.partial ? 206 : 200, headers })
  } catch (err) {
    return toErrorResponse(err)
  }
}
