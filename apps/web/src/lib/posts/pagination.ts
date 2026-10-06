export const POSTS_PAGE_SIZE = 15

export function postPageCount(postCount: number): number {
  return Math.max(1, Math.ceil(postCount / POSTS_PAGE_SIZE))
}
