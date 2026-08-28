import Image from 'next/image'
import Link from 'next/link'
import { textLang } from '@/components/landing/text-lang'
import type { FeedItem } from '@/lib/posts/feed'
import styles from './PostCard.module.css'

/**
 * 갤러리 카드 — 사진 / 제목 / 발췌 두 줄 / 날짜.
 *
 * ## 사진을 두 갈래로 그리는 이유
 *
 * 레거시 글의 사진은 우리 프록시(`/api/media/{id}`)라 same-origin 이고 `next/image` 가
 * 크기별 변형을 만들 수 있다. ESSENTIA 글의 사진은 상류 호스트에 있고,
 * `next.config.ts` 의 `remotePatterns: []`(D15)가 그 호스트를 최적화기에 등록하지 않는다 —
 * 열지 않는 것이 그 결정의 핵심이므로 여기서 우회하지 않고 `<img>` 로 직접 그린다.
 *
 * ## 사진이 없으면 대체 면을 그린다
 *
 * 상류 글 다수가 본문에 쓸 수 있는 사진이 없다(죽은 호스트를 가리키거나 아예 글만 있다).
 * 그때 프레임을 그냥 비워 두면 격자에 **빈 검정 사각형**이 남아 로딩 실패로 읽힌다.
 * 대신 `.blank` 가 해치와 코너 마크로 "빈 채로 측정된 면"을 그린다 — 없는 사진을 있는 척
 * 채우지 않으면서 고장으로도 읽히지 않는 선이다. 자세한 근거는 모듈 CSS 에 적었다.
 *
 * ## 링크는 제목에만 건다
 *
 * 카드를 통째로 `<a>` 로 감싸면 링크 이름이 "제목 발췌 문장 2026-08-17" 이 되어
 * 스크린리더의 링크 목록 탐색이 망가진다 (RocketCard 와 같은 판단). 카드 전체를 누를 수
 * 있게 하는 것은 `.link::after` 오버레이가 맡고, 대가로 카드 안 텍스트 드래그가 막힌다.
 *
 * ## 사진의 대체 텍스트는 비운다
 *
 * 사진은 장식이 아니라 글의 대표 이미지지만, **바로 옆에 제목이 글자로 있다.** 여기에
 * 제목을 한 번 더 넣으면 스크린리더가 같은 문장을 두 번 읽는다. 사진 자체를 설명할
 * 정보는 우리에게 없다 — 본문 첫 이미지를 기계적으로 고른 것이다.
 */

/**
 * 썸네일이 실제로 그려지는 최대 폭. **`sizes` 대신 이 숫자를 쓴다.**
 *
 * 예전 값은 `sizes="(max-width:599px) 100vw, (max-width:999px) 46vw, 30vw"` 였다.
 * `next/image` 는 `sizes` 에 vw 가 있으면 **하한만** 거르고(가장 작은 vw × 640) 나머지를
 * 전부 srcset 에 넣는다 — 위 값은 `256·384·640·828·1200·1920·3840` **7종**이 됐다.
 * 상한이 없으므로 `sizes` 를 아무리 좁혀도 3840 은 사라지지 않는다. 이건 D26 에서 랜딩
 * 변형을 40 → 25 로 줄인 것과 같은 증폭 경로다.
 *
 * `width`/`height` 를 주면 `next/image` 가 `1x`/`2x` 두 개만 만든다(`kind: 'x'`).
 * 실측 렌더 폭:
 *
 * | 폭 | 열 | 카드 폭 |
 * |---|---|---|
 * | 1500(컨테이너 상한, 여백 40×2, 간격 16×2) | 3 | **463px** |
 * | 999 | 2 | 459px |
 * | 599(모바일 1열, 여백 24×2) | 1 | **551px** |
 *
 * 최대가 551px 이라 `576` 을 잡으면 1x 는 640, 2x 는 1200 이 걸린다 — **변형 2종**이고
 * 2x 기기가 받는 바이트는 예전(1200)과 같다. 손해는 DPR 3 기기가 1920 대신 1200 을 받는
 * 것뿐인데, 그 절충은 `next/image` 자신이 2x 에서 자르는 근거와 같다.
 */
const THUMB_W = 576
const THUMB_H = 384

export default function PostCard({
  post,
  priority = false,
}: {
  post: FeedItem
  /**
   * 한 장에만 켠다 — 첫 화면의 LCP 이미지.
   *
   * 기본값(`lazy`)이면 브라우저가 레이아웃을 잡은 뒤에야 요청을 시작한다. 첫 **행**
   * (데스크톱 3장)이 아니라 첫 **장**만 켜는 이유는 모바일이 1열이라 그 행이 곧 한 장이고,
   * 세 장을 선점으로 밀면 화면에 없는 두 장이 LCP 이미지의 대역을 나눠 갖기 때문이다.
   *
   * 어느 장인지는 `posts/page.tsx` 가 고른다 — **첫 카드가 아니라 사진이 있는 첫 카드**다.
   */
  priority?: boolean
}) {
  const thumb = post.thumb

  return (
    <li className={styles.card}>
      <div className={styles.figure}>
        {thumb === null ? (
          <span className={styles.blank} aria-hidden="true" />
        ) : thumb.kind === 'media' ? (
          <Image
            src={thumb.src}
            alt=""
            width={THUMB_W}
            height={THUMB_H}
            priority={priority}
            className={styles.img}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- 상류 호스트는 remotePatterns 에 없다 (위 주석)
          <img
            src={thumb.src}
            alt=""
            /* 최적화기를 못 타므로 원본을 그대로 받는다. 첫 장만 즉시, 나머지는 나중에. */
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : undefined}
            decoding="async"
            className={styles.imgRaw}
          />
        )}
      </div>

      <h2 className={styles.title} lang={textLang(post.title)}>
        <Link href={post.href} className={styles.link}>
          {post.title}
        </Link>
      </h2>

      {post.excerpt ? <p className={styles.excerpt}>{post.excerpt}</p> : null}

      <p className={styles.meta}>
        <time dateTime={post.date} className="num">
          {post.date}
        </time>
      </p>
    </li>
  )
}
