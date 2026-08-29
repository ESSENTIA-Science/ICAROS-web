/**
 * **미디어를 가리키는 모든 곳의 목록.** 이 파일이 유일한 원본이다.
 *
 * `hasReferences()` 가 이 목록을 돌고, `npm run db:verify` 가 **DB 의 실제 외래키와 대조**한다.
 * 새 테이블이 `media.id` 를 가리키는데 여기 없으면 verify 가 빨간불을 낸다.
 *
 * ## 왜 이렇게까지 하나 (2026-08-29 장애)
 *
 * 패널 CMS 가 추가되면서 `page_panels.media_id` 가 생겼는데 `hasReferences()` 에 들어가지
 * 않았다. 그래서 정리 스윕이 패널 사진을 "아무도 안 쓴다"로 판정하고 지웠고,
 * 랜딩 패널 5개 중 4개가 사라졌다. **관리 화면에는 그대로 보여서** 발견이 늦었다.
 *
 * 빠뜨려도 아무 경고가 없었다는 것이 문제의 본질이다. 증상은 한참 뒤에
 * "사진이 사라졌다"로만 나타나고, 그때는 원인과 한참 떨어져 있다.
 * 그래서 **사람의 기억이 아니라 DB 스키마가 목록을 검사하게** 만든다.
 *
 * `on delete restrict` FK 는 이걸 못 막는다 — **하드 삭제만** 막고 soft delete 는 통과한다.
 */

/** `media.id` 를 외래키로 가리키는 컬럼. DB 의 실제 FK 와 1:1 이어야 한다. */
export const MEDIA_FK_COLUMNS: readonly { readonly table: string; readonly column: string }[] = [
  { table: 'rockets', column: 'cover_media_id' },
  { table: 'members', column: 'image_media_id' },
  { table: 'rocket_models', column: 'glb_media_id' },
  { table: 'rocket_models', column: 'poster_media_id' },
  { table: 'page_panels', column: 'media_id' },
]

/**
 * FK 가 아니라 **본문 문자열 안에** `/api/media/{id}` 로 박히는 곳.
 * 스키마로는 드러나지 않으므로 여기서만 관리된다 — `db:verify` 가 대조할 수 없다.
 */
export const MEDIA_TEXT_REFERENCES: readonly string[] = [
  'site_settings.value',
  // legacy_posts.content_md 는 이관 시점에 박제된 아카이브라 사람이 편집하지 않는다.
  // 그래도 참조는 참조다 — 정리 대상이 되면 레거시 글 사진이 사라진다.
  'legacy_posts.content_md',
]
