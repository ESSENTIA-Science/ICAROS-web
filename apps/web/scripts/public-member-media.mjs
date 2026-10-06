const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])

/** Only a published member's explicit, ready portrait reference may become public. */
export function memberPortraitMedia(member, mediaById) {
  if (member.published !== true || !member.image_media_id) return null
  const media = mediaById.get(member.image_media_id.toLowerCase())
  return media?.status === 'ready' && media.deleted_at === null && IMAGE_MIMES.has(media.mime)
    ? media : null
}
