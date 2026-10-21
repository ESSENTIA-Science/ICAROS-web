/** Keep the community copy when an imported legacy post has identical content. */
export function visiblePosts(posts) {
  const community = new Set(posts.filter(post => post.source === 'community')
    .map(post => `${post.title}\u0000${post.contentMd}`))
  return posts.filter(post => post.source !== 'legacy' ||
    !community.has(`${post.title}\u0000${post.contentMd}`))
}
