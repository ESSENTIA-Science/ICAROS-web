import { unified } from 'unified'
import remarkParse from 'remark-parse'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const TYPES = new Set(['post', 'panel', 'rocket', 'mission', 'member'])
const MIME_EXT = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'],
  ['image/avif', 'avif'], ['image/gif', 'gif'], ['video/mp4', 'mp4'],
  ['application/pdf', 'pdf'], ['model/gltf-binary', 'glb'],
])

/** IDs referenced by a currently published member photo or Markdown image. */
export function selectedMemberMediaIds(snapshot) {
  const result = new Set()
  const add = url => { const id = /^\/api\/media\/([a-f0-9-]{36})$/.exec(url ?? '')?.[1]; if (id) result.add(id) }
  for (const member of snapshot.members ?? []) {
    if (member.published !== true) continue
    if (member.hasPhoto === true) add(member.imageSrc)
    if (typeof member.bioMd !== 'string') continue
    const tree = unified().use(remarkParse).parse(member.bioMd)
    const definitions = new Map(); const images = []; const nodes = [tree]
    while (nodes.length) {
      const node = nodes.pop()
      if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node.url)
      if (node.type === 'image') add(node.url)
      if (node.type === 'imageReference') images.push(node.identifier.toLowerCase())
      if (node.children) nodes.push(...node.children)
    }
    for (const name of images) add(definitions.get(name))
  }
  return result
}

/** Same public-only contract consumed by the compatibility media proxy. */
export function compatibilityMediaIndex(snapshot) {
  const value = Object.hasOwn(snapshot, 'compatMediaIndex') ? snapshot.compatMediaIndex : { version: snapshot.version, media: {} }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== snapshot.version ||
      Object.keys(value).some(key => !['version', 'media'].includes(key)) ||
      !value.media || typeof value.media !== 'object' || Array.isArray(value.media) || Object.keys(value.media).length > 10000) {
    throw new Error('Invalid compatibility media index')
  }
  const selected = selectedMemberMediaIds(snapshot)
  for (const [id, media] of Object.entries(value.media)) {
    if (!UUID.test(id) || !media || typeof media !== 'object' || Array.isArray(media) ||
        Object.keys(media).some(key => !['entityType', 'mime', 'sha256', 'size', 'key', 'storage'].includes(key)) ||
        !TYPES.has(media.entityType) || !MIME_EXT.has(media.mime) || !/^[a-f0-9]{64}$/.test(media.sha256) ||
        !['public', 'private'].includes(media.storage) ||
        (media.entityType === 'member' ? media.storage !== 'private' || !media.mime.startsWith('image/') : media.storage !== 'public') ||
        !Number.isSafeInteger(media.size) || media.size < 1 || media.size > (media.mime === 'video/mp4' ? 32 : ['application/pdf', 'model/gltf-binary'].includes(media.mime) ? 8 : 3) * 1024 * 1024 ||
        media.key !== `published/${id}/${media.sha256}.${MIME_EXT.get(media.mime)}`) {
      throw new Error('Invalid public compatibility media entry')
    }
    if (media.storage === 'private') {
      const url = `/api/media/${id}`
      if (snapshot.media?.[id] !== url || !selected.has(id)) {
        throw new Error('Orphan private member compatibility entry')
      }
    } else {
      let url
      try { url = new URL(snapshot.media?.[id]) } catch { throw new Error('Missing public compatibility URL') }
      if (url.protocol !== 'https:' || url.pathname !== `/${media.key}` || url.search || url.hash || url.username || url.password) throw new Error('Public compatibility URL mismatch')
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) throw new Error('Compatibility media index exceeds size limit')
  return value
}
