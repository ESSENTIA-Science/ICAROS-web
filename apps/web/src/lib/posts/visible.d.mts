export function visiblePosts<T extends { source: string; title: string; contentMd: string }>(posts: readonly T[]): T[]
