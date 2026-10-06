import { sql } from 'drizzle-orm'
import { boolean, check, index, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { icaros } from './_schema'

/**
 * 레거시 게시글 — **우리가 소유하는 아카이브**.
 *
 * ## D23 을 바꾼다
 *
 * 원래 결정은 "`/posts` 의 단일 원본은 ESSENTIA Community 이고 **복제하지 않는다**"였다(D1·D23).
 * 그 전제에서 레거시 19건은 ESSENTIA 에 넣어야 했고, 그러려면 D1 서비스 토큰과 상대 팀의
 * DB 작업이 둘 다 필요했다 — 우리 쪽에서 열 수 없는 벽 두 개다.
 *
 * 방향을 바꾼다. **레거시는 우리 것으로 두고, 신규만 ESSENTIA 에서 온다.**
 *
 * | | 원본 | 소유 |
 * |---|---|---|
 * | 2026-01 이관 이전 글 | 이 테이블 | ICAROS |
 * | 그 이후 글 | ESSENTIA Community | ESSENTIA |
 *
 * "복제하지 않는다"는 원칙은 **깨지지 않는다.** 두 집합은 겹치지 않고, 어느 글이든 원본은
 * 정확히 한 곳에만 있다. 바뀐 것은 "모든 글의 원본이 한 곳"에서 "각 글의 원본이 한 곳"으로다.
 *
 * ## 왜 이게 더 나은가
 *
 * - 이관을 **우리 손으로 끝낼 수 있다.** 상대 일정에 묶이지 않는다.
 * - 이미지가 `icaros-web/` 에 남는다. `forum/`(ESSENTIA 소유, 우리는 쓰기 금지)을 건드리지 않는다.
 * - ESSENTIA 가 자기 게시판에 남의 과거 기록을 떠안지 않는다.
 *
 * ## 대가 — 적어 둔다
 *
 * `/posts` 가 **두 원본을 합쳐** 보여 준다. 목록 페이지네이션이 두 소스에 걸치므로
 * 경계에서 순서가 어긋날 여지가 생긴다. 레거시가 **더 이상 늘지 않는 고정 집합**이라는 점이
 * 그 복잡도를 감당 가능하게 만든다 — 늘어나는 쪽은 ESSENTIA 하나뿐이다.
 */
export const legacyPosts = icaros.table(
  'legacy_posts',
  {
    /** 레거시 Supabase 의 `posts.id`. 새로 발급하지 않는다 — 원본과의 대조 경로를 남긴다. */
    id: text('id').primaryKey(),

    /** URL 슬러그. 제목이 바뀌어도 링크가 살아 있도록 별도 컬럼으로 둔다. */
    slug: text('slug').notNull(),

    title: text('title').notNull(),

    /**
     * 마크다운 본문. **이미지 URL 은 이관 시점에 `/api/media/{id}` 로 치환된 상태**로 들어온다.
     * 레거시 Supabase 호스트가 하나라도 남아 있으면 그 원본이 사라지는 날 그림이 깨진다 —
     * 그래서 치환 누락을 CHECK 로 막는다.
     */
    contentMd: text('content_md').notNull(),

    /**
     * 원문 작성 시각. **이관 시각이 아니다.**
     * 이 값을 이관일로 덮으면 13개월치 기록이 하루로 접힌다.
     */
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),

    /** 목록 카드에 쓰는 대표 이미지. 본문 첫 이미지를 이관 때 골라 넣는다. */
    coverMediaId: text('cover_media_id'),

    /**
     * 목록에 내보낼지. **삭제 대신 플래그로 둔다.**
     *
     * 레거시 중 일부는 ESSENTIA 에 같은 사건의 글이 이미 있다 — 실제로 `ICX-1A Launch` 가
     * 그쪽 `ICAROS ICX-IA 1st Launch` 와 같은 날 같은 발사다. 합친 목록에서 같은 발사가
     * 두 번 보이는 것은 빠지는 것보다 나쁘다.
     *
     * 그렇다고 행을 지우지는 않는다. 중복 판정은 사람의 판단이고 뒤집힐 수 있는데,
     * 지워 버리면 되돌릴 때 원본 대조부터 다시 해야 한다. 본문·이미지는 남기고 노출만 끈다.
     */
    published: boolean('published').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('legacy_posts_slug_uq').on(t.slug),
    // 목록은 항상 최신순이다. 그 정렬 하나만 인덱스로 받친다.
    index('legacy_posts_published_idx').on(t.published, t.publishedAt),
    check('legacy_posts_title_ck', sql`length(btrim(${t.title})) > 0`),
    check('legacy_posts_slug_ck', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    /**
     * 치환 누락 방어. 본문에 레거시 스토리지 호스트가 남아 있으면 아예 저장되지 않는다.
     * 이관 스크립트가 놓치더라도 DB 가 마지막에 잡는다 — 원본이 사라진 뒤에 발견되는 것이
     * 이 작업에서 가장 나쁜 결말이다.
     */
    check('legacy_posts_no_legacy_url_ck', sql`${t.contentMd} not like '%supabase.co%'`),
  ]
)
